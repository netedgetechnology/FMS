import { DatabaseSync } from "node:sqlite";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NormalizedTransactionCandidate } from "@financeos/import-engine";

import { migrations } from "@/core/database/migrations/registry";
import { AccountRepository } from "@/modules/accounts/repositories/AccountRepository";
import { ImportService } from "@/modules/imports/services/ImportService";
import { describeLoanImportPayments } from "@/modules/imports/pages/importLoanPaymentMessage";
import { TransactionService } from "@/modules/transactions/services/TransactionService";
import { TransactionRepository } from "@/modules/transactions/repositories/TransactionRepository";
import { derivationSideFor, finalTyping } from "@/modules/transactions/services/transactionTyping";
import { balanceSide } from "@/core/accounting/transferClassification";
import { signedTransactionAmount } from "@/core/formatting/signedTransactionAmount";

import { LoanRepository } from "../repositories/LoanRepository";
import { OverdraftEntryKind, LoanKind } from "../types";
import { overdraftRequestFromValues, type OverdraftFormValues } from "../validation";
import { EMIScheduleGenerator } from "./EMIScheduleGenerator";
import { LoanPaymentService } from "./LoanPaymentService";
import { LoanService } from "./LoanService";
import { LINK_DIALOG_TITLE, canLinkOverdraftChoice, linkWorkflowFor } from "../components/LinkTransactionToEmiDialog";
import { LoanTransactionLinkService, NOT_AN_EMI_PAYMENT_REASON } from "./LoanTransactionLinkService";
import { OverdraftService } from "./OverdraftService";

// ---------------------------------------------------------------------
// Overdraft (OD), end to end: the real LoanService, OverdraftService,
// LoanTransactionLinkService, TransactionService, ImportService and
// repositories against an in-memory database built from every FinWea
// migration - never the production database. Only the Tauri IPC is
// replaced: create_loan_atomic and the EMI commands are replayed with the
// same SQL as src-tauri (which has its own tests).
// ---------------------------------------------------------------------

const sqlite = { db: null as DatabaseSync | null };

vi.mock("@/core/database/engine/SQLiteProvider", () => ({
    SQLiteProvider: {
        getInstance: () => ({
            async select(sql: string, binds: unknown[] = []) {
                return sqlite.db!.prepare(sql).all(...(binds as never[]));
            },
            async execute(sql: string, binds: unknown[] = []) {
                sqlite.db!.prepare(sql).run(...(binds as never[]));
            },
        }),
    },
}));

