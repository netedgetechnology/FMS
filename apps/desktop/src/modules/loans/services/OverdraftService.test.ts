import { DatabaseSync } from "node:sqlite";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NormalizedTransactionCandidate } from "@financeos/import-engine";

import { migrations } from "@/core/database/migrations/registry";
import { AccountRepository } from "@/modules/accounts/repositories/AccountRepository";
import { ImportService } from "@/modules/imports/services/ImportService";
import { describeLoanImportPayments } from "@/modules/imports/pages/importLoanPaymentMessage";
import { TransactionService } from "@/modules/transactions/services/TransactionService";

import { LoanRepository } from "../repositories/LoanRepository";
import { OverdraftEntryKind, LoanKind } from "../types";
import { overdraftRequestFromValues, type OverdraftFormValues } from "../validation";
import { EMIScheduleGenerator } from "./EMIScheduleGenerator";
import { LoanService } from "./LoanService";
import { LINK_DIALOG_TITLES, canLinkOverdraftChoice, linkDialogWorkflow } from "../components/LinkTransactionToEmiDialog";
import { LoanTransactionLinkService } from "./LoanTransactionLinkService";
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
            refusal: null, suggestedLoanId: id, overdrafts: [{ loanId: id, kinds: [DRAWDOWN], refusal: null }],
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

    it("a transfer on a bank account the OD is not linked to gets no OD option", async () => {
        await createOverdraft({ openingUsedAsOf: "2026-01-31" });
        const elsewhere = addTransaction({ type: "transfer", transferDirection: "IN", amount: 500_000, date: "2026-09-15", accountId: OTHER_BANK });

        expect(await new LoanTransactionLinkService().getLinkOptions(elsewhere)).toMatchObject({
            overdrafts: [], target: "OVERDRAFT",
            refusal: "This transaction is on Savings, which no active loan or overdraft uses: ABC Overdraft (Overdraft) is linked only to Operating Account. If Savings really belongs to the overdraft, add it to the overdraft's bank accounts in Edit Loan first - it is never added automatically.",
        });
    });

    it("the Link dialog offers the OD with only the kinds the direction allows", async () => {
        const id = await createOverdraft();
        const credit = addTransaction({ type: "income", amount: 1_000, date: "2026-07-05" });
        const debit = addTransaction({ type: "expense", amount: 1_000, date: "2026-07-05" });
        const service = new LoanTransactionLinkService();

        expect(await service.getLinkOptions(credit)).toMatchObject({
            refusal: null, loans: [], suggestedLoanId: id,
            overdrafts: [{ loanId: id, loanName: "ABC Overdraft", kinds: [DRAWDOWN], refusal: null }],
        });
        expect((await service.getLinkOptions(debit)).overdrafts).toEqual([
            { loanId: id, loanName: "ABC Overdraft", kinds: [REPAYMENT, INTEREST_CHARGE], refusal: null },
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

    it("a Term Loan's EMI-only linking is unchanged where no OD exists", async () => {
        seedTermLoan();
        const credit = addTransaction({ type: "income", amount: 1_000, date: "2026-07-05" });
        expect((await new LoanTransactionLinkService().getLinkOptions(credit)).refusal).toContain("outgoing");
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

    it("a transaction on an account the OD is not linked to is never offered or counted", async () => {
        addAccounts();
        const id = await createOverdraft(TATA);
        const elsewhere = addTransaction({ type: "income", amount: 10_000, date: "2026-09-01", accountId: UNLINKED });

        expect((await new LoanTransactionLinkService().getLinkOptions(elsewhere)).overdrafts).toEqual([]);
        await expect(link(elsewhere, id, DRAWDOWN)).rejects.toThrow("linked bank accounts");
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
        expect((await new LoanTransactionLinkService().getLinkOptions(on2790)).overdrafts).toEqual([]);
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
            { transactionDate: "2026-09-24", amount: 100_000, payee: "TATA CAPITAL (OD)", description: "NBSM/150747964/TATA CAPITAL LTD/", categoryId: BANK_TRANSFER },
        ]);

        expect(batch.loanPayments?.needsReview ?? []).toEqual([]);
        expect(batch.loanPayments?.overdraftApplied).toBeUndefined();
        expect(linksOf(id)).toHaveLength(0);
    });

    it("the same TATA debit in Loan Installment IS considered (review, as nothing is learned yet)", async () => {
        const id = await createOverdraft({ name: "TATA Capital", lenderInstitutionName: "TATA Capital" });

        const batch = await importStatement([
            { transactionDate: "2026-09-24", amount: 100_000, payee: "TATA CAPITAL (OD)", description: "NBSM/150747964/TATA CAPITAL LTD/" },
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

describe("Link to Loan routing - an Overdraft transaction never gets the Term Loan EMI workflow", () => {
    // The reported case (fictional ids): TATA Capital OD linked only to
    // Netedge 3999; a Rs 1,00,000 debit on 23/09/2026 in a loan category.
    // A Term Loan uses a third account.
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

    function seedTermLoan(accountId: string): string {
        const schedule = new EMIScheduleGenerator().generate({
            loanId: "term-1", principalAmount: 500000, interestRate: 9, interestType: "REDUCING",
            tenureMonths: 24, emiAmount: 22842.47, startDate: "2026-06-10", firstInstallmentAmount: null,
        });
        insert("loans", {
            id: "term-1", account_id: accountId, loan_type: "Car Loan", name: "Car Loan",
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

    const options = (id: string) => new LoanTransactionLinkService().getLinkOptions(id);
    const titleFor = (o: Awaited<ReturnType<typeof options>>) => LINK_DIALOG_TITLES[linkDialogWorkflow(o.target, null)];

    it("an eligible transaction on the OD's linked account opens the OD workflow, never the EMI one", async () => {
        addAccounts();
        const id = await createOverdraft(TATA);
        const debit = addTransaction({ type: "expense", amount: 100_000, date: "2026-09-23", accountId: ACCT_3999, narration: "TATA CAPITAL (OD)" });

        const o = await options(debit);
        expect(o).toMatchObject({
            refusal: null, target: "OVERDRAFT", loans: [], suggestedLoanId: id,
            overdrafts: [{ loanId: id, loanName: "TATA Capital", kinds: [REPAYMENT, INTEREST_CHARGE], refusal: null }],
        });
        expect(titleFor(o)).toBe("Link to Overdraft");
        expect(LINK_DIALOG_TITLES[linkDialogWorkflow(o.target, "overdraft")]).toBe("Link to Overdraft");

        // Money in on the same account: a Drawdown.
        const credit = addTransaction({ type: "income", amount: 100_000, date: "2026-09-23", accountId: ACCT_3999 });
        expect((await options(credit)).overdrafts[0]!.kinds).toEqual([DRAWDOWN]);
    });

    it("the reported row: on Netedge 2790, which the OD is not linked to - explained with the real account names; nothing linked or added", async () => {
        addAccounts();
        const id = await createOverdraft(TATA);
        const debit = addTransaction({ type: "expense", amount: 100_000, date: "2026-09-23", accountId: ACCT_2790, narration: "TATA CAPITAL (OD)" });

        const o = await options(debit);
        expect(o).toMatchObject({ target: "OVERDRAFT", loans: [], overdrafts: [] });
        expect(o.refusal).toContain("This transaction is on Netedge Technology 2790");
        expect(o.refusal).toContain("TATA Capital (Overdraft) is linked only to Netedge Technology 3999");
        expect(o.refusal).not.toContain("EMI payment account");
        expect(titleFor(o)).toBe("Link to Overdraft");

        await expect(link(debit, id, REPAYMENT)).rejects.toThrow("linked bank accounts");
        expect(linksOf(id)).toEqual([]);
        expect((await new LoanRepository().getById(id))!.linkedAccountIds).toEqual([ACCT_3999]);
        expect(await position(id)).toMatchObject({ used: 0, available: 12_500_000 });
    });

    it("a Term Loan transaction still opens the EMI workflow", async () => {
        addAccounts();
        await createOverdraft(TATA);
        const term = seedTermLoan(ACCT_TERM);
        const debit = addTransaction({ type: "expense", amount: 22842.47, date: "2026-07-10", accountId: ACCT_TERM });

        const o = await options(debit);
        expect(o).toMatchObject({ refusal: null, target: "EMI", overdrafts: [], loans: [expect.objectContaining({ loanId: term })] });
        expect(titleFor(o)).toBe("Link to Loan EMI");
        expect(LINK_DIALOG_TITLES[linkDialogWorkflow(o.target, "loan")]).toBe("Link to Loan EMI");
    });

    it("with no Overdraft anywhere, an account no loan uses keeps the Term Loan message", async () => {
        addAccounts();
        seedTermLoan(ACCT_TERM);
        const debit = addTransaction({ type: "expense", amount: 1_000, date: "2026-07-10", accountId: ACCT_2790 });

        expect(await options(debit)).toMatchObject({
            target: "EMI", refusal: "No active loan has this transaction's account as its EMI payment account.",
        });
    });

    it("a Term Loan and the OD on the same account: both offered; the OD the transaction names is preselected", async () => {
        addAccounts();
        const id = await createOverdraft(TATA);
        const term = seedTermLoan(ACCT_3999);
        const named = addTransaction({ type: "expense", amount: 100_000, date: "2026-09-23", accountId: ACCT_3999, narration: "TATA CAPITAL (OD)" });
        const unnamed = addTransaction({ type: "expense", amount: 100_000, date: "2026-09-24", accountId: ACCT_3999, narration: "NACH DR 88213" });

        const o = await options(named);
        expect(o).toMatchObject({ refusal: null, target: "ANY", suggestedLoanId: id, loans: [expect.objectContaining({ loanId: term })] });
        expect(titleFor(o)).toBe("Link to Loan");
        expect((await options(unnamed)).suggestedLoanId).toBeNull();
    });

    it("Opening Used As Of after the transaction: offered as the OD, refused with the dates explained; the date is never changed", async () => {
        addAccounts();
        const id = await createOverdraft({ ...TATA, openingUsedAsOf: "2026-10-08" });
        const debit = addTransaction({ type: "expense", amount: 100_000, date: "2026-09-23", accountId: ACCT_3999 });

        const o = await options(debit);
        expect(o.target).toBe("OVERDRAFT");
        expect(o.overdrafts[0]!.refusal).toBe(
            "This transaction is dated 2026-09-23, on or before 2026-10-08 - TATA Capital's Opening Used As Of date - so it is treated as already part of the opening used amount and can't count towards Used. The overdraft started on 2026-01-31. If the opening used amount is really as of an earlier date, change Opening Used As Of in Edit Loan first."
        );
        await expect(link(debit, id, REPAYMENT)).rejects.toThrow("on or before 2026-10-08");
        expect((await new LoanRepository().getById(id))!.openingUsedAsOf).toBe("2026-10-08");
    });

    it("drawdown and repayment through the OD workflow move Used and Available on the consolidated OD", async () => {
        addAccounts();
        const id = await createOverdraft({ ...TATA, accountIds: [ACCT_3999, ACCT_2790] });
        const service = new LoanTransactionLinkService();

        const draw = addTransaction({ type: "income", amount: 500_000, date: "2026-09-01", accountId: ACCT_3999 });
        await service.linkOverdraft({ transactionId: draw, loanId: id, entryKind: DRAWDOWN });
        expect(await position(id)).toMatchObject({ used: 500_000, available: 12_000_000 });

        const repay = addTransaction({ type: "expense", amount: 100_000, date: "2026-09-23", accountId: ACCT_2790 });
        await service.linkOverdraft({ transactionId: repay, loanId: id, entryKind: REPAYMENT });
        expect(await position(id)).toMatchObject({ used: 400_000, available: 12_100_000 });

        const interest = addTransaction({ type: "expense", amount: 2_500, date: "2026-09-30", accountId: ACCT_3999 });
        await service.linkOverdraft({ transactionId: interest, loanId: id, entryKind: INTEREST_CHARGE });
        expect(await position(id)).toMatchObject({ used: 400_000, available: 12_100_000, totalInterestCharges: 2_500 });
    });

    it("the five loan categories pass; Bank Transfer and ordinary categories never reach the OD workflow", async () => {
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
            expect(await options(txn)).toMatchObject({ overdrafts: [], refusal: expect.stringContaining("loan category") });
            await expect(link(txn, id, DRAWDOWN)).rejects.toThrow("loan category");
        }
        expect(linksOf(id)).toEqual([]);
    });
    it("opening-date flow: refused while Opening Used As Of is 2026-10-08; linkable once the USER saves 2026-01-31 and reopens", async () => {
        addAccounts();
        const id = await createOverdraft({ ...TATA, openingUsedAsOf: "2026-10-08" });
        const debit = addTransaction({ type: "expense", amount: 250_000, date: "2026-09-16", accountId: ACCT_3999, narration: "RTGS/ICICR42026091600579106/TATA CAPITAL LIMITED/ICICI BANK LIMITED//URGENT/700020278710234077R01" });
        const onStart = addTransaction({ type: "expense", amount: 1_000, date: "2026-01-31", accountId: ACCT_3999 });
        const dayAfter = addTransaction({ type: "expense", amount: 1_000, date: "2026-02-01", accountId: ACCT_3999 });

        // The dialog's state on open: the OD is offered, refused, Link disabled
        // whatever the user picks.
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
        expect(o).toMatchObject({ refusal: null, target: "OVERDRAFT", suggestedLoanId: id });
        expect(od).toEqual({ loanId: id, loanName: "TATA Capital", kinds: [REPAYMENT, INTEREST_CHARGE], refusal: null });
        expect(canLinkOverdraftChoice({ saving: false, options: o, overdraft: od, entryKind: null })).toBe(false);
        expect(canLinkOverdraftChoice({ saving: false, options: o, overdraft: od, entryKind: DRAWDOWN })).toBe(false);
        expect(canLinkOverdraftChoice({ saving: false, options: o, overdraft: od, entryKind: REPAYMENT })).toBe(true);
        expect(canLinkOverdraftChoice({ saving: false, options: o, overdraft: od, entryKind: INTEREST_CHARGE })).toBe(true);

        // The boundary: ON the opening date is still the opening amount; the day after counts.
        expect((await options(onStart)).overdrafts[0]!.refusal).toContain("on or before 2026-01-31");
        expect((await options(dayAfter)).overdrafts[0]!.refusal).toBeNull();

        // Opening options and editing the date created no link.
        expect(linksOf(id)).toEqual([]);
        expect(await position(id)).toMatchObject({ used: 0, available: 12_500_000 });

        // Only the user's explicit choice links it - and as what they chose.
        await link(debit, id, REPAYMENT);
        expect(linksOf(id)).toEqual([{ transaction_id: debit, entry_kind: "REPAYMENT", link_source: "MANUAL" }]);
    });
});