function atomically(work: (db: DatabaseSync) => void): void {
    const db = sqlite.db!;
    db.exec("BEGIN");
    try {
        work(db);
        db.exec("COMMIT");
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}

const invoke = vi.fn(async (command: string, args: { request: Record<string, any> }) => {
    const request = args.request;

    // src-tauri/src/loan_create.rs, statement for statement.
    if (command === "create_loan_atomic") {
        atomically(db => {
            const a = request.loanAccount;
            db.prepare(
                `INSERT INTO accounts (id, institution_id, business_entity_id, currency_id, name, account_type, opening_balance, description, is_active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
            ).run(a.id, a.institutionId, a.businessEntityId, a.currencyId, a.name, a.accountType, a.description, a.isActive ? 1 : 0, a.createdAt, a.updatedAt);
            const l = request.loan;
            db.prepare(
                `INSERT INTO loans (id, account_id, lender_institution_id, loan_type, name, principal_amount, interest_rate, interest_type, tenure_months, emi_amount,
                    first_installment_amount, start_date, maturity_date, outstanding_principal, outstanding_interest, paid_installments, currency_id, status, notes, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(l.id, l.accountId, l.lenderInstitutionId, l.loanType, l.name, l.principalAmount, l.interestRate, l.interestType, l.tenureMonths, l.emiAmount,
                l.firstInstallmentAmount, l.startDate, l.maturityDate, l.outstandingPrincipal, l.outstandingInterest, l.paidInstallments, l.currencyId, l.status, l.notes, l.createdAt, l.updatedAt);
            db.prepare("UPDATE loans SET loan_account_id = ? WHERE id = ? AND deleted_at IS NULL").run(a.id, l.id);
            for (const s of request.schedule) {
                db.prepare(
                    `INSERT INTO loan_payment_schedule (id, loan_id, installment_number, due_date, principal_amount, interest_amount, total_amount, outstanding_principal, status, paid_date, paid_amount, transaction_id, notes, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
                ).run(s.id, l.id, s.installmentNumber, s.dueDate, s.principalAmount, s.interestAmount, s.totalAmount, s.outstandingPrincipal, s.status, s.paidDate, s.paidAmount, s.transactionId);
            }
            db.prepare("UPDATE loans SET outstanding_principal = ?, outstanding_interest = ?, status = COALESCE(?, status) WHERE id = ? AND deleted_at IS NULL")
                .run(request.balances.outstandingPrincipal, request.balances.outstandingInterest, request.balances.status, l.id);
            if (request.overdraft) {
                db.prepare("UPDATE loans SET loan_kind = 'OVERDRAFT', credit_limit = ?, opening_used = ?, opening_used_as_of = ? WHERE id = ? AND deleted_at IS NULL")
                    .run(request.overdraft.creditLimit, request.overdraft.openingUsed, request.overdraft.openingUsedAsOf, l.id);
                for (const accountId of request.overdraft.accountIds) {
                    db.prepare("INSERT OR IGNORE INTO overdraft_accounts (id, loan_id, account_id) VALUES (lower(hex(randomblob(16))), ?, ?)").run(l.id, accountId);
                }
            }
        });
        return;
    }

    // src-tauri/src/overdraft_update.rs, statement for statement.
    if (command === "update_overdraft_atomic") {
        const ids = JSON.stringify(request.accountIds);
        if (request.accountIds.length === 0) throw "OVERDRAFT_UPDATE_REFUSED: Choose at least one bank account for this overdraft.";
        atomically(db => {
            const stranded = (db.prepare(
                `SELECT COUNT(*) AS n FROM overdraft_transaction_links AS link JOIN transactions AS txn ON txn.id = link.transaction_id
                 WHERE link.loan_id = ? AND txn.deleted_at IS NULL
                   AND txn.account_id IN (SELECT account_id FROM overdraft_accounts WHERE loan_id = ?)
                   AND txn.account_id NOT IN (SELECT value FROM json_each(?))`
            ).get(request.loanId, request.loanId, ids) as { n: number }).n;
            if (stranded > 0) {
                throw `OVERDRAFT_UPDATE_REFUSED: ${stranded} linked transaction(s) are on a bank account you are removing from this overdraft. Unlink them first, then remove the account.`;
            }
            const updated = db.prepare(
                `UPDATE loans SET account_id = ?, name = ?, lender_institution_id = ?, currency_id = ?, interest_rate = ?, start_date = ?, status = ?, notes = ?,
                    credit_limit = ?, opening_used = ?, opening_used_as_of = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ? AND loan_kind = 'OVERDRAFT' AND deleted_at IS NULL`
            ).run(request.accountIds[0], request.name, request.lenderInstitutionId, request.currencyId, request.interestRate, request.startDate, request.status, request.notes,
                request.creditLimit, request.openingUsed, request.openingUsedAsOf, request.loanId);
            if (updated.changes !== 1) throw "OVERDRAFT_UPDATE_REFUSED: This overdraft was not found.";
            db.prepare("DELETE FROM overdraft_accounts WHERE loan_id = ? AND account_id NOT IN (SELECT value FROM json_each(?))").run(request.loanId, ids);
            for (const accountId of request.accountIds) {
                db.prepare("INSERT OR IGNORE INTO overdraft_accounts (id, loan_id, account_id) VALUES (lower(hex(randomblob(16))), ?, ?)").run(request.loanId, accountId);
            }
        });
        return;
    }

    // src-tauri/src/loan_payment.rs (linked transaction only).
    if (command === "record_emi_payment_atomic") {
        atomically(db => {
            const p = request.payment;
            if (db.prepare("SELECT id FROM loan_schedule_payments WHERE transaction_id = ?").get(p.transactionId)) {
                throw "EMI_PAYMENT_REFUSED: This transaction is already recorded as a loan payment.";
            }
            // check_existing_transaction: money out only (Expense / Transfer Out).
            const existing = db.prepare("SELECT type, transfer_direction FROM transactions WHERE id = ? AND deleted_at IS NULL").get(p.transactionId) as { type: string; transfer_direction: string | null } | undefined;
            if (!existing || !(existing.type === "expense" || (existing.type === "transfer" && existing.transfer_direction === "OUT"))) {
                throw "EMI_PAYMENT_REFUSED: Only an outgoing transaction (an Expense or a Transfer Out) can record a loan payment.";
            }
            db.prepare(`INSERT INTO loan_schedule_payments (id, loan_id, schedule_id, transaction_id, payment_date, amount, principal_amount, interest_amount, transaction_linked, settles_installment)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
                .run(p.id, p.loanId, p.scheduleId, p.transactionId, p.paymentDate, p.amount, p.principalAmount, p.interestAmount, p.settlesInstallment ? 1 : 0);
            const s = request.schedule;
            db.prepare("UPDATE loan_payment_schedule SET status = ?, paid_date = ?, paid_amount = ?, transaction_id = ? WHERE id = ?")
                .run(s.status, s.paidDate, s.paidAmount, s.transactionId, s.id);
            db.prepare("UPDATE loans SET outstanding_principal = ?, outstanding_interest = ?, status = ? WHERE id = ?")
                .run(request.loan.outstandingPrincipal, request.loan.outstandingInterest, request.loan.status, request.loan.id);
        });
        return;
    }

    if (command === "delete_loan_atomic") {
        atomically(db => {
            db.prepare("DELETE FROM loan_payment_schedule WHERE loan_id = ?").run(request.loanId);
            db.prepare("UPDATE loans SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(request.loanId);
        });
        return;
    }

    throw new Error(`Unexpected command ${command}`);
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...(args as [string, never])) }));

// Fills every NOT NULL column without a default, so a test states only what it is about.
function insert(table: string, values: Record<string, unknown>): void {
    const row: Record<string, unknown> = { ...values };
    for (const column of sqlite.db!.prepare(`PRAGMA table_info(${table})`).all() as {
        name: string; type: string; notnull: number; dflt_value: unknown;
    }[]) {
        if (column.name in row || !column.notnull || column.dflt_value !== null) continue;
        row[column.name] = /INT|REAL|NUM/i.test(column.type) ? 0 : `${column.name}-${Math.random().toString(36).slice(2, 8)}`;
    }
    const columns = Object.keys(row);
    sqlite.db!.prepare(
        `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
    ).run(...(Object.values(row) as never[]));
}

const all = <T = Record<string, any>>(sql: string, ...binds: unknown[]) =>
    sqlite.db!.prepare(sql).all(...(binds as never[])) as T[];

const BANK = "acct-bank";
// Only a transaction in a loan category can be linked to a loan (see
// loanLinkEligibility.ts) - OD movements here are categorised as such.
const LOAN_CATEGORY = "cat-loan-installment";
const OTHER_BANK = "acct-other";

function odValues(overrides: Partial<OverdraftFormValues> = {}): OverdraftFormValues {
    return {
        name: "ABC Overdraft",
        lenderInstitutionName: "ABC Finance",
        accountIds: [BANK],
        currencyId: "cur-inr",
        creditLimit: 5_000_000,
        openingUsed: 2_000_000,
        openingUsedAsOf: "2026-06-30",
        startDate: "2025-04-01",
        interestRate: 10.5,
        status: "ACTIVE",
        notes: "",
        ...overrides,
    };
}

async function createOverdraft(overrides: Partial<OverdraftFormValues> = {}): Promise<string> {
    return await new LoanService().create(overdraftRequestFromValues(odValues(overrides)));
}

let txnCounter = 0;

/** An existing bank transaction, as Transactions holds it. */
function addTransaction(spec: {
    type: "income" | "expense" | "transfer";
    amount: number;
    date: string;
    accountId?: string;
    narration?: string;
    transferDirection?: "IN" | "OUT" | null;
    categoryId?: string | null;
}): string {
    const id = `txn-${++txnCounter}`;
    insert("transactions", {
        id,
        account_id: spec.accountId ?? BANK,
        payee: spec.narration ?? "Bank",
        type: spec.type,
        transfer_direction: spec.transferDirection ?? null,
        amount: spec.amount,
        transaction_date: spec.date,
        category_id: spec.categoryId === undefined ? LOAN_CATEGORY : spec.categoryId,
        original_narration: spec.narration ?? null,
        status: "CLEARED",
    });
    return id;
}

async function position(loanId: string) {
    const loan = (await new LoanRepository().getById(loanId))!;
    return await new OverdraftService().getPosition(loan);
}

async function link(transactionId: string, loanId: string, entryKind: OverdraftEntryKind) {
    return await new LoanTransactionLinkService().linkOverdraft({ transactionId, loanId, entryKind });
}

const { DRAWDOWN, REPAYMENT, INTEREST_CHARGE } = OverdraftEntryKind;

function candidate(rowNumber: number, overrides: Partial<NormalizedTransactionCandidate>): NormalizedTransactionCandidate {
    return {
        rowNumber, transactionDate: "2026-07-05", payee: "", description: `ROW ${rowNumber}`,
        amount: 100, type: "expense", referenceNumber: null, externalTransactionId: null,
        balance: null, branch: null, transactionType: null, counterparty: null, notes: null, rawData: {},
        categoryId: LOAN_CATEGORY,
        ...overrides,
    };
}

async function importStatement(rows: Array<Partial<NormalizedTransactionCandidate>>, accountId = BANK) {
    const service = new ImportService();
    Object.defineProperty(service, "counterpartyRuleRepository", {
        value: { findByAccountAndPattern: async () => null, upsert: async () => null },
    });
    return await service.importCandidates(
        accountId, "statement.csv", "BANK_CSV",
        rows.map((row, index) => candidate(index + 1, row)), "Test Mapping"
    );
}

const importedId = (date: string, amount: number) =>
    all<{ id: string }>("SELECT id FROM transactions WHERE transaction_date = ? AND amount = ? AND deleted_at IS NULL", date, amount)[0]!.id;

const linksOf = (loanId: string) =>
    all<{ transaction_id: string; entry_kind: string; link_source: string }>(
        "SELECT transaction_id, entry_kind, link_source FROM overdraft_transaction_links WHERE loan_id = ? ORDER BY created_at, id", loanId
    );

const REPAY_NARRATION = (ref: string) => `ACH DR ABC FINANCE OD REPAY ${ref}`;
const DRAW_NARRATION = (ref: string) => `NEFT CR ABC FINANCE OD DISB ${ref}`;

beforeEach(() => {
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
    for (const migration of migrations) {
        for (const statement of migration.sql.split(";").map(s => s.trim()).filter(Boolean)) {
            if (!/^PRAGMA\s+foreign_keys\s*=\s*ON\s*$/i.test(statement)) db.exec(statement);
        }
    }
    sqlite.db = db;
    insert("accounts", { id: BANK, name: "Operating Account", account_type: "CURRENT", opening_balance: 0 });
    insert("accounts", { id: OTHER_BANK, name: "Savings", account_type: "SAVINGS", opening_balance: 0 });
    insert("categories", { id: LOAN_CATEGORY, name: "Loan Installment", category_type: "EXPENSE", finance_scope: "BOTH" });
    txnCounter = 0;
    invoke.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Overdraft - creation and the initial calculation", () => {
    it("A. Add OD: Used = opening used, Available = limit - used, Utilization = used / limit, no EMI schedule", async () => {
        const id = await createOverdraft();

        const loan = (await new LoanRepository().getById(id))!;
        expect(loan).toMatchObject({
            loanKind: LoanKind.OVERDRAFT, creditLimit: 5_000_000, openingUsed: 2_000_000,
            openingUsedAsOf: "2026-06-30", principalAmount: 0, tenureMonths: null, emiAmount: null,
            outstandingPrincipal: 2_000_000, outstandingInterest: 0,
        });
        expect(all("SELECT * FROM loan_payment_schedule WHERE loan_id = ?", id)).toHaveLength(0);

        expect(await position(id)).toEqual({
            limit: 5_000_000, drawingPower: null, used: 2_000_000, available: 3_000_000, overLimitBy: 0,
            overDrawingPowerBy: 0, utilizationPercent: 40, totalDrawdowns: 0, totalRepayments: 0, totalInterestCharges: 0,
            status: "PARTLY_USED", reviewReasons: [],
        });
    });

    it("A. zero usage, full utilization and over limit", async () => {
        const zero = await createOverdraft({ name: "Zero OD", openingUsed: 0 });
        const full = await createOverdraft({ name: "Full OD", openingUsed: 5_000_000 });
        const over = await createOverdraft({ name: "Over OD", openingUsed: 5_250_000 });

        expect(await position(zero)).toMatchObject({ used: 0, available: 5_000_000, utilizationPercent: 0, status: "NOT_USED" });
        expect(await position(full)).toMatchObject({ used: 5_000_000, available: 0, utilizationPercent: 100, status: "FULLY_USED" });
        expect(await position(over)).toMatchObject({ used: 5_250_000, available: 0, overLimitBy: 250_000, utilizationPercent: 105, status: "OVER_LIMIT" });
    });

    it("A. an OD without a limit or a linked account is refused, and nothing is written", async () => {
        await expect(createOverdraft({ creditLimit: 0 })).rejects.toThrow("OD limit");
        await expect(createOverdraft({ accountIds: [] })).rejects.toThrow("bank account");
        await expect(createOverdraft({ openingUsedAsOf: "" })).rejects.toThrow("as of");
        expect(all("SELECT * FROM loans")).toHaveLength(0);
        expect(invoke).not.toHaveBeenCalled();
    });
});

describe("Overdraft - drawdowns and repayments recalculate Used and Available", () => {
    it("B/C/F. drawdown -> repayment -> drawdown: Used follows the real amounts", async () => {
        const id = await createOverdraft();

        await link(addTransaction({ type: "income", amount: 300_000, date: "2026-07-02" }), id, DRAWDOWN);
        expect(await position(id)).toMatchObject({ used: 2_300_000, available: 2_700_000, totalDrawdowns: 300_000 });

        await link(addTransaction({ type: "expense", amount: 500_000, date: "2026-07-10" }), id, REPAYMENT);
        expect(await position(id)).toMatchObject({ used: 1_800_000, available: 3_200_000, totalRepayments: 500_000 });

        await link(addTransaction({ type: "income", amount: 300_000, date: "2026-07-20" }), id, DRAWDOWN);
        expect(await position(id)).toMatchObject({
            used: 2_100_000, available: 2_900_000, totalDrawdowns: 600_000, totalRepayments: 500_000,
            utilizationPercent: 42, status: "PARTLY_USED",
        });
    });

    it("D/E. multiple drawdowns and multiple repayments", async () => {
        const id = await createOverdraft({ openingUsed: 0 });

        for (const [amount, day] of [[1_000_000, "02"], [750_000, "03"], [250_000.5, "04"]] as const) {
            await link(addTransaction({ type: "income", amount, date: `2026-07-${day}` }), id, DRAWDOWN);
        }
        expect(await position(id)).toMatchObject({ used: 2_000_000.5, totalDrawdowns: 2_000_000.5 });

        for (const [amount, day] of [[200_000, "10"], [300_000.25, "11"]] as const) {
            await link(addTransaction({ type: "expense", amount, date: `2026-07-${day}` }), id, REPAYMENT);
        }
        expect(await position(id)).toMatchObject({ used: 1_500_000.25, available: 3_499_999.75, totalRepayments: 500_000.25 });
    });

    it("a transfer IN is a drawdown and a transfer OUT a repayment, like income / expense", async () => {
        const id = await createOverdraft();
        await link(addTransaction({ type: "transfer", transferDirection: "IN", amount: 100_000, date: "2026-07-02" }), id, DRAWDOWN);
        await link(addTransaction({ type: "transfer", transferDirection: "OUT", amount: 40_000, date: "2026-07-03" }), id, REPAYMENT);
        expect(await position(id)).toMatchObject({ used: 2_060_000 });
    });

    it("Interest / Charge is kept separate and never changes Used", async () => {
        const id = await createOverdraft();
        await link(addTransaction({ type: "expense", amount: 17_500, date: "2026-07-31" }), id, INTEREST_CHARGE);
        expect(await position(id)).toMatchObject({ used: 2_000_000, available: 3_000_000, totalInterestCharges: 17_500, totalRepayments: 0 });
    });

    it("Opening Used As Of: a transaction on or before that date is already in the opening amount and is refused", async () => {
        const id = await createOverdraft();
        const onDate = addTransaction({ type: "expense", amount: 1_000, date: "2026-06-30" });
        const before = addTransaction({ type: "income", amount: 1_000, date: "2026-05-01" });

        await expect(link(onDate, id, REPAYMENT)).rejects.toThrow("opening used amount");
        await expect(link(before, id, DRAWDOWN)).rejects.toThrow("opening used amount");
        expect(linksOf(id)).toHaveLength(0);
        expect(await position(id)).toMatchObject({ used: 2_000_000 });
    });

    it("L. wrong direction is never treated as a drawdown or repayment", async () => {
        const id = await createOverdraft();
        const credit = addTransaction({ type: "income", amount: 1_000, date: "2026-07-02" });
        const debit = addTransaction({ type: "expense", amount: 1_000, date: "2026-07-02" });

        await expect(link(credit, id, REPAYMENT)).rejects.toThrow("money-in");
        await expect(link(credit, id, INTEREST_CHARGE)).rejects.toThrow("money-in");
        await expect(link(debit, id, DRAWDOWN)).rejects.toThrow("money-out");
        expect(linksOf(id)).toHaveLength(0);
    });

    it("a transaction on another account can't be linked", async () => {
        const id = await createOverdraft();
        const elsewhere = addTransaction({ type: "income", amount: 1_000, date: "2026-07-02", accountId: OTHER_BANK });
        await expect(link(elsewhere, id, DRAWDOWN)).rejects.toThrow("linked bank account");
    });

    it("Q. Used and Available always add up to the limit (while within it)", async () => {
        const id = await createOverdraft({ creditLimit: 1_000_000, openingUsed: 123_456.78 });
        let day = 1;
        for (const [type, amount] of [["income", 10_000.11], ["expense", 3_333.33], ["income", 50_000], ["expense", 99_999.99], ["income", 0.01]] as const) {
            await link(addTransaction({ type, amount, date: `2026-07-${String(++day).padStart(2, "0")}` }), id, type === "income" ? DRAWDOWN : REPAYMENT);
            const p = await position(id);
            expect(Math.round((p.used + p.available) * 100) / 100).toBe(1_000_000);
            expect(p.utilizationPercent).toBeCloseTo((p.used / p.limit) * 100, 2);
        }
    });
});

describe("Overdraft - edits, deletes, restores and links all recalculate from the live transactions", () => {
    it("G. editing a linked transaction's amount recalculates the OD", async () => {
        const id = await createOverdraft();
        const repayment = addTransaction({ type: "expense", amount: 200_000, date: "2026-07-05" });
        await link(repayment, id, REPAYMENT);
        expect(await position(id)).toMatchObject({ used: 1_800_000 });

        await new TransactionService().update({ id: repayment, amount: 150_000 });

        expect(await position(id)).toMatchObject({ used: 1_850_000, available: 3_150_000, totalRepayments: 150_000, status: "PARTLY_USED" });
    });

    it("a corrected principal direction takes its link with it: a Repayment edited to money in becomes a Drawdown", async () => {
        // (Previously the link was left as Repayment, excluded and flagged
        // for review. A principal link now follows the saved direction so
        // the OD counts the money the way it actually moved.)
        const id = await createOverdraft();
        const repayment = addTransaction({ type: "expense", amount: 200_000, date: "2026-07-05" });
        await link(repayment, id, REPAYMENT);

        await new TransactionService().update({ id: repayment, type: "income" });

        const p = await position(id);
        expect(p).toMatchObject({ used: 2_200_000, totalRepayments: 0, totalDrawdowns: 200_000, status: "PARTLY_USED" });
        expect(p.reviewReasons).toEqual([]);
    });

    it("an Interest / Charge link can't become money in: the edit is refused and nothing changes", async () => {
        const id = await createOverdraft();
        const charge = addTransaction({ type: "expense", amount: 17_500, date: "2026-07-05" });
        await link(charge, id, INTEREST_CHARGE);

        await expect(new TransactionService().update({ id: charge, type: "income" })).rejects.toThrow("unlink it first");

        expect(await position(id)).toMatchObject({ used: 2_000_000, totalInterestCharges: 17_500 });
    });

    it("an edited account no longer qualifies: excluded and flagged for review", async () => {
        const id = await createOverdraft();
        const drawdown = addTransaction({ type: "income", amount: 100_000, date: "2026-07-05" });
        await link(drawdown, id, DRAWDOWN);

        await new TransactionService().update({ id: drawdown, accountId: OTHER_BANK });

        expect(await position(id)).toMatchObject({ used: 2_000_000, status: "NEEDS_REVIEW" });
    });

    it("an edited date on or before the opening date no longer qualifies: excluded and flagged", async () => {
        const id = await createOverdraft();
        const drawdown = addTransaction({ type: "income", amount: 100_000, date: "2026-07-05" });
        await link(drawdown, id, DRAWDOWN);

        await new TransactionService().update({ id: drawdown, transactionDate: "2026-06-15" });

        expect(await position(id)).toMatchObject({ used: 2_000_000, status: "NEEDS_REVIEW" });
    });

    it("H. deleting a linked transaction recalculates the OD; restoring it counts it again", async () => {
        const id = await createOverdraft();
        const drawdown = addTransaction({ type: "income", amount: 400_000, date: "2026-07-05" });
        await link(drawdown, id, DRAWDOWN);
        expect(await position(id)).toMatchObject({ used: 2_400_000 });

        // An OD-linked transaction is deleted normally (nothing to reverse).
        await new TransactionService().delete(drawdown);
        expect(await position(id)).toMatchObject({ used: 2_000_000, available: 3_000_000, totalDrawdowns: 0, status: "PARTLY_USED" });

        // Restored (FinWea has no restore action yet - the row's deleted_at is cleared).
        sqlite.db!.prepare("UPDATE transactions SET deleted_at = NULL WHERE id = ?").run(drawdown);
        expect(await position(id)).toMatchObject({ used: 2_400_000, totalDrawdowns: 400_000 });
    });

    it("unlink recalculates the OD and keeps the transaction exactly as it was", async () => {
        const id = await createOverdraft();
        const repayment = addTransaction({ type: "expense", amount: 250_000, date: "2026-07-05" });
        await link(repayment, id, REPAYMENT);
        const before = all("SELECT * FROM transactions WHERE id = ?", repayment);

        const service = new LoanTransactionLinkService();
        expect(await service.getLinkDetails(repayment)).toEqual({
            loanName: "ABC Overdraft", installmentNumber: null, amount: 250_000, overdraftEntryKind: REPAYMENT,
        });

        await service.unlink(repayment);

        expect(await position(id)).toMatchObject({ used: 2_000_000, totalRepayments: 0 });
        expect(all("SELECT * FROM transactions WHERE id = ?", repayment)).toEqual(before);
        expect(await service.getLinkDetails(repayment)).toBeNull();
        await expect(service.unlink(repayment)).rejects.toThrow("not linked");
    });

    it("M. a transaction is never counted twice", async () => {
        const id = await createOverdraft();
        const other = await createOverdraft({ name: "XYZ Overdraft", lenderInstitutionName: "XYZ Bank" });
        const drawdown = addTransaction({ type: "income", amount: 100_000, date: "2026-07-05" });
        await link(drawdown, id, DRAWDOWN);

        await expect(link(drawdown, id, DRAWDOWN)).rejects.toThrow("already linked");
        await expect(link(drawdown, other, DRAWDOWN)).rejects.toThrow("already linked");
        // The database refuses a second link outright: UNIQUE(transaction_id).
        expect(() => sqlite.db!.prepare(
            "INSERT INTO overdraft_transaction_links (id, loan_id, transaction_id, entry_kind) VALUES ('dup', ?, ?, 'DRAWDOWN')"
        ).run(other, drawdown)).toThrow(/UNIQUE/);

        expect(await position(id)).toMatchObject({ used: 2_100_000 });
        expect(await position(other)).toMatchObject({ used: 2_000_000 });
    });

    it("a loan EMI payment can't also be an OD movement", async () => {
        const id = await createOverdraft();
        const debit = addTransaction({ type: "expense", amount: 10_000, date: "2026-07-05" });
        insert("loan_schedule_payments", { id: "pay-1", loan_id: "term", schedule_id: "s", transaction_id: debit, payment_date: "2026-07-05", amount: 10_000, principal_amount: 0, interest_amount: 0 });

        await expect(link(debit, id, REPAYMENT)).rejects.toThrow("already recorded as a payment");
        expect(linksOf(id)).toHaveLength(0);
    });

    it("Transfer In / Transfer Out bank rows: the dialog offers Drawdown, or Repayment / Interest-Charge", async () => {
        const id = await createOverdraft({ openingUsed: 0, openingUsedAsOf: "2026-01-31" });
        const transferIn = addTransaction({ type: "transfer", transferDirection: "IN", amount: 500_000, date: "2026-09-15", narration: "TATA CAPITAL LIMITED (OD)" });
        const transferOut = addTransaction({ type: "transfer", transferDirection: "OUT", amount: 100_000, date: "2026-09-23", narration: "TATA CAPITAL (OD)" });
        const service = new LoanTransactionLinkService();

        expect(await service.getLinkOptions(transferIn)).toMatchObject({
            refusal: null, overdrafts: [{ loanId: id, kinds: [DRAWDOWN], refusal: null }],
        });
        expect((await service.getLinkOptions(transferOut)).overdrafts).toEqual([
            expect.objectContaining({ loanId: id, kinds: [REPAYMENT, INTEREST_CHARGE], refusal: null }),
        ]);
    });

    it("with Opening Used As Of after the transaction, the OD is offered but explains why it can't be linked", async () => {
        const id = await createOverdraft({ openingUsed: 0, openingUsedAsOf: "2026-10-08" });
        const transferIn = addTransaction({ type: "transfer", transferDirection: "IN", amount: 500_000, date: "2026-09-15" });

        expect((await new LoanTransactionLinkService().getLinkOptions(transferIn)).overdrafts).toEqual([
            expect.objectContaining({ loanId: id, refusal: expect.stringContaining("on or before 2026-10-08") }),
        ]);
    });

    it("a transfer on a bank account the OD is not linked to: the OD is listed, but refuses it with both accounts named", async () => {
        const id = await createOverdraft({ openingUsedAsOf: "2026-01-31" });
        const elsewhere = addTransaction({ type: "transfer", transferDirection: "IN", amount: 500_000, date: "2026-09-15", accountId: OTHER_BANK });

        expect(await new LoanTransactionLinkService().getLinkOptions(elsewhere)).toMatchObject({
            refusal: null,
            overdrafts: [{
                loanId: id,
                refusal: "This transaction is on Savings, which is not one of ABC Overdraft's linked bank accounts (Operating Account). Its Used amount counts only movements on those accounts. If Savings really belongs to ABC Overdraft, add it to the overdraft's bank accounts in Edit Loan first - it is never added automatically.",
            }],
        });
        await expect(link(elsewhere, id, DRAWDOWN)).rejects.toThrow("linked bank accounts");
        expect(linksOf(id)).toEqual([]);
    });

    it("the Link dialog offers the OD with only the kinds the direction allows", async () => {
        const id = await createOverdraft();
        const credit = addTransaction({ type: "income", amount: 1_000, date: "2026-07-05" });
        const debit = addTransaction({ type: "expense", amount: 1_000, date: "2026-07-05" });
        const service = new LoanTransactionLinkService();

        expect(await service.getLinkOptions(credit)).toMatchObject({
            refusal: null, loans: [],
            overdrafts: [{ loanId: id, loanName: "ABC Overdraft", loanType: "Overdraft", kinds: [DRAWDOWN], refusal: null }],
        });
        expect((await service.getLinkOptions(debit)).overdrafts).toEqual([
            { loanId: id, loanName: "ABC Overdraft", loanType: "Overdraft", kinds: [REPAYMENT, INTEREST_CHARGE], refusal: null },
        ]);
    });
});

describe("Overdraft - one source of truth across screens, and persistence", () => {
    it("P. the Loans list, the OD position and the Accounts list show the same Used amount", async () => {
        const id = await createOverdraft();
        await link(addTransaction({ type: "income", amount: 700_000, date: "2026-07-05" }), id, DRAWDOWN);
        await link(addTransaction({ type: "expense", amount: 200_000, date: "2026-07-06" }), id, REPAYMENT);

        const loan = (await new LoanService().getAll()).find(item => item.id === id)!;
        const account = (await new AccountRepository().getById(loan.loanAccountId!))!;

        expect((await position(id)).used).toBe(2_500_000);
        expect(loan.outstandingPrincipal).toBe(2_500_000);
        expect(account.openingBalance).toBe(-2_500_000);
    });

    it("restart: nothing is cached - fresh services read the same position from the database", async () => {
        const id = await createOverdraft();
        await link(addTransaction({ type: "income", amount: 123_456.78, date: "2026-07-05" }), id, DRAWDOWN);
        const first = await position(id);

        // No stored balance moved: the loan row still holds no OD usage.
        expect(all("SELECT outstanding_principal FROM loans WHERE id = ?", id)[0]).toEqual({ outstanding_principal: 0 });
        expect(await position(id)).toEqual(first);
        expect(first.used).toBe(2_123_456.78);
    });

    it("an OD can't be closed while any of its limit is used; it can once it is fully repaid", async () => {
        const id = await createOverdraft({ openingUsed: 100_000 });
        const service = new LoanService();
        const update = async (status: "CLOSED") =>
            await service.update({ ...overdraftRequestFromValues(odValues({ openingUsed: 100_000, status })), id });

        await expect(update("CLOSED")).rejects.toThrow("can't be marked Closed");

        await link(addTransaction({ type: "expense", amount: 100_000, date: "2026-07-05" }), id, REPAYMENT);
        await update("CLOSED");
        expect((await new LoanRepository().getById(id))!.status).toBe("CLOSED");
    });

    it("editing an OD keeps it an OD and changes only its own terms", async () => {
        const id = await createOverdraft();
        await new LoanService().update({ ...overdraftRequestFromValues(odValues({ creditLimit: 6_000_000 })), id, loanKind: LoanKind.TERM_LOAN });

        const loan = (await new LoanRepository().getById(id))!;
        expect(loan).toMatchObject({ loanKind: LoanKind.OVERDRAFT, creditLimit: 6_000_000, principalAmount: 0, tenureMonths: null });
        expect(await position(id)).toMatchObject({ available: 4_000_000 });
    });

    it("an OD with linked transactions can't be deleted; once unlinked it can", async () => {
        const id = await createOverdraft();
        const drawdown = addTransaction({ type: "income", amount: 1_000, date: "2026-07-05" });
        await link(drawdown, id, DRAWDOWN);

        await expect(new LoanService().delete(id)).rejects.toThrow("Unlink them first");

        await new LoanTransactionLinkService().unlink(drawdown);
        await new LoanService().delete(id);
        expect(await new LoanRepository().getById(id)).toBeNull();
        expect(all("SELECT id FROM transactions WHERE id = ? AND deleted_at IS NULL", drawdown)).toHaveLength(1);
    });
});

describe("Overdraft - statement import", () => {
    // The user's first manual link teaches the pattern.
    async function teach(id: string) {
        await importStatement([
            { transactionDate: "2026-07-05", amount: 200_000, description: REPAY_NARRATION("000111") },
            { transactionDate: "2026-07-06", amount: 300_000, type: "income", description: DRAW_NARRATION("000222") },
        ]);
        await link(importedId("2026-07-05", 200_000), id, REPAYMENT);
        await link(importedId("2026-07-06", 300_000), id, DRAWDOWN);
    }

    it("I/R. with no learned pattern, a transaction naming the OD goes to review - never guessed; others are ignored", async () => {
        const id = await createOverdraft();

        const batch = await importStatement([
            { transactionDate: "2026-07-05", amount: 200_000, description: REPAY_NARRATION("000111") },
            { transactionDate: "2026-07-06", amount: 950, description: "UPI SWIGGY BANGALORE" },
        ]);

        expect(linksOf(id)).toHaveLength(0);
        expect(batch.loanPayments?.overdraftApplied).toBeUndefined();
        expect(batch.loanPayments?.needsReview).toEqual([
            expect.objectContaining({ amount: 200_000, loanNames: ["ABC Overdraft"], overdraft: true, reason: expect.stringContaining("no transaction like it has been linked yet") }),
        ]);
        expect(await position(id)).toMatchObject({ used: 2_000_000 });
    });

    it("J. learned pattern: next month's repayment and drawdown are linked automatically, whatever the amount", async () => {
        const id = await createOverdraft();
        await teach(id);
        expect(await position(id)).toMatchObject({ used: 2_100_000 });

        const batch = await importStatement([
            { transactionDate: "2026-08-05", amount: 150_000, description: REPAY_NARRATION("000333") },
            { transactionDate: "2026-08-06", amount: 75_000, type: "income", description: DRAW_NARRATION("000444") },
        ]);

        expect(linksOf(id).map(link => `${link.entry_kind} ${link.link_source}`).sort()).toEqual([
            "DRAWDOWN IMPORT", "DRAWDOWN MANUAL", "REPAYMENT IMPORT", "REPAYMENT MANUAL",
        ]);
        // 20,00,000 - 2,00,000 + 3,00,000 - 1,50,000 + 75,000
        expect(await position(id)).toMatchObject({ used: 2_025_000, available: 2_975_000, totalRepayments: 350_000, totalDrawdowns: 375_000 });
        expect(batch.loanPayments?.overdraftApplied).toEqual([
            expect.objectContaining({ loanName: "ABC Overdraft", entryKind: REPAYMENT, amount: 150_000 }),
            expect.objectContaining({ loanName: "ABC Overdraft", entryKind: DRAWDOWN, amount: 75_000 }),
        ]);
        expect(batch.loanPayments?.needsReview).toEqual([]);
        expect(describeLoanImportPayments(batch.loanPayments)).toBe(
            " 2 overdraft transactions were linked automatically (ABC Overdraft repayment; ABC Overdraft drawdown)."
        );
        // The imported transaction is the record - no second one is created.
        expect(all("SELECT id FROM transactions WHERE deleted_at IS NULL")).toHaveLength(4);
    });

    it("an automatic match does not teach: only the user's own links do", async () => {
        const id = await createOverdraft();
        sqlite.db!.prepare(
            "INSERT INTO overdraft_transaction_links (id, loan_id, transaction_id, entry_kind, link_source) VALUES ('l1', ?, ?, 'REPAYMENT', 'IMPORT')"
        ).run(id, addTransaction({ type: "expense", amount: 1, date: "2026-07-01", narration: REPAY_NARRATION("000001") }));

        const batch = await importStatement([{ transactionDate: "2026-08-05", amount: 150_000, description: REPAY_NARRATION("000333") }]);

        expect(batch.loanPayments?.overdraftApplied).toBeUndefined();
        expect(batch.loanPayments?.needsReview).toHaveLength(1);
    });

    it("L. a credit is never matched by a repayment pattern (direction is part of the pattern)", async () => {
        const id = await createOverdraft();
        await importStatement([{ transactionDate: "2026-07-05", amount: 200_000, description: REPAY_NARRATION("000111") }]);
        await link(importedId("2026-07-05", 200_000), id, REPAYMENT);

        await importStatement([{ transactionDate: "2026-08-05", amount: 200_000, type: "income", description: REPAY_NARRATION("000999") }]);

        expect(linksOf(id)).toHaveLength(1);
        expect(await position(id)).toMatchObject({ used: 1_800_000 });
    });

    it("K. two ODs that learned the same pattern: no automatic assignment, sent to review", async () => {
        const first = await createOverdraft();
        const second = await createOverdraft({ name: "ABC Overdraft II" });
        await importStatement([
            { transactionDate: "2026-07-05", amount: 200_000, description: REPAY_NARRATION("000111") },
            { transactionDate: "2026-07-07", amount: 90_000, description: REPAY_NARRATION("000112") },
        ]);
        await link(importedId("2026-07-05", 200_000), first, REPAYMENT);
        await link(importedId("2026-07-07", 90_000), second, REPAYMENT);

        const batch = await importStatement([{ transactionDate: "2026-08-05", amount: 150_000, description: REPAY_NARRATION("000333") }]);

        expect(linksOf(first)).toHaveLength(1);
        expect(linksOf(second)).toHaveLength(1);
        expect(batch.loanPayments?.needsReview).toEqual([
            expect.objectContaining({ amount: 150_000, overdraft: true, reason: expect.stringContaining("more than one overdraft") }),
        ]);
    });

    it("K. a pattern linked both as a repayment and as interest is ambiguous: review", async () => {
        const id = await createOverdraft();
        await importStatement([
            { transactionDate: "2026-07-05", amount: 200_000, description: REPAY_NARRATION("000111") },
            { transactionDate: "2026-07-31", amount: 17_500, description: REPAY_NARRATION("000112") },
        ]);
        await link(importedId("2026-07-05", 200_000), id, REPAYMENT);
        await link(importedId("2026-07-31", 17_500), id, INTEREST_CHARGE);

        const batch = await importStatement([{ transactionDate: "2026-08-05", amount: 150_000, description: REPAY_NARRATION("000333") }]);

        expect(linksOf(id)).toHaveLength(2);
        expect(batch.loanPayments?.needsReview[0]?.reason).toContain("as Repayment and as Interest / Charge");
    });

    it("M. re-importing the same statement never counts a movement twice", async () => {
        const id = await createOverdraft();
        await teach(id);
        const rows = [{ transactionDate: "2026-08-05", amount: 150_000, description: REPAY_NARRATION("000333") }];

        await importStatement(rows);
        const after = await position(id);
        await importStatement(rows);

        expect(await position(id)).toEqual(after);
        expect(linksOf(id)).toHaveLength(3);
    });

    it("an imported movement on or before the opening date goes to review, not into Used", async () => {
        const id = await createOverdraft({ openingUsedAsOf: "2026-07-31" });
        await importStatement([{ transactionDate: "2026-08-05", amount: 200_000, description: REPAY_NARRATION("000111") }]);
        await link(importedId("2026-08-05", 200_000), id, REPAYMENT);

        const batch = await importStatement([{ transactionDate: "2026-07-20", amount: 150_000, description: REPAY_NARRATION("000333") }]);

        expect(linksOf(id)).toHaveLength(1);
        expect(batch.loanPayments?.needsReview[0]?.reason).toContain("opening used amount");
    });
});

describe("Overdraft alongside Term Loans - no regression", () => {
    // A Term Loan exactly as LoanService creates it.
    function seedTermLoan(): string {
        const schedule = new EMIScheduleGenerator().generate({
            loanId: "term-1", principalAmount: 500000, interestRate: 9, interestType: "REDUCING",
            tenureMonths: 24, emiAmount: 22842.47, startDate: "2026-06-10", firstInstallmentAmount: null,
        });
        insert("institutions", { id: "inst-contoso", name: "Contoso Bank", type: "BANK" });
        insert("loans", {
            id: "term-1", account_id: BANK, lender_institution_id: "inst-contoso", loan_type: "Car Loan", name: "Car Loan",
            principal_amount: 500000, interest_rate: 9, interest_type: "REDUCING", tenure_months: 24, emi_amount: 22842.47,
            start_date: "2026-06-10", outstanding_principal: 500000, outstanding_interest: 48218.28, paid_installments: 0,
            currency_id: "cur-inr", status: "ACTIVE",
        });
        for (const row of schedule) {
            insert("loan_payment_schedule", {
                id: row.id, loan_id: "term-1", installment_number: row.installmentNumber, due_date: row.dueDate,
                principal_amount: row.principalAmount, interest_amount: row.interestAmount, total_amount: row.totalAmount,
                outstanding_principal: row.outstandingPrincipal, status: row.status,
            });
        }
        return "term-1";
    }

    it("N/O. an existing Term Loan stays a Term Loan with its stored balances; its EMI is still matched on import", async () => {
        const term = seedTermLoan();
        const od = await createOverdraft();
        await teach(od);
        const loanRowBefore = all("SELECT loan_kind, credit_limit, opening_used FROM loans WHERE id = ?", term)[0];
        expect(loanRowBefore).toEqual({ loan_kind: "TERM_LOAN", credit_limit: null, opening_used: null });

        const batch = await importStatement([
            { transactionDate: "2026-07-10", amount: 22842.47, payee: "Contoso Bank", description: "NACH DR CONTOSO BANK LTD 88213" },
            { transactionDate: "2026-08-05", amount: 150_000, description: REPAY_NARRATION("000333") },
        ]);

        expect(batch.loanPayments?.applied).toEqual([
            expect.objectContaining({ loanName: "Car Loan", installmentNumber: 1, installmentStatus: "PAID" }),
        ]);
        expect(batch.loanPayments?.overdraftApplied).toEqual([expect.objectContaining({ loanName: "ABC Overdraft", entryKind: REPAYMENT })]);
        expect((await new LoanRepository().getById(term))!.loanKind).toBe(LoanKind.TERM_LOAN);
        expect(linksOf(od).map(link => link.transaction_id)).not.toContain(importedId("2026-07-10", 22842.47));

        async function teach(id: string) {
            await importStatement([{ transactionDate: "2026-07-05", amount: 200_000, description: REPAY_NARRATION("000111") }]);
            await link(importedId("2026-07-05", 200_000), id, REPAYMENT);
        }
    });

    it("an OD is never sent through EMI matching", async () => {
        const od = await createOverdraft();

        const batch = await importStatement([{ transactionDate: "2026-07-05", amount: 200_000, description: REPAY_NARRATION("000111") }]);

        expect(all("SELECT * FROM loan_schedule_payments")).toHaveLength(0);
        expect(batch.loanPayments?.needsReview.map(item => item.reason).join(" ")).not.toMatch(/instalment|EMI/);
        expect(linksOf(od)).toHaveLength(0);
    });

    it("a transaction both a Term Loan and an OD claim is applied to neither: review", async () => {
        seedTermLoan();
        const od = await createOverdraft({ name: "Contoso Overdraft", lenderInstitutionName: "Contoso Bank" });
        await importStatement([{ transactionDate: "2026-07-01", amount: 5_000, payee: "Contoso Bank", description: "NACH DR CONTOSO BANK LTD 88213" }]);
        await link(importedId("2026-07-01", 5_000), od, REPAYMENT);

        const batch = await importStatement([
            { transactionDate: "2026-07-10", amount: 22842.47, payee: "Contoso Bank", description: "NACH DR CONTOSO BANK LTD 88213" },
        ]);

        expect(all("SELECT * FROM loan_schedule_payments")).toHaveLength(0);
        expect(linksOf(od)).toHaveLength(1);
        expect(batch.loanPayments?.needsReview).toEqual([
            expect.objectContaining({ amount: 22842.47, reason: expect.stringContaining("more than one loan") }),
        ]);
    });

    it("a Term Loan's EMI-only linking is unchanged where no OD exists: money in is never an EMI", async () => {
        const term = seedTermLoan();
        const credit = addTransaction({ type: "income", amount: 1_000, date: "2026-07-05" });
        const o = await new LoanTransactionLinkService().getLinkOptions(credit);
        expect(o.overdrafts).toEqual([]);
        expect(o.loans).toEqual([expect.objectContaining({ loanId: term, refusal: expect.stringContaining("outgoing") })]);
    });

    it("2. Term Loan + Bank Transfer / Internet & Telecom: never a Link to Loan EMI option, never matched on import", async () => {
        seedTermLoan();
        insert("categories", { id: "cat-telecom", name: "Internet & Telecom", category_type: "EXPENSE", finance_scope: "BOTH" });
        const debit = addTransaction({ type: "expense", amount: 22842.47, date: "2026-07-10", categoryId: "cat-telecom" });

        expect(await new LoanTransactionLinkService().getLinkOptions(debit)).toMatchObject({ loans: [], refusal: expect.stringContaining("loan category") });

        // The exact EMI, naming the lender - but not in a loan category.
        const batch = await importStatement([
            { transactionDate: "2026-07-10", amount: 22842.47, payee: "Contoso Bank", description: "NACH DR CONTOSO BANK LTD 88213", categoryId: "cat-telecom" },
        ]);
        expect(batch.loanPayments?.applied ?? []).toEqual([]);
        expect(batch.loanPayments?.needsReview ?? []).toEqual([]);
        expect(all("SELECT * FROM loan_schedule_payments")).toHaveLength(0);
    });

    it("1. Term Loan + Loan Installment: offered for Link to Loan EMI", async () => {
        const term = seedTermLoan();
        const debit = addTransaction({ type: "expense", amount: 22842.47, date: "2026-07-10" });

        expect(await new LoanTransactionLinkService().getLinkOptions(debit)).toMatchObject({
            refusal: null, loans: [expect.objectContaining({ loanId: term })],
        });
    });
});

describe("Overdraft with several linked bank accounts - one consolidated position", () => {
    const ACCT_3999 = "acct-netedge-3999";
    const ACCT_2790 = "acct-netedge-2790";
    const UNLINKED = "acct-unlinked";

    function addAccounts() {
        insert("accounts", { id: ACCT_3999, name: "Netedge Technology 3999", account_type: "CURRENT", opening_balance: 0 });
        insert("accounts", { id: ACCT_2790, name: "Netedge Technology 2790", account_type: "CURRENT", opening_balance: 0 });
        insert("accounts", { id: UNLINKED, name: "Personal Savings", account_type: "SAVINGS", opening_balance: 0 });
    }

    // The real TATA Capital OD's shape (fictional ids).
    const TATA = {
        name: "TATA Capital", lenderInstitutionName: "TATA Capital", creditLimit: 12_500_000, openingUsed: 0,
        startDate: "2026-01-31", openingUsedAsOf: "2026-01-31", accountIds: [ACCT_3999, ACCT_2790],
    };

    async function editAccounts(id: string, accountIds: string[]) {
        await new LoanService().update({ ...overdraftRequestFromValues(odValues({ ...TATA, accountIds })), id });
    }

    it("stores every linked account and reads them back", async () => {
        addAccounts();
        const id = await createOverdraft(TATA);

        expect((await new LoanRepository().getById(id))!.linkedAccountIds!.slice().sort()).toEqual([ACCT_2790, ACCT_3999].sort());
        expect(all("SELECT COUNT(*) AS n FROM overdraft_accounts WHERE loan_id = ?", id)[0]).toEqual({ n: 2 });
    });

    it("drawdowns and repayments from account A and account B all move ONE Used / Available / Utilization", async () => {
        addAccounts();
        const id = await createOverdraft(TATA);

        await link(addTransaction({ type: "income", amount: 100_000, date: "2026-09-01", accountId: ACCT_3999 }), id, DRAWDOWN);
        await link(addTransaction({ type: "expense", amount: 50_000, date: "2026-09-02", accountId: ACCT_3999 }), id, REPAYMENT);
        await link(addTransaction({ type: "income", amount: 250_000, date: "2026-09-03", accountId: ACCT_2790 }), id, DRAWDOWN);
        await link(addTransaction({ type: "expense", amount: 100_000, date: "2026-09-04", accountId: ACCT_2790 }), id, REPAYMENT);

        expect(await position(id)).toMatchObject({
            used: 200_000, available: 12_300_000, utilizationPercent: 1.6,
            totalDrawdowns: 350_000, totalRepayments: 150_000, status: "PARTLY_USED",
        });
        // One position for the facility - never one per bank account.
        expect(all("SELECT COUNT(*) AS n FROM overdraft_transaction_links WHERE loan_id = ?", id)[0]).toEqual({ n: 4 });
    });

    it("the real September shape: Transfer In / Out rows from BOTH 3999 and 2790 feed the same TATA Capital OD", async () => {
        addAccounts();
        const id = await createOverdraft(TATA);
        const rows: Array<[string, "IN" | "OUT", number, string]> = [
            [ACCT_3999, "IN", 62_000, "2026-09-01"], [ACCT_3999, "IN", 50_000, "2026-09-02"],
            [ACCT_3999, "OUT", 100_000, "2026-09-07"], [ACCT_3999, "IN", 100_000, "2026-09-10"],
            [ACCT_2790, "OUT", 150_000, "2026-09-10"], [ACCT_2790, "IN", 25_000, "2026-09-12"],
            [ACCT_2790, "IN", 500_000, "2026-09-15"], [ACCT_2790, "IN", 50_000, "2026-09-15"],
            [ACCT_2790, "IN", 250_000, "2026-09-16"], [ACCT_2790, "OUT", 100_000, "2026-09-23"],
        ];
        const service = new LoanTransactionLinkService();

        for (const [accountId, direction, amount, date] of rows) {
            const txn = addTransaction({ type: "transfer", transferDirection: direction, amount, date, accountId, narration: "TATA CAPITAL (OD)" });
            const options = await service.getLinkOptions(txn);
            expect(options.overdrafts).toEqual([
                expect.objectContaining({ loanId: id, loanName: "TATA Capital", refusal: null, kinds: direction === "IN" ? [DRAWDOWN] : [REPAYMENT, INTEREST_CHARGE] }),
            ]);
            await link(txn, id, direction === "IN" ? DRAWDOWN : REPAYMENT);
        }

        // Drawdowns 10,37,000 - repayments 3,50,000 = 6,87,000 used.
        expect(await position(id)).toMatchObject({
            limit: 12_500_000, used: 687_000, available: 11_813_000, utilizationPercent: 5.5,
            totalDrawdowns: 1_037_000, totalRepayments: 350_000, status: "PARTLY_USED",
        });
        const loan = (await new LoanService().getAll()).find(item => item.id === id)!;
        expect(loan.outstandingPrincipal).toBe(687_000);
        expect((await new AccountRepository().getById(loan.loanAccountId!))!.openingBalance).toBe(-687_000);
    });

    it("a transaction on an account the OD is not linked to can never be linked or counted (the OD is listed, refusing it)", async () => {
        addAccounts();
        const id = await createOverdraft(TATA);
        const elsewhere = addTransaction({ type: "income", amount: 10_000, date: "2026-09-01", accountId: UNLINKED });

        expect((await new LoanTransactionLinkService().getLinkOptions(elsewhere)).overdrafts).toEqual([
            expect.objectContaining({ loanId: id, refusal: expect.stringContaining("is not one of TATA Capital's linked bank accounts") }),
        ]);
        await expect(link(elsewhere, id, DRAWDOWN)).rejects.toThrow("linked bank accounts");
        expect(linksOf(id)).toEqual([]);
    });

    it("adding another account (Edit OD) makes its transactions linkable; nothing else changes", async () => {
        addAccounts();
        const id = await createOverdraft({ ...TATA, accountIds: [ACCT_3999] });
        const on2790 = addTransaction({ type: "income", amount: 500_000, date: "2026-09-15", accountId: ACCT_2790 });
        await expect(link(on2790, id, DRAWDOWN)).rejects.toThrow("linked bank accounts");

        await editAccounts(id, [ACCT_3999, ACCT_2790]);

        await link(on2790, id, DRAWDOWN);
        expect(await position(id)).toMatchObject({ used: 500_000 });
    });

    it("an account can be unlinked from the OD only when none of its transactions are linked to it", async () => {
        addAccounts();
        const id = await createOverdraft(TATA);
        const on2790 = addTransaction({ type: "income", amount: 500_000, date: "2026-09-15", accountId: ACCT_2790 });
        await link(on2790, id, DRAWDOWN);

        await expect(editAccounts(id, [ACCT_3999])).rejects.toThrow("Unlink them first");
        expect((await new LoanRepository().getById(id))!.linkedAccountIds!.slice().sort()).toEqual([ACCT_2790, ACCT_3999].sort());
        expect(await position(id)).toMatchObject({ used: 500_000, status: "PARTLY_USED" });

        await new LoanTransactionLinkService().unlink(on2790);
        await editAccounts(id, [ACCT_3999]);
        expect((await new LoanRepository().getById(id))!.linkedAccountIds).toEqual([ACCT_3999]);
        expect((await new LoanTransactionLinkService().getLinkOptions(on2790)).overdrafts).toEqual([
            expect.objectContaining({ loanId: id, refusal: expect.stringContaining("is not one of TATA Capital's linked bank accounts") }),
        ]);
    });

    it("an OD needs at least one linked account", async () => {
        addAccounts();
        const id = await createOverdraft(TATA);
        await expect(editAccounts(id, [])).rejects.toThrow("at least one bank account");
    });

    it("the opening date applies to every linked account", async () => {
        addAccounts();
        const id = await createOverdraft({ ...TATA, openingUsedAsOf: "2026-09-10" });

        await expect(link(addTransaction({ type: "income", amount: 1, date: "2026-09-10", accountId: ACCT_3999 }), id, DRAWDOWN)).rejects.toThrow("opening used amount");
        await expect(link(addTransaction({ type: "income", amount: 1, date: "2026-09-01", accountId: ACCT_2790 }), id, DRAWDOWN)).rejects.toThrow("opening used amount");
        await link(addTransaction({ type: "income", amount: 1, date: "2026-09-11", accountId: ACCT_2790 }), id, DRAWDOWN);
        expect(await position(id)).toMatchObject({ used: 1 });
    });

    it("import: a pattern the user taught on one linked account is recognised on the other, but never on an unlinked account", async () => {
        addAccounts();
        const id = await createOverdraft(TATA);
        await importStatement([{ transactionDate: "2026-09-05", amount: 200_000, description: REPAY_NARRATION("000111") }], ACCT_3999);
        await link(importedId("2026-09-05", 200_000), id, REPAYMENT);

        const fromB = await importStatement([{ transactionDate: "2026-10-05", amount: 150_000, description: REPAY_NARRATION("000222") }], ACCT_2790);
        const fromA = await importStatement([{ transactionDate: "2026-10-06", amount: 90_000, description: REPAY_NARRATION("000333") }], ACCT_3999);
        const unlinked = await importStatement([{ transactionDate: "2026-10-07", amount: 70_000, description: REPAY_NARRATION("000444") }], UNLINKED);

        expect(fromB.loanPayments?.overdraftApplied).toEqual([expect.objectContaining({ loanName: "TATA Capital", entryKind: REPAYMENT, amount: 150_000 })]);
        expect(fromA.loanPayments?.overdraftApplied).toEqual([expect.objectContaining({ entryKind: REPAYMENT, amount: 90_000 })]);
        expect(unlinked.loanPayments?.overdraftApplied).toBeUndefined();
        // 0 - 2,00,000 - 1,50,000 - 90,000: more repaid than used -> Needs Review, never hidden.
        expect(await position(id)).toMatchObject({ used: -440_000, totalRepayments: 440_000, status: "NEEDS_REVIEW" });
    });

    it("import: drawdowns from both accounts, each counted once even when re-imported", async () => {
        addAccounts();
        const id = await createOverdraft(TATA);
        await importStatement([{ transactionDate: "2026-09-15", amount: 500_000, type: "income", description: DRAW_NARRATION("000111") }], ACCT_2790);
        await link(importedId("2026-09-15", 500_000), id, DRAWDOWN);

        const statement = [{ transactionDate: "2026-10-01", amount: 62_000, type: "income" as const, description: DRAW_NARRATION("000222") }];
        await importStatement(statement, ACCT_3999);
        await importStatement(statement, ACCT_3999);

        expect(await position(id)).toMatchObject({ used: 562_000, totalDrawdowns: 562_000 });
        expect(all("SELECT COUNT(*) AS n FROM overdraft_transaction_links WHERE loan_id = ?", id)[0]).toEqual({ n: 2 });
    });

    it("two ODs sharing an account that both learned the pattern: review, not a guess", async () => {
        addAccounts();
        const first = await createOverdraft(TATA);
        const second = await createOverdraft({ ...TATA, name: "TATA Capital II", accountIds: [ACCT_2790] });
        await importStatement([
            { transactionDate: "2026-09-05", amount: 200_000, description: REPAY_NARRATION("000111") },
            { transactionDate: "2026-09-06", amount: 100_000, description: REPAY_NARRATION("000112") },
        ], ACCT_2790);
        await link(importedId("2026-09-05", 200_000), first, REPAYMENT);
        await link(importedId("2026-09-06", 100_000), second, REPAYMENT);

        const batch = await importStatement([{ transactionDate: "2026-10-05", amount: 150_000, description: REPAY_NARRATION("000333") }], ACCT_2790);

        expect(batch.loanPayments?.overdraftApplied).toBeUndefined();
        expect(batch.loanPayments?.needsReview[0]?.reason).toContain("more than one overdraft");
    });
});

describe("Loan linking - strict category gate", () => {
    const BANK_TRANSFER = "cat-bank-transfer";
    const TELECOM = "cat-telecom";

    function addCategories() {
        insert("categories", { id: BANK_TRANSFER, name: "Bank Transfer", category_type: "TRANSFER", finance_scope: "BOTH" });
        insert("categories", { id: TELECOM, name: "Internet & Telecom", category_type: "EXPENSE", finance_scope: "BOTH" });
    }

    it("OD + Bank Transfer: not offered and can't be linked, in either direction", async () => {
        addCategories();
        const id = await createOverdraft({ openingUsedAsOf: "2026-01-31" });
        const drawdown = addTransaction({ type: "transfer", transferDirection: "IN", amount: 500_000, date: "2026-09-15", categoryId: BANK_TRANSFER });
        const repayment = addTransaction({ type: "transfer", transferDirection: "OUT", amount: 100_000, date: "2026-09-23", categoryId: BANK_TRANSFER });
        const service = new LoanTransactionLinkService();

        for (const txn of [drawdown, repayment]) {
            expect(await service.getLinkOptions(txn)).toMatchObject({ overdrafts: [], loans: [], refusal: expect.stringContaining("loan category") });
        }
        await expect(link(drawdown, id, DRAWDOWN)).rejects.toThrow("loan category");
        expect(linksOf(id)).toHaveLength(0);
        expect(await position(id)).toMatchObject({ used: 2_000_000 });
    });

    it("8. TATA Play in Internet & Telecom on the OD's account: no review item, no link - although TATA appears in both", async () => {
        addCategories();
        const id = await createOverdraft({ name: "TATA Capital", lenderInstitutionName: "TATA Capital" });

        const batch = await importStatement([
            { transactionDate: "2026-09-23", amount: 732, payee: "Tata Play", description: "UPI/110742500149/To:tataplayltd.bdsi@icici/MandateRequest", categoryId: TELECOM },
            { transactionDate: "2026-09-24", amount: 100_000, payee: "TATA CAPITAL (OD)", description: "NBSM/100000001/TATA CAPITAL LTD/", categoryId: BANK_TRANSFER },
        ]);

        expect(batch.loanPayments?.needsReview ?? []).toEqual([]);
        expect(batch.loanPayments?.overdraftApplied).toBeUndefined();
        expect(linksOf(id)).toHaveLength(0);
    });

    it("the same TATA debit in Loan Installment IS considered (review, as nothing is learned yet)", async () => {
        const id = await createOverdraft({ name: "TATA Capital", lenderInstitutionName: "TATA Capital" });

        const batch = await importStatement([
            { transactionDate: "2026-09-24", amount: 100_000, payee: "TATA CAPITAL (OD)", description: "NBSM/100000001/TATA CAPITAL LTD/" },
        ]);

        expect(batch.loanPayments?.needsReview).toEqual([expect.objectContaining({ loanNames: ["TATA Capital"], overdraft: true })]);
        expect(linksOf(id)).toHaveLength(0);
    });

    it("a learned OD pattern never auto-links a transaction outside the loan categories", async () => {
        addCategories();
        const id = await createOverdraft();
        await importStatement([{ transactionDate: "2026-07-05", amount: 200_000, description: REPAY_NARRATION("000111") }]);
        await link(importedId("2026-07-05", 200_000), id, REPAYMENT);

        const batch = await importStatement([{ transactionDate: "2026-08-05", amount: 150_000, description: REPAY_NARRATION("000333"), categoryId: BANK_TRANSFER }]);

        expect(batch.loanPayments?.overdraftApplied).toBeUndefined();
        expect(linksOf(id)).toHaveLength(1);
    });

    it("6. Loan Installment -> Internet & Telecom: no longer linkable; 7. and back: linkable again, but no link is created", async () => {
        addCategories();
        const id = await createOverdraft();
        const txn = addTransaction({ type: "expense", amount: 50_000, date: "2026-07-05" });
        const service = new LoanTransactionLinkService();
        expect((await service.getLinkOptions(txn)).refusal).toBeNull();

        await new TransactionService().update({ id: txn, categoryId: TELECOM });
        expect((await service.getLinkOptions(txn)).refusal).toContain("loan category");
        await expect(link(txn, id, REPAYMENT)).rejects.toThrow("loan category");

        await new TransactionService().update({ id: txn, categoryId: LOAN_CATEGORY });
        expect((await service.getLinkOptions(txn)).overdrafts).toEqual([expect.objectContaining({ loanId: id, refusal: null })]);
        expect(linksOf(id)).toHaveLength(0);
        expect(await position(id)).toMatchObject({ used: 2_000_000 });
    });

    it("an existing link is never removed by a category change - it stays linked and counted", async () => {
        addCategories();
        const id = await createOverdraft();
        const txn = addTransaction({ type: "expense", amount: 50_000, date: "2026-07-05" });
        await link(txn, id, REPAYMENT);

        await new TransactionService().update({ id: txn, categoryId: TELECOM });

        expect(linksOf(id)).toHaveLength(1);
        expect(await position(id)).toMatchObject({ used: 1_950_000 });
        // Shown as linked (with Unlink), never offered for a second link.
        expect((await new LoanTransactionLinkService().getLinkOptions(txn)).refusal).toContain("already linked");
        expect(await new LoanTransactionLinkService().getLinkDetails(txn)).toMatchObject({ loanName: "ABC Overdraft" });
    });
});

describe("Link Transaction to Loan - every loan is offered; the SELECTED loan decides the link", () => {
    // Fictional ids. TATA Capital OD linked only to Netedge 3999; a Term
    // Loan whose EMI payment account is a third account (Salary Account).
    const ACCT_3999 = "acct-netedge-3999";
    const ACCT_2790 = "acct-netedge-2790";
    const ACCT_TERM = "acct-term";
    const TATA = {
        name: "TATA Capital", lenderInstitutionName: "TATA Capital", creditLimit: 12_500_000, openingUsed: 0,
        startDate: "2026-01-31", openingUsedAsOf: "2026-01-31", accountIds: [ACCT_3999],
    };

    function addAccounts() {
        insert("accounts", { id: ACCT_3999, name: "Netedge Technology 3999", account_type: "CURRENT", opening_balance: 0 });
        insert("accounts", { id: ACCT_2790, name: "Netedge Technology 2790", account_type: "CURRENT", opening_balance: 0 });
        insert("accounts", { id: ACCT_TERM, name: "Salary Account", account_type: "SAVINGS", opening_balance: 0 });
    }

    function seedTermLoan(accountId: string, id = "term-1", name = "TATA Capital (Term)", status = "ACTIVE"): string {
        const schedule = new EMIScheduleGenerator().generate({
            loanId: id, principalAmount: 500000, interestRate: 9, interestType: "REDUCING",
            tenureMonths: 24, emiAmount: 22842.47, startDate: "2026-06-10", firstInstallmentAmount: null,
        });
        insert("loans", {
            id, account_id: accountId, loan_type: "Term Loan", name,
            principal_amount: 500000, interest_rate: 9, interest_type: "REDUCING", tenure_months: 24, emi_amount: 22842.47,
            start_date: "2026-06-10", outstanding_principal: 500000, outstanding_interest: 48218.28, paid_installments: 0,
            currency_id: "cur-inr", status,
        });
        for (const row of schedule) {
            insert("loan_payment_schedule", {
                id: `${id}-${row.installmentNumber}`, loan_id: id, installment_number: row.installmentNumber, due_date: row.dueDate,
                principal_amount: row.principalAmount, interest_amount: row.interestAmount, total_amount: row.totalAmount,
                outstanding_principal: row.outstandingPrincipal, status: row.status,
            });
        }
        return id;
    }

    async function facility(name: string, loanType: string, accountId: string): Promise<string> {
        const id = await createOverdraft({ ...TATA, name, lenderInstitutionName: `${name} Bank`, accountIds: [accountId] });
        sqlite.db!.prepare("UPDATE loans SET loan_type = ? WHERE id = ?").run(loanType, id);
        return id;
    }

    const options = (id: string) => new LoanTransactionLinkService().getLinkOptions(id);
    const txnRow = (id: string) => all("SELECT * FROM transactions WHERE id = ?", id)[0]!;
    const paymentsOf = () => all("SELECT loan_id, transaction_id, amount FROM loan_schedule_payments");
    const UNCHANGED = ["account_id", "amount", "transaction_date", "category_id", "subcategory_id", "type", "transfer_direction", "payee", "original_narration", "notes", "reference_number", "status"];

    it("lists ALL active loans of every type - Term Loan, Overdraft, Cash Credit, Dropline - whatever their accounts; nothing is preselected", async () => {
        addAccounts();
        const od = await createOverdraft(TATA);
        const cc = await facility("SBI CC", "Cash Credit", ACCT_2790);
        const dod = await facility("HDFC DOD", "Dropline Overdraft", ACCT_TERM);
        const term = seedTermLoan(ACCT_TERM);
        seedTermLoan(ACCT_2790, "term-closed", "Closed Car Loan", "CLOSED");
        const debit = addTransaction({ type: "expense", amount: 22842.47, date: "2026-07-10", accountId: ACCT_3999 });

        const o = await options(debit);
        expect(o.refusal).toBeNull();
        expect(Object.keys(o).sort()).toEqual(["loans", "overdrafts", "refusal", "transaction"]);
        expect(o.loans.map(loan => [loan.loanId, loan.loanType, loan.refusal])).toEqual([[term, "Term Loan", null]]);
        expect(o.overdrafts.map(item => [item.loanId, item.loanType]).sort()).toEqual(
            [[od, "Overdraft"], [cc, "Cash Credit"], [dod, "Dropline Overdraft"]].sort()
        );
        // Only the facility on the transaction's own account can take it; the others say why.
        expect(o.overdrafts.find(item => item.loanId === od)!.refusal).toBeNull();
        expect(o.overdrafts.find(item => item.loanId === cc)!.refusal).toContain("is not one of SBI CC's linked bank accounts");
        expect(o.overdrafts.find(item => item.loanId === dod)!.refusal).toContain("is not one of HDFC DOD's linked bank accounts");
        // Closed loans are not offered.
        expect([...o.loans, ...o.overdrafts].some(item => item.loanId === "term-closed")).toBe(false);
        expect(LINK_DIALOG_TITLE).toBe("Link Transaction to Loan");
    });

    it("the selected loan, not the transaction's account, decides the workflow", () => {
        expect(linkWorkflowFor("loan")).toBe("EMI");
        expect(linkWorkflowFor("overdraft")).toBe("OVERDRAFT");
        expect(linkWorkflowFor(null)).toBeNull();
    });

    it("a Term Loan instalment on the OD's account links to the Term Loan - payment accounts differ, no warning or confirmation", async () => {
        addAccounts();
        const od = await createOverdraft(TATA);
        const term = seedTermLoan(ACCT_TERM);
        const debit = addTransaction({ type: "expense", amount: 22842.47, date: "2026-07-10", accountId: ACCT_3999, narration: "NACH DR TATA CAPITAL LTD 88213" });
        const before = txnRow(debit);
        const transactionsBefore = all("SELECT COUNT(*) AS n FROM transactions")[0];

        const o = await options(debit);
        const loan = o.loans.find(item => item.loanId === term)!;
        expect(loan).toMatchObject({ refusal: null, loanType: "Term Loan" });
        expect(loan.installments[0]!.modes).toEqual(["full"]);

        const result = await new LoanTransactionLinkService().link({ transactionId: debit, loanId: term, scheduleId: loan.installments[0]!.scheduleId, mode: "full" });
        expect(result.schedule.installmentNumber).toBe(1);
        expect(paymentsOf()).toEqual([{ loan_id: term, transaction_id: debit, amount: 22842.47 }]);
        expect(all("SELECT status FROM loan_payment_schedule WHERE id = ?", loan.installments[0]!.scheduleId)[0]).toEqual({ status: "PAID" });

        // No new transaction; the linked one keeps every detail.
        expect(all("SELECT COUNT(*) AS n FROM transactions")[0]).toEqual(transactionsBefore);
        const after = txnRow(debit);
        for (const column of UNCHANGED) expect(after[column], column).toEqual(before[column]);
        // The loan's payment account is not changed; the OD is untouched.
        expect(all("SELECT account_id FROM loans WHERE id = ?", term)[0]).toEqual({ account_id: ACCT_TERM });
        expect(linksOf(od)).toEqual([]);
        expect(await position(od)).toMatchObject({ used: 0, available: 12_500_000 });
    });

    it("an OD transaction links to the OD: drawdown, repayment and interest move Used / Available exactly as before", async () => {
        addAccounts();
        const id = await createOverdraft({ ...TATA, accountIds: [ACCT_3999, ACCT_2790] });
        seedTermLoan(ACCT_TERM);
        const service = new LoanTransactionLinkService();

        const draw = addTransaction({ type: "income", amount: 500_000, date: "2026-09-01", accountId: ACCT_3999 });
        expect((await options(draw)).overdrafts.find(item => item.loanId === id)).toMatchObject({ kinds: [DRAWDOWN], refusal: null });
        await service.linkOverdraft({ transactionId: draw, loanId: id, entryKind: DRAWDOWN });
        expect(await position(id)).toMatchObject({ used: 500_000, available: 12_000_000 });

        const repay = addTransaction({ type: "expense", amount: 100_000, date: "2026-09-23", accountId: ACCT_2790 });
        const before = txnRow(repay);
        expect((await options(repay)).overdrafts.find(item => item.loanId === id)).toMatchObject({ kinds: [REPAYMENT, INTEREST_CHARGE], refusal: null });
        await service.linkOverdraft({ transactionId: repay, loanId: id, entryKind: REPAYMENT });
        expect(await position(id)).toMatchObject({ used: 400_000, available: 12_100_000 });
        for (const column of UNCHANGED) expect(txnRow(repay)[column], column).toEqual(before[column]);

        const interest = addTransaction({ type: "expense", amount: 2_500, date: "2026-09-30", accountId: ACCT_3999 });
        await service.linkOverdraft({ transactionId: interest, loanId: id, entryKind: INTEREST_CHARGE });
        expect(await position(id)).toMatchObject({ used: 400_000, available: 12_100_000, totalInterestCharges: 2_500 });
        expect(paymentsOf()).toEqual([]);
    });

    it("the selected loan's type decides the operation: an OD is never paid as an EMI, a Term Loan never takes an OD movement", async () => {
        addAccounts();
        const od = await createOverdraft(TATA);
        const term = seedTermLoan(ACCT_TERM);
        const debit = addTransaction({ type: "expense", amount: 22842.47, date: "2026-07-10", accountId: ACCT_3999 });
        const scheduleId = (await options(debit)).loans[0]!.installments[0]!.scheduleId;
        const service = new LoanTransactionLinkService();

        await expect(service.link({ transactionId: debit, loanId: od, scheduleId, mode: "full" })).rejects.toThrow("That loan is an overdraft");
        await expect(service.linkOverdraft({ transactionId: debit, loanId: term, entryKind: REPAYMENT })).rejects.toThrow("is not an overdraft");
        expect(paymentsOf()).toEqual([]);
        expect(linksOf(od)).toEqual([]);
    });

    describe("Issue 2: a Transfer Out can be a Term Loan EMI payment - and stays a Transfer Out", () => {
        it("a Transfer Out is offered to every Term Loan and linked as an EMI payment; its type, direction and details never change", async () => {
            addAccounts();
            const od = await createOverdraft(TATA);
            const term = seedTermLoan(ACCT_TERM);
            const transferOut = addTransaction({ type: "transfer", transferDirection: "OUT", amount: 22842.47, date: "2026-07-10", accountId: ACCT_2790, narration: "NEFT DR TATA CAPITAL EMI" });
            const before = txnRow(transferOut);
            const transactionsBefore = all("SELECT COUNT(*) AS n FROM transactions")[0];

            const o = await options(transferOut);
            const loan = o.loans.find(item => item.loanId === term)!;
            expect(loan).toMatchObject({ refusal: null });
            expect(loan.installments[0]!.modes).toEqual(["full"]);

            const result = await new LoanTransactionLinkService().link({ transactionId: transferOut, loanId: term, scheduleId: loan.installments[0]!.scheduleId, mode: "full" });
            expect(result.schedule.installmentNumber).toBe(1);
            expect(paymentsOf()).toEqual([{ loan_id: term, transaction_id: transferOut, amount: 22842.47 }]);
            expect(all("SELECT status FROM loan_payment_schedule WHERE id = ?", loan.installments[0]!.scheduleId)[0]).toEqual({ status: "PAID" });

            // Still a Transfer Out, with every other detail; no new transaction, nothing on the OD.
            expect(txnRow(transferOut)).toMatchObject({ type: "transfer", transfer_direction: "OUT" });
            for (const column of UNCHANGED) expect(txnRow(transferOut)[column], column).toEqual(before[column]);
            expect(all("SELECT COUNT(*) AS n FROM transactions")[0]).toEqual(transactionsBefore);
            expect(linksOf(od)).toEqual([]);

            // One transaction, one payment.
            expect((await options(transferOut)).refusal).toContain("already recorded as a payment of TATA Capital (Term)");
            await expect(new LoanTransactionLinkService().link({ transactionId: transferOut, loanId: term, scheduleId: "term-1-2", mode: "full" })).rejects.toThrow("already recorded");
            expect(paymentsOf()).toHaveLength(1);
        });

        it("a Transfer In, Income, or a Transfer with no recorded direction is never an EMI payment", async () => {
            addAccounts();
            const term = seedTermLoan(ACCT_TERM);
            const transferIn = addTransaction({ type: "transfer", transferDirection: "IN", amount: 22842.47, date: "2026-07-10", accountId: ACCT_TERM });
            const income = addTransaction({ type: "income", amount: 22842.47, date: "2026-07-10", accountId: ACCT_TERM });
            const noDirection = addTransaction({ type: "transfer", transferDirection: null, amount: 22842.47, date: "2026-07-10", accountId: ACCT_TERM });

            for (const txn of [transferIn, income, noDirection]) {
                const o = await options(txn);
                expect(o.loans, txn).toEqual([expect.objectContaining({ loanId: term, refusal: NOT_AN_EMI_PAYMENT_REASON, installments: [] })]);
                await expect(new LoanTransactionLinkService().link({ transactionId: txn, loanId: term, scheduleId: "term-1-1", mode: "full" }), txn).rejects.toThrow(NOT_AN_EMI_PAYMENT_REASON);
                await expect(
                    new LoanPaymentService().recordPaymentFromTransaction({ loanId: term, scheduleId: "term-1-1", transactionId: txn, fromAnyAccount: true }),
                    txn
                ).rejects.toThrow("Only an outgoing transaction (an Expense or a Transfer Out) can record a loan payment.");
            }
            expect(paymentsOf()).toEqual([]);
        });

        it("OD behaviour is unchanged: a Transfer Out on the OD's account is still a repayment there, a Transfer In a drawdown", async () => {
            addAccounts();
            const od = await createOverdraft(TATA);
            seedTermLoan(ACCT_TERM);
            const out = addTransaction({ type: "transfer", transferDirection: "OUT", amount: 100_000, date: "2026-09-23", accountId: ACCT_3999 });
            const into = addTransaction({ type: "transfer", transferDirection: "IN", amount: 300_000, date: "2026-09-20", accountId: ACCT_3999 });

            expect((await options(out)).overdrafts[0]).toMatchObject({ loanId: od, kinds: [REPAYMENT, INTEREST_CHARGE], refusal: null });
            expect((await options(into)).overdrafts[0]).toMatchObject({ loanId: od, kinds: [DRAWDOWN], refusal: null });
            await new LoanTransactionLinkService().linkOverdraft({ transactionId: into, loanId: od, entryKind: DRAWDOWN });
            await new LoanTransactionLinkService().linkOverdraft({ transactionId: out, loanId: od, entryKind: REPAYMENT });
            expect(await position(od)).toMatchObject({ used: 200_000 });
            expect(paymentsOf()).toEqual([]);
        });
    });

    it("money in: every Term Loan is listed but refuses it (never an EMI); the OD takes it as a drawdown", async () => {
        addAccounts();
        const od = await createOverdraft(TATA);
        const term = seedTermLoan(ACCT_3999);
        const credit = addTransaction({ type: "income", amount: 22842.47, date: "2026-07-10", accountId: ACCT_3999 });

        const o = await options(credit);
        expect(o.refusal).toBeNull();
        expect(o.loans).toEqual([expect.objectContaining({ loanId: term, refusal: NOT_AN_EMI_PAYMENT_REASON, installments: [] })]);
        await expect(new LoanTransactionLinkService().link({ transactionId: credit, loanId: term, scheduleId: "term-1-1", mode: "full" })).rejects.toThrow(
            NOT_AN_EMI_PAYMENT_REASON
        );
        expect(paymentsOf()).toEqual([]);

        await new LoanTransactionLinkService().linkOverdraft({ transactionId: credit, loanId: od, entryKind: DRAWDOWN });
        expect(linksOf(od)).toEqual([{ transaction_id: credit, entry_kind: "DRAWDOWN", link_source: "MANUAL" }]);
    });

    it("duplicate links stay impossible: once linked anywhere, it is refused everywhere until unlinked", async () => {
        addAccounts();
        const od = await createOverdraft(TATA);
        const term = seedTermLoan(ACCT_TERM);
        const service = new LoanTransactionLinkService();

        const first = addTransaction({ type: "expense", amount: 22842.47, date: "2026-07-10", accountId: ACCT_3999 });
        const scheduleId = (await options(first)).loans[0]!.installments[0]!.scheduleId;
        await service.link({ transactionId: first, loanId: term, scheduleId, mode: "full" });
        expect((await options(first)).refusal).toContain("already recorded as a payment of TATA Capital (Term)");
        await expect(service.link({ transactionId: first, loanId: term, scheduleId: "term-1-2", mode: "full" })).rejects.toThrow("already recorded");
        await expect(service.linkOverdraft({ transactionId: first, loanId: od, entryKind: REPAYMENT })).rejects.toThrow();

        const second = addTransaction({ type: "expense", amount: 100_000, date: "2026-09-23", accountId: ACCT_3999 });
        await service.linkOverdraft({ transactionId: second, loanId: od, entryKind: REPAYMENT });
        expect((await options(second)).refusal).toContain("already linked to TATA Capital");
        await expect(service.link({ transactionId: second, loanId: term, scheduleId: "term-1-2", mode: "partial" })).rejects.toThrow("already linked");

        expect(paymentsOf()).toHaveLength(1);
        expect(linksOf(od)).toHaveLength(1);
    });

    it("an OD selected for a transaction off its linked accounts is listed but refused - such a movement would never count towards Used", async () => {
        addAccounts();
        const id = await createOverdraft(TATA);
        const debit = addTransaction({ type: "expense", amount: 100_000, date: "2026-09-23", accountId: ACCT_2790, narration: "TATA CAPITAL (OD)" });

        const o = await options(debit);
        expect(o.refusal).toBeNull();
        expect(o.overdrafts[0]!.refusal).toBe(
            "This transaction is on Netedge Technology 2790, which is not one of TATA Capital's linked bank accounts (Netedge Technology 3999). Its Used amount counts only movements on those accounts. If Netedge Technology 2790 really belongs to TATA Capital, add it to the overdraft's bank accounts in Edit Loan first - it is never added automatically."
        );
        expect(canLinkOverdraftChoice({ saving: false, options: o, overdraft: o.overdrafts[0]!, entryKind: REPAYMENT })).toBe(false);

        await expect(link(debit, id, REPAYMENT)).rejects.toThrow("linked bank accounts");
        expect(linksOf(id)).toEqual([]);
        expect((await new LoanRepository().getById(id))!.linkedAccountIds).toEqual([ACCT_3999]);
        expect(await position(id)).toMatchObject({ used: 0, available: 12_500_000 });
    });

    it("automatic import matching still requires the loan's own payment account", async () => {
        addAccounts();
        const term = seedTermLoan(ACCT_TERM);
        const debit = addTransaction({ type: "expense", amount: 22842.47, date: "2026-07-10", accountId: ACCT_3999 });

        await expect(new LoanPaymentService().recordPaymentFromTransaction({ loanId: term, scheduleId: "term-1-1", transactionId: debit })).rejects.toThrow(
            "The transaction is not from this loan's payment account."
        );
        expect(paymentsOf()).toEqual([]);
    });

    it("with no active loan at all, it says so", async () => {
        addAccounts();
        seedTermLoan(ACCT_TERM, "term-closed", "Closed Car Loan", "CLOSED");
        const debit = addTransaction({ type: "expense", amount: 1_000, date: "2026-07-10", accountId: ACCT_2790 });

        expect(await options(debit)).toMatchObject({ loans: [], overdrafts: [], refusal: "There is no active loan to link this transaction to." });
    });

    it("Opening Used As Of after the transaction: offered as the OD, refused with the dates explained; the date is never changed", async () => {
        addAccounts();
        const id = await createOverdraft({ ...TATA, openingUsedAsOf: "2026-10-08" });
        const debit = addTransaction({ type: "expense", amount: 100_000, date: "2026-09-23", accountId: ACCT_3999 });

        const o = await options(debit);
        expect(o.overdrafts[0]!.refusal).toBe(
            "This transaction is dated 2026-09-23, on or before 2026-10-08 - TATA Capital's Opening Used As Of date - so it is treated as already part of the opening used amount and can't count towards Used. The overdraft started on 2026-01-31. If the opening used amount is really as of an earlier date, change Opening Used As Of in Edit Loan first."
        );
        await expect(link(debit, id, REPAYMENT)).rejects.toThrow("on or before 2026-10-08");
        expect((await new LoanRepository().getById(id))!.openingUsedAsOf).toBe("2026-10-08");
    });

    it("the five loan categories pass; Bank Transfer and ordinary categories are never offered any loan", async () => {
        addAccounts();
        const id = await createOverdraft(TATA);
        for (const [catId, name] of [
            ["cat-int", "Loan Interest"], ["cat-rec", "Loan Interest Recovered"],
            ["cat-prin", "Loan Principal Repayment"], ["cat-draw", "Loan Principal Drawdown"],
            ["cat-bank", "Bank Transfer"], ["cat-tel", "Internet & Telecom"], ["cat-office", "Office Expenses"],
        ]) {
            insert("categories", { id: catId, name, category_type: "EXPENSE", finance_scope: "BOTH" });
        }

        for (const categoryId of [LOAN_CATEGORY, "cat-int", "cat-rec", "cat-prin", "cat-draw"]) {
            const txn = addTransaction({ type: "expense", amount: 1_000, date: "2026-09-23", accountId: ACCT_3999, categoryId });
            expect(await options(txn)).toMatchObject({ refusal: null, overdrafts: [expect.objectContaining({ loanId: id, refusal: null })] });
        }

        for (const categoryId of ["cat-bank", "cat-tel", "cat-office", null]) {
            const txn = addTransaction({ type: "income", amount: 1_000, date: "2026-09-23", accountId: ACCT_3999, categoryId });
            expect(await options(txn)).toMatchObject({ loans: [], overdrafts: [], refusal: expect.stringContaining("loan category") });
            await expect(link(txn, id, DRAWDOWN)).rejects.toThrow("loan category");
        }
        expect(linksOf(id)).toEqual([]);
    });

    it("opening-date flow: refused while Opening Used As Of is 2026-10-08; linkable once the USER saves 2026-01-31 and reopens", async () => {
        addAccounts();
        const id = await createOverdraft({ ...TATA, openingUsedAsOf: "2026-10-08" });
        const debit = addTransaction({ type: "expense", amount: 250_000, date: "2026-09-16", accountId: ACCT_3999, narration: "RTGS/ICICR00000000000000001/TATA CAPITAL LIMITED/ICICI BANK LIMITED//URGENT/700000000000000001R01" });
        const onStart = addTransaction({ type: "expense", amount: 1_000, date: "2026-01-31", accountId: ACCT_3999 });
        const dayAfter = addTransaction({ type: "expense", amount: 1_000, date: "2026-02-01", accountId: ACCT_3999 });

        let o = await options(debit);
        let od = o.overdrafts[0]!;
        expect(od.refusal).toContain("on or before 2026-10-08");
        for (const entryKind of [REPAYMENT, INTEREST_CHARGE]) {
            expect(canLinkOverdraftChoice({ saving: false, options: o, overdraft: od, entryKind })).toBe(false);
        }

        // The user edits the OD (Edit Loan) - nothing else changes it.
        await new LoanService().update({ ...overdraftRequestFromValues(odValues({ ...TATA, openingUsedAsOf: "2026-01-31" })), id });
        expect((await new LoanRepository().getById(id))!).toMatchObject({ openingUsedAsOf: "2026-01-31", openingUsed: 0, linkedAccountIds: [ACCT_3999] });

        // Reopened: fresh options - no refusal; Link waits for the user's choice.
        o = await options(debit);
        od = o.overdrafts[0]!;
        expect(o.refusal).toBeNull();
        expect(od).toEqual({ loanId: id, loanName: "TATA Capital", loanType: "Overdraft", kinds: [REPAYMENT, INTEREST_CHARGE], refusal: null });
        expect(canLinkOverdraftChoice({ saving: false, options: o, overdraft: od, entryKind: null })).toBe(false);
        expect(canLinkOverdraftChoice({ saving: false, options: o, overdraft: od, entryKind: DRAWDOWN })).toBe(false);
        expect(canLinkOverdraftChoice({ saving: false, options: o, overdraft: od, entryKind: REPAYMENT })).toBe(true);
        expect(canLinkOverdraftChoice({ saving: false, options: o, overdraft: od, entryKind: INTEREST_CHARGE })).toBe(true);

        // The boundary: ON the opening date is still the opening amount; the day after counts.
        expect((await options(onStart)).overdrafts[0]!.refusal).toContain("on or before 2026-01-31");
        expect((await options(dayAfter)).overdrafts[0]!.refusal).toBeNull();

        expect(linksOf(id)).toEqual([]);
        expect(await position(id)).toMatchObject({ used: 0, available: 12_500_000 });

        // Only the user's explicit choice links it - and as what they chose.
        await link(debit, id, REPAYMENT);
        expect(linksOf(id)).toEqual([{ transaction_id: debit, entry_kind: "REPAYMENT", link_source: "MANUAL" }]);
    });
});

// ---------------------------------------------------------------------
// Regression (2026-10-12): three TATA Capital credits were re-categorised
// to Loan Principal Drawdown but stayed Transfer Out, still linked as
// REPAYMENT - so each REDUCED the OD's Used instead of increasing it.
// Root cause: on an either-way Transfer category the form kept the saved
// transfer's direction instead of re-deriving it from the bank statement,
// the save check tolerated the statement mismatch because the side was
// unchanged, and editing never touched the OD link. These run the exact
// shape: an imported statement CREDIT, stored Transfer Out, category Loan
// Principal Repayment, linked REPAYMENT.
// ---------------------------------------------------------------------

describe("Correcting an OD drawdown that was saved as money out", () => {
    const DRAWDOWN_CATEGORY = "cat-drawdown";
    const REPAYMENT_CATEGORY = "cat-repayment";

    function principalCategories(drawdownDirection: "IN" | null, repaymentDirection: "OUT" | null) {
        insert("categories", { id: DRAWDOWN_CATEGORY, name: "Loan Principal Drawdown", category_type: "TRANSFER", transfer_direction: drawdownDirection, finance_scope: "BOTH" });
        insert("categories", { id: REPAYMENT_CATEGORY, name: "Loan Principal Repayment", category_type: "TRANSFER", transfer_direction: repaymentDirection, finance_scope: "BOTH" });
    }

    // The statement row the importer recorded for a transaction on BANK.
    function statementRow(transactionId: string, side: "income" | "expense") {
        const batchId = `batch-${transactionId}`;
        insert("import_batches", { id: batchId, account_id: BANK, import_type: "CSV", source_file_name: "statement.xls" });
        insert("import_rows", { id: `row-${transactionId}`, import_batch_id: batchId, row_number: 1, raw_data: "{}", normalized_data: JSON.stringify({ type: side }), transaction_id: transactionId });
    }

    // What the Edit form submits after the user picks `categoryId` - the
    // same functions, in the same order, as TransactionForm (a new
    // category clears a manual pick; its configured direction, else the
    // statement's side, decides).
    function formSubmission(categoryId: string, drawdownDirection: "IN" | null, statementSide: "income" | "expense") {
        const categoryDirection = categoryId === DRAWDOWN_CATEGORY ? drawdownDirection : null;
        const side = derivationSideFor({ manualSide: null, categoryDirection, statementSide, shownSide: null });
        return finalTyping({
            type: "transfer",
            transferDirection: categoryDirection ?? (side === "income" ? "IN" : "OUT"),
            isTransferCategory: true,
            derivationSide: side,
        });
    }

    async function wrongWayDrawdown(amount: number) {
        const id = await createOverdraft();
        const before = await position(id);
        const credit = addTransaction({ type: "transfer", transferDirection: "OUT", amount, date: "2026-09-15", categoryId: REPAYMENT_CATEGORY, narration: "RTGS/ICICR00000000000000002/TATA CAPITAL LIMITED/ICICI BANK LIMITED" });
        statementRow(credit, "income");
        await link(credit, id, REPAYMENT);
        return { id, credit, before };
    }

    for (const drawdownDirection of [null, "IN"] as const) {
        it(`Drawdown (${drawdownDirection ?? "either way"}) on a statement credit saved Out: the normal edit makes it Transfer In, the link DRAWDOWN, and Used goes UP`, async () => {
            principalCategories(drawdownDirection, drawdownDirection ? "OUT" : null);
            const { id, credit, before } = await wrongWayDrawdown(500_000);

            // As it was: counted as a repayment.
            expect(await position(id)).toMatchObject({ used: before.used - 500_000, totalRepayments: 500_000 });

            const submitted = formSubmission(DRAWDOWN_CATEGORY, drawdownDirection, "income");
            expect(submitted).toEqual({ type: "transfer", transferDirection: "IN" });

            await new TransactionService().update({ id: credit, categoryId: DRAWDOWN_CATEGORY, ...submitted });

            const saved = (await new TransactionRepository().getById(credit))!;
            expect(saved).toMatchObject({ type: "transfer", transferDirection: "IN", categoryId: DRAWDOWN_CATEGORY, amount: 500_000 });
            expect(signedTransactionAmount(saved.amount, balanceSide(saved))).toBe(500_000);
            expect(linksOf(id)).toEqual([{ transaction_id: credit, entry_kind: "DRAWDOWN", link_source: "MANUAL" }]);
            expect(await position(id)).toMatchObject({ used: before.used + 500_000, totalDrawdowns: 500_000, totalRepayments: 0, status: "PARTLY_USED" });
            expect((await position(id)).reviewReasons).toEqual([]);
        });
    }

    it("what used to be saved (Drawdown kept as Transfer Out) is now refused, changing nothing", async () => {
        principalCategories(null, null);
        const { id, credit } = await wrongWayDrawdown(25_000);

        await expect(
            new TransactionService().update({ id: credit, categoryId: DRAWDOWN_CATEGORY, type: "transfer", transferDirection: "OUT" })
        ).rejects.toThrow("The bank statement shows this as money in");

        expect((await new TransactionRepository().getById(credit))!).toMatchObject({ transferDirection: "OUT", categoryId: REPAYMENT_CATEGORY });
        expect(linksOf(id)).toEqual([{ transaction_id: credit, entry_kind: "REPAYMENT", link_source: "MANUAL" }]);
    });

    it("Repayment (Out) on a statement credit is refused; Repayment on a statement debit stays Transfer Out / REPAYMENT", async () => {
        principalCategories("IN", "OUT");
        const { credit } = await wrongWayDrawdown(50_000);

        await expect(
            new TransactionService().update({ id: credit, categoryId: REPAYMENT_CATEGORY, type: "transfer", transferDirection: "OUT", notes: "x" })
        ).rejects.toThrow('"Loan Principal Repayment" is for Transfer Out (money out), but the bank statement shows this transaction as money in');

        const id = await createOverdraft({ name: "Second OD" } as never);
        const debit = addTransaction({ type: "expense", amount: 150_000, date: "2026-09-10", categoryId: REPAYMENT_CATEGORY, narration: "NBSM/100000002/TATA CAPITAL LTD/" });
        statementRow(debit, "expense");
        await link(debit, id, REPAYMENT);

        const submitted = formSubmission(REPAYMENT_CATEGORY, "IN", "expense");
        await new TransactionService().update({ id: debit, categoryId: REPAYMENT_CATEGORY, ...submitted });

        expect((await new TransactionRepository().getById(debit))!).toMatchObject({ type: "transfer", transferDirection: "OUT" });
        expect(linksOf(id)).toEqual([{ transaction_id: debit, entry_kind: "REPAYMENT", link_source: "MANUAL" }]);
    });
});
