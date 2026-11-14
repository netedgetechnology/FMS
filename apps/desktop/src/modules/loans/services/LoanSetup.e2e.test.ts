import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrations } from "@/core/database/migrations/registry";
import { LoanInterestRateHistoryMigration } from "@/core/database/migrations/054_loan_interest_rate_history";

import { LoanRepository } from "../repositories/LoanRepository";
import { InterestRateHistoryRepository } from "../repositories/InterestRateHistoryRepository";
import { LoanSetupRepository } from "../repositories/LoanSetupRepository";
import { LoanKind, OverdraftEntryKind } from "../types";
import { parseLenderScheduleCsv, validateLenderSchedule } from "../setup/lenderSchedule";
import { draftToCreateRequest, emptyLoanSetupDraft, newDisbursementDraft, newExpenseDraft } from "../setup/loanSetupWizard";
import type { LinkedTransactionSummary, LoanSetupDraft } from "../setup/loanSetupTypes";
import {
    localToday,
    matchHistoricalEmiDebits,
    suggestHistoricalLinks,
} from "../setup/historicalInstalments";
import { unmarkedSchedulePreview, validateStep } from "../setup/loanSetupWizard";
import { LoanService } from "./LoanService";
import { LoanTransactionLinkService } from "./LoanTransactionLinkService";
import { OverdraftService } from "./OverdraftService";
import { analyseLoanStatement, documentFromItems } from "@financeos/import-engine";
import { createReviewState, setConfirmed, updateDisbursement } from "../statementImport/statementReview";
import { reviewToDraft } from "../statementImport/statementToDraft";
import { compareWithStatement } from "../statementImport/statementReconciliation";
import { emptyStatementCompletion, statementLoanDraft, statementSaveIssues, type StatementCompletion } from "../statementImport/statementLoanSetup";
import { entriesFromDraft, historicalSummary } from "../setup/historicalInstalments";
import { formatMoney } from "../setup/loanSetupAccounting";

// ---------------------------------------------------------------------
// The Add Loan setup workflow end to end: the real LoanService,
// LoanSetupRepository, OverdraftService and LoanTransactionLinkService
// against an in-memory database built from every FinWea migration
// (never the production database). Only the Tauri IPC is replaced:
// create_loan_atomic is replayed with the same SQL and the same checks
// as src-tauri/src/loan_create.rs + loan_setup.rs (which have their own
// Rust tests).
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

const REFUSED = "LOAN_SETUP_REFUSED: ";

function refuse(message: string): never {
    throw `encountered unexpected or invalid data: ${REFUSED}${message}`;
}

/** src-tauri/src/loan_setup.rs check_transaction, check for check. */
function checkTransaction(db: DatabaseSync, id: string, accountId: string | null, side: "IN" | "OUT", amount: number, what: string) {
    const row = db.prepare("SELECT account_id, amount, type, transfer_direction, deleted_at FROM transactions WHERE id = ?").get(id) as any;
    if (!row) refuse(`The bank transaction chosen for ${what} no longer exists.`);
    if (row.deleted_at) refuse(`The bank transaction chosen for ${what} has been deleted.`);
    if (accountId && accountId !== row.account_id) refuse(`The bank transaction chosen for ${what} is on a different bank account.`);
    const isIn = row.type === "income" || (row.type === "transfer" && row.transfer_direction === "IN");
    const isOut = row.type === "expense" || (row.type === "transfer" && row.transfer_direction === "OUT");
    if (side === "IN" && !isIn) refuse(`The bank transaction chosen for ${what} is not money received.`);
    if (side === "OUT" && !isOut) refuse(`The bank transaction chosen for ${what} is not money paid out.`);
    if (Math.abs(row.amount - amount) >= 0.005) refuse(`The bank transaction chosen for ${what} is for ${row.amount.toFixed(2)}, not ${amount.toFixed(2)}.`);
    const claimed = (db.prepare(
        `SELECT (SELECT COUNT(*) FROM overdraft_transaction_links WHERE transaction_id = ?1)
              + (SELECT COUNT(*) FROM loan_schedule_payments WHERE transaction_id = ?1)
              + (SELECT COUNT(*) FROM loan_disbursements WHERE transaction_id = ?1)
              + (SELECT COUNT(*) FROM loan_initial_expenses WHERE transaction_id = ?1) AS n`
    ).get(id) as { n: number }).n;
    if (claimed > 0) refuse(`The bank transaction chosen for ${what} is already linked to a loan, an overdraft or another loan expense.`);
}

const invoke = vi.fn(async (command: string, args: { request: Record<string, any> }) => {
    if (command !== "create_loan_atomic") throw new Error(`Unexpected command ${command}`);
    const request = args.request;
    const db = sqlite.db!;
    // loan_create.rs check_paid_rows: a PAID instalment needs a linked
    // historical payment or the "Settled before FinWea" flag, and is never
    // due after today.
    const today = localToday();
    const payments = new Map<string, any>((request.historicalPayments ?? []).map((p: any) => [p.scheduleId, p]));
    if (new Set((request.historicalPayments ?? []).map((p: any) => p.transactionId)).size !== payments.size) {
        refuse("The same bank transaction is linked to more than one instalment.");
    }
    let paidCount = 0;
    for (const s of request.schedule) {
        if (s.status !== "PAID") continue;
        paidCount++;
        if (s.dueDate.slice(0, 10) > today) refuse(`Instalment #${s.installmentNumber} is due on ${s.dueDate}, after today - a future instalment cannot be marked paid.`);
        if (s.settledBeforeFinwea ? s.transactionId || payments.has(s.id) : payments.get(s.id)?.transactionId !== s.transactionId) {
            refuse(`Instalment #${s.installmentNumber} is marked paid without a linked bank transaction.`);
        }
    }
    if (paidCount !== request.loan.paidInstallments) refuse("paid count mismatch");
    db.exec("BEGIN");
    try {
        // loan_create.rs: a Term Loan's lender account number on a live loan
        // is refused inside the transaction; a new lender institution is
        // inserted in it.
        const number = request.loan.loanAccountNumber?.trim();
        if (!request.overdraft && number) {
            const existing = db.prepare(
                "SELECT name FROM loans WHERE deleted_at IS NULL AND loan_account_number IS NOT NULL AND lower(trim(loan_account_number)) = lower(?) LIMIT 1"
            ).get(number) as { name: string } | undefined;
            if (existing) refuse(`A loan with account number ${number} already exists ("${existing.name}"). Nothing was saved, so the same loan is not added twice.`);
        }
        const institution = request.newLenderInstitution;
        if (institution) {
            db.prepare("INSERT INTO institutions (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
                .run(institution.id, institution.name, institution.institutionType, institution.createdAt, institution.updatedAt);
        }
        const a = request.loanAccount;
        db.prepare(
            `INSERT INTO accounts (id, institution_id, business_entity_id, currency_id, name, account_type, opening_balance, description, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
        ).run(a.id, a.institutionId, a.businessEntityId, a.currencyId, a.name, a.accountType, a.description, a.isActive ? 1 : 0, a.createdAt, a.updatedAt);
        const l = request.loan;
        db.prepare(
            `INSERT INTO loans (id, account_id, lender_institution_id, loan_type, name, loan_account_number, principal_amount, interest_rate, interest_type, tenure_months, emi_amount,
                first_installment_amount, start_date, maturity_date, outstanding_principal, outstanding_interest, paid_installments, currency_id, status, notes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(l.id, l.accountId, l.lenderInstitutionId, l.loanType, l.name, l.loanAccountNumber, l.principalAmount, l.interestRate, l.interestType, l.tenureMonths, l.emiAmount,
            l.firstInstallmentAmount, l.startDate, l.maturityDate, l.outstandingPrincipal, l.outstandingInterest, l.paidInstallments, l.currencyId, l.status, l.notes, l.createdAt, l.updatedAt);
        db.prepare("UPDATE loans SET loan_account_id = ? WHERE id = ?").run(a.id, l.id);
        // loan_create.rs record_initial_rate: the initial Interest Rate History
        // row, only once migration 054's table exists.
        const rateTable = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'loan_interest_rate_history'").get() as { n: number };
        if (request.initialRateHistoryId && rateTable.n > 0) {
            db.prepare(
                "INSERT INTO loan_interest_rate_history (id, loan_id, effective_from, rate, previous_rate, rate_type, source, created_at) VALUES (?, ?, ?, ?, NULL, ?, 'INITIAL', ?)"
            ).run(request.initialRateHistoryId, l.id, l.startDate.slice(0, 10), l.interestRate, request.setup?.rateType ?? null, l.createdAt);
        }
        for (const s of request.schedule) {
            db.prepare(
                `INSERT INTO loan_payment_schedule (id, loan_id, installment_number, due_date, principal_amount, interest_amount, total_amount, outstanding_principal, status, paid_date, paid_amount, transaction_id, settled_before_finwea, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
            ).run(s.id, l.id, s.installmentNumber, s.dueDate, s.principalAmount, s.interestAmount, s.totalAmount, s.outstandingPrincipal, s.status, s.paidDate, s.paidAmount, s.transactionId, s.settledBeforeFinwea ? 1 : 0);
            if (s.openingPrincipal !== null && s.openingPrincipal !== undefined) {
                db.prepare("UPDATE loan_payment_schedule SET opening_principal = ? WHERE id = ?").run(s.openingPrincipal, s.id);
            }
        }
        // loan_create.rs persist_historical_payments.
        for (const p of request.historicalPayments ?? []) {
            const s = request.schedule.find((row: any) => row.id === p.scheduleId);
            checkTransaction(db, p.transactionId, l.accountId, "OUT", s.totalAmount, `instalment #${s.installmentNumber}`);
            const date = (db.prepare("SELECT substr(transaction_date, 1, 10) AS d FROM transactions WHERE id = ?").get(p.transactionId) as { d: string }).d;
            if (date > today) refuse(`The bank transaction chosen for instalment #${s.installmentNumber} is dated after today.`);
            if (s.paidDate?.slice(0, 10) !== date) refuse("The paid date must be the bank transaction's date.");
            db.prepare(
                `INSERT INTO loan_schedule_payments (id, loan_id, schedule_id, transaction_id, payment_date, amount, principal_amount, interest_amount, transaction_linked, settles_installment)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`
            ).run(p.id, l.id, s.id, p.transactionId, date, s.totalAmount, s.principalAmount, s.interestAmount);
        }
        db.prepare("UPDATE loans SET outstanding_principal = ?, outstanding_interest = ?, status = COALESCE(?, status) WHERE id = ?")
            .run(request.balances.outstandingPrincipal, request.balances.outstandingInterest, request.balances.status, l.id);
        if (request.overdraft) {
            db.prepare("UPDATE loans SET loan_kind = 'OVERDRAFT', credit_limit = ?, opening_used = ?, opening_used_as_of = ? WHERE id = ?")
                .run(request.overdraft.creditLimit, request.overdraft.openingUsed, request.overdraft.openingUsedAsOf, l.id);
            for (const accountId of request.overdraft.accountIds) {
                db.prepare("INSERT OR IGNORE INTO overdraft_accounts (id, loan_id, account_id) VALUES (lower(hex(randomblob(16))), ?, ?)").run(l.id, accountId);
            }
        }
        const setup = request.setup;
        if (setup) {
            db.prepare(
                `UPDATE loans SET loan_purpose = ?, rate_type = ?, interest_calculation_method = ?, sanction_date = ?, sanctioned_amount = ?, first_emi_date = ?,
                    repayment_frequency = ?, payment_day = ?, grace_period_months = ?, balloon_amount = ?, schedule_source = ?, drawing_power = ? WHERE id = ?`
            ).run(setup.loanPurpose, setup.rateType, setup.interestCalculationMethod, setup.sanctionDate, setup.sanctionedAmount, setup.firstEmiDate,
                setup.repaymentFrequency, setup.paymentDay, setup.gracePeriodMonths, setup.balloonAmount, setup.scheduleSource, setup.drawingPower, l.id);
            for (const d of setup.disbursements) {
                if (Math.abs(d.grossAmount - d.deductionsAmount - d.netAmount) >= 0.005) refuse(`Disbursement ${d.sequence} does not add up.`);
                if (d.transactionId) checkTransaction(db, d.transactionId, d.destinationAccountId, "IN", d.netAmount, `disbursement ${d.sequence}`);
                db.prepare(
                    `INSERT INTO loan_disbursements (id, loan_id, sequence, disbursement_date, gross_amount, deductions_amount, net_amount, destination_account_id, reference, transaction_id)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).run(d.id, l.id, d.sequence, d.disbursementDate, d.grossAmount, d.deductionsAmount, d.netAmount, d.destinationAccountId, d.reference, d.transactionId);
            }
            setup.expenses.forEach((e: any, index: number) => {
                if (e.settlement !== "PAID_SEPARATELY" && e.transactionId) refuse("cannot be linked to a bank transaction");
                if (e.transactionId) checkTransaction(db, e.transactionId, e.paymentAccountId, "OUT", e.totalAmount, `initial expense ${index + 1}`);
                db.prepare(
                    `INSERT INTO loan_initial_expenses (id, loan_id, expense_type, description, expense_date, base_amount, gst_rate, gst_amount, total_amount, settlement,
                        disbursement_id, payment_method, payment_account_id, transaction_reference, transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).run(e.id, l.id, e.expenseType, e.description, e.expenseDate, e.baseAmount, e.gstRate, e.gstAmount, e.totalAmount, e.settlement,
                    e.disbursementId, e.paymentMethod, e.paymentAccountId, e.transactionReference, e.transactionId);
            });
            for (const d of setup.disbursements) {
                const deducted = setup.expenses
                    .filter((e: any) => e.settlement === "DEDUCTED_FROM_DISBURSEMENT" && e.disbursementId === d.id)
                    .reduce((sum: number, e: any) => sum + e.totalAmount, 0);
                if (Math.abs(deducted - d.deductionsAmount) >= 0.005) refuse(`Disbursement ${d.sequence} deductions do not match.`);
            }
        }
        db.exec("COMMIT");
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...(args as [string, never])) }));

function insert(table: string, values: Record<string, unknown>): void {
    const row: Record<string, unknown> = { ...values };
    for (const column of sqlite.db!.prepare(`PRAGMA table_info(${table})`).all() as {
        name: string; type: string; notnull: number; dflt_value: unknown;
    }[]) {
        if (column.name in row || !column.notnull || column.dflt_value !== null) continue;
        row[column.name] = /INT|REAL|NUM/i.test(column.type) ? 0 : `${column.name}-${Math.random().toString(36).slice(2, 8)}`;
    }
    const columns = Object.keys(row);
    sqlite.db!.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(...(Object.values(row) as never[]));
}

const all = <T = Record<string, any>>(sql: string, ...binds: unknown[]) => sqlite.db!.prepare(sql).all(...(binds as never[])) as T[];
const count = (table: string) => (sqlite.db!.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

const BANK = "acct-3999";
const OTHER = "acct-2790";
const LOAN_CATEGORY = "cat-loan-principal-drawdown";
const FEE_CATEGORY = "cat-bank-charges";

function addTransaction(id: string, spec: { type: string; amount: number; date: string; accountId?: string; direction?: "IN" | "OUT"; categoryId?: string; deleted?: boolean }) {
    insert("transactions", {
        id,
        account_id: spec.accountId ?? BANK,
        payee: `Payee ${id}`,
        type: spec.type,
        transfer_direction: spec.direction ?? null,
        amount: spec.amount,
        transaction_date: spec.date,
        category_id: spec.categoryId ?? null,
        status: "CLEARED",
        deleted_at: spec.deleted ? "2026-10-01" : null,
    });
}

async function summary(id: string): Promise<LinkedTransactionSummary> {
    const [row] = await new LoanSetupRepository().getTransactionsForLinking([id]);
    return row!;
}

function snapshotTransactions() {
    return all("SELECT * FROM transactions ORDER BY id");
}

/** Applies migration 054 to this test's in-memory database (built at 053 - see beforeEach). */
function applyRateHistoryMigration() {
    for (const statement of LoanInterestRateHistoryMigration.sql.split(";").map(part => part.trim()).filter(Boolean)) sqlite.db!.exec(statement);
}

function rateRows() {
    return all("SELECT loan_id, effective_from, rate, previous_rate, rate_type, source, superseded_at FROM loan_interest_rate_history ORDER BY loan_id, effective_from");
}

beforeEach(() => {
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
    // Built at 053, as an existing database is before 054: the rate-history
    // tests opt in with applyRateHistoryMigration(), so the pre-054 paths
    // (a database not yet migrated) stay covered now that 054 is registered.
    for (const migration of migrations.filter(item => item.version < LoanInterestRateHistoryMigration.version)) {
        for (const statement of migration.sql.split(";").map(s => s.trim()).filter(Boolean)) {
            if (!/^PRAGMA\s+foreign_keys\s*=\s*ON\s*$/i.test(statement)) db.exec(statement);
        }
    }
    sqlite.db = db;
    insert("accounts", { id: BANK, name: "Netedge Technology 3999", account_type: "CURRENT", opening_balance: 0, currency_id: "INR" });
    insert("accounts", { id: OTHER, name: "Netedge Technology 2790", account_type: "CURRENT", opening_balance: 0, currency_id: "INR" });
    insert("categories", { id: LOAN_CATEGORY, name: "Loan Principal Drawdown", category_type: "TRANSFER", finance_scope: "BOTH" });
    insert("categories", { id: FEE_CATEGORY, name: "Bank Charges", category_type: "EXPENSE", finance_scope: "BOTH" });

    addTransaction("credit-net", { type: "transfer", direction: "IN", amount: 712_182, date: "2026-02-05", categoryId: LOAN_CATEGORY });
    addTransaction("legal-fee", { type: "expense", amount: 10_620, date: "2026-02-03", categoryId: FEE_CATEGORY });
    addTransaction("stage-2", { type: "income", amount: 250_000, date: "2026-04-10" });
    addTransaction("deleted-credit", { type: "income", amount: 712_182, date: "2026-02-05", deleted: true });
    addTransaction("other-account-credit", { type: "income", amount: 712_182, date: "2026-02-05", accountId: OTHER });
    addTransaction("od-draw", { type: "transfer", direction: "IN", amount: 500_000, date: "2026-03-10", categoryId: LOAN_CATEGORY });
    addTransaction("od-repay", { type: "transfer", direction: "OUT", amount: 200_000, date: "2026-03-20", categoryId: LOAN_CATEGORY });
    invoke.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
});

async function termDraft(): Promise<LoanSetupDraft> {
    const draft = emptyLoanSetupDraft(LoanKind.TERM_LOAN, "INR");
    Object.assign(draft, {
        name: "TATA Capital Term (test)",
        lenderName: "TATA Capital",
        loanAccountNumber: "TXLNA0999000000000017",
        loanCategory: "Term Loan",
        purpose: "Working capital",
        sanctionedAmount: 750_000,
        interestRate: 10.5,
        rateType: "FLOATING",
        sanctionDate: "2026-01-28",
        startDate: "2026-02-05",
        linkedAccountId: BANK,
        tenureMonths: 180,
        firstEmiDate: "2026-03-05",
        paymentDay: 5,
    });
    draft.disbursements = [{ ...newDisbursementDraft(draft), date: "2026-02-05", grossAmount: 750_000, deductionsAmount: 37_818, reference: "NEFT", transaction: await summary("credit-net") }];
    draft.expenses = [
        { ...newExpenseDraft(draft), expenseType: "PROCESSING_FEE", baseAmount: 32_049.15, gstRate: 18 },
        {
            ...newExpenseDraft(draft),
            expenseType: "LEGAL_CHARGES",
            settlement: "PAID_SEPARATELY",
            disbursementKey: null,
            expenseDate: "2026-02-03",
            baseAmount: 9_000,
            gstRate: 18,
            paymentAccountId: BANK,
            transaction: await summary("legal-fee"),
        },
    ];
    return draft;
}

describe("Add Loan - Term Loan with disbursement and initial expenses", () => {
    it("creates the loan, its schedule from the real first EMI date, and links existing transactions without creating any", async () => {
        const before = snapshotTransactions();
        const id = await new LoanService().create(draftToCreateRequest(await termDraft()));

        expect(snapshotTransactions()).toEqual(before);

        const loan = (await new LoanRepository().getById(id))!;
        expect(loan).toMatchObject({
            loanKind: LoanKind.TERM_LOAN,
            principalAmount: 750_000,
            outstandingPrincipal: 750_000,
            emiAmount: 8_290.49,
            tenureMonths: 180,
            loanAccountNumber: "TXLNA0999000000000017",
            loanPurpose: "Working capital",
            rateType: "FLOATING",
            interestCalculationMethod: "MONTHLY_RATE",
            sanctionDate: "2026-01-28",
            sanctionedAmount: 750_000,
            firstEmiDate: "2026-03-05",
            repaymentFrequency: "MONTHLY",
            paymentDay: 5,
            scheduleSource: "GENERATED",
        });

        const schedule = all("SELECT installment_number, due_date, principal_amount, interest_amount, total_amount, status FROM loan_payment_schedule WHERE loan_id = ? ORDER BY installment_number", id);
        expect(schedule).toHaveLength(180);
        expect(schedule[0]).toEqual({ installment_number: 1, due_date: "2026-03-05", principal_amount: 1_727.99, interest_amount: 6_562.50, total_amount: 8_290.49, status: "UPCOMING" });

        const disbursements = await new LoanSetupRepository().getDisbursements(id);
        expect(disbursements).toMatchObject([{ sequence: 1, grossAmount: 750_000, deductionsAmount: 37_818, netAmount: 712_182, destinationAccountId: BANK, transactionId: "credit-net" }]);

        const expenses = await new LoanSetupRepository().getInitialExpenses(id);
        expect(expenses).toMatchObject([
            { expenseType: "LEGAL_CHARGES", totalAmount: 10_620, gstAmount: 1_620, settlement: "PAID_SEPARATELY", transactionId: "legal-fee", disbursementId: null },
            { expenseType: "PROCESSING_FEE", totalAmount: 37_818, gstAmount: 5_768.85, settlement: "DEDUCTED_FROM_DISBURSEMENT", transactionId: null, disbursementId: disbursements[0]!.id },
        ]);
    });

    it("supports multiple disbursements: the principal is the gross total", async () => {
        const draft = await termDraft();
        draft.disbursements = [
            { ...draft.disbursements[0]!, grossAmount: 500_000, deductionsAmount: 37_818, transaction: null },
            { ...newDisbursementDraft(draft), date: "2026-04-10", grossAmount: 250_000, deductionsAmount: 0, destinationAccountId: BANK, transaction: await summary("stage-2") },
        ];
        const id = await new LoanService().create(draftToCreateRequest(draft));

        expect((await new LoanRepository().getById(id))!.principalAmount).toBe(750_000);
        expect((await new LoanSetupRepository().getDisbursements(id)).map(d => [d.sequence, d.netAmount, d.transactionId])).toEqual([
            [1, 462_182, null],
            [2, 250_000, "stage-2"],
        ]);
    });

    it("refuses a transaction another loan already uses - nothing is written at all", async () => {
        await new LoanService().create(draftToCreateRequest(await termDraft()));
        const loansBefore = count("loans");
        const accountsBefore = count("accounts");

        const second = await termDraft();
        second.name = "Duplicate";
        second.loanAccountNumber = "TXLNA0999000000000099";
        await expect(new LoanService().create(draftToCreateRequest(second))).rejects.toThrow(/already used by a loan disbursement/);

        expect(count("loans")).toBe(loansBefore);
        expect(count("accounts")).toBe(accountsBefore);
        expect(count("loan_disbursements")).toBe(1);
    });

    it("refuses a transaction linked to an overdraft, a deleted one, and one on another account", async () => {
        insert("overdraft_transaction_links", { id: "link-1", loan_id: "some-od", transaction_id: "legal-fee", entry_kind: "REPAYMENT" });
        await expect(new LoanService().create(draftToCreateRequest(await termDraft()))).rejects.toThrow(/already used by an overdraft/);
        sqlite.db!.prepare("DELETE FROM overdraft_transaction_links").run();

        const deleted = await termDraft();
        deleted.disbursements[0]!.transaction = { ...(await summary("credit-net")), id: "deleted-credit" };
        await expect(new LoanService().create(draftToCreateRequest(deleted))).rejects.toThrow(/no longer exists/);

        const elsewhere = await termDraft();
        elsewhere.disbursements[0]!.transaction = { ...(await summary("credit-net")), id: "other-account-credit" };
        await expect(new LoanService().create(draftToCreateRequest(elsewhere))).rejects.toThrow(/different bank account/);

        expect(count("loans")).toBe(0);
    });

    it("the atomic command re-checks claims at write time (a link made after the wizard's check)", async () => {
        const request = draftToCreateRequest(await termDraft());
        const service = new LoanService();
        // Bypass the service's own pre-check to prove the write-time check holds.
        Object.defineProperty(service, "verifySetup", { value: async () => {} });
        insert("loan_schedule_payments", { id: "pay-1", loan_id: "x", schedule_id: "y", transaction_id: "credit-net", payment_date: "2026-02-05", amount: 1, principal_amount: 1, interest_amount: 0 });

        await expect(service.create(request)).rejects.toThrow(/already linked to a loan, an overdraft or another loan expense/);
        expect(count("loans")).toBe(0);
        expect(count("loan_payment_schedule")).toBe(0);
    });

    it("refuses the same loan twice (a statement imported again): same lender account number, nothing written", async () => {
        await new LoanService().create(draftToCreateRequest(await termDraft()));
        const snapshot = ["loans", "accounts", "institutions", "loan_payment_schedule", "loan_disbursements", "loan_initial_expenses"].map(count);
        const transactions = snapshotTransactions();

        const again = await termDraft();
        again.loanAccountNumber = "  txlna0999000000000017 ";
        again.lenderName = "A lender FinWea has not seen";
        await expect(new LoanService().create(draftToCreateRequest(again))).rejects.toThrow(/account number txlna0999000000000017 already exists/);

        expect(["loans", "accounts", "institutions", "loan_payment_schedule", "loan_disbursements", "loan_initial_expenses"].map(count)).toEqual(snapshot);
        expect(snapshotTransactions()).toEqual(transactions);
    });

    it("the atomic command refuses the duplicate itself, even when the service check is bypassed", async () => {
        await new LoanService().create(draftToCreateRequest(await termDraft()));
        const loansBefore = count("loans");
        const draft = await termDraft();
        draft.disbursements = [];
        draft.expenses = [];
        draft.principalAmount = 750_000;
        const service = new LoanService();
        Object.defineProperty(service, "refuseDuplicateLoanAccountNumber", { value: async () => {} });

        await expect(service.create(draftToCreateRequest(draft))).rejects.toThrow(/already exists/);
        expect(count("loans")).toBe(loansBefore);
    });

    it("a refused save leaves no new lender institution behind; a successful one creates it with the loan", async () => {
        const institutionsBefore = count("institutions");
        const draft = await termDraft();
        draft.lenderName = "Brand New Lender";
        const service = new LoanService();
        Object.defineProperty(service, "verifySetup", { value: async () => {} });
        insert("loan_schedule_payments", { id: "pay-1", loan_id: "x", schedule_id: "y", transaction_id: "credit-net", payment_date: "2026-02-05", amount: 1, principal_amount: 1, interest_amount: 0 });

        await expect(service.create(draftToCreateRequest(draft))).rejects.toThrow(/already linked/);
        expect(count("institutions")).toBe(institutionsBefore);
        expect(count("loans")).toBe(0);

        sqlite.db!.prepare("DELETE FROM loan_schedule_payments WHERE id = 'pay-1'").run();
        const id = await new LoanService().create(draftToCreateRequest(draft));
        expect(count("institutions")).toBe(institutionsBefore + 1);
        const [loan] = all("SELECT i.name FROM loans l JOIN institutions i ON i.id = l.lender_institution_id WHERE l.id = ?", id);
        expect(loan!.name).toBe("Brand New Lender");
    });

    it("stores an imported lender schedule exactly as given, including its opening principal", async () => {
        const draft = await termDraft();
        draft.disbursements = [];
        draft.expenses = [];
        draft.sanctionedAmount = 30_000;
        draft.principalAmount = 30_000;
        draft.tenureMonths = 3;
        draft.scheduleMethod = "LENDER_CSV";
        const parsed = parseLenderScheduleCsv(
            [
                "Instalment No,Due Date,Opening Balance,EMI,Principal,Interest,Closing Balance",
                "1,05/03/2026,30000.00,10200.00,9900.00,300.00,20100.00",
                "2,05/04/2026,20100.00,10200.00,9999.00,201.00,10101.00",
                "3,05/05/2026,10101.00,10202.01,10101.00,101.01,0.00",
            ].join("\n")
        );
        draft.lenderSchedule = { fileName: "lender.csv", rows: validateLenderSchedule(parsed.document, parsed.mapping, { principalAmount: 30_000, startDate: "2026-02-05" }).rows! };

        const id = await new LoanService().create(draftToCreateRequest(draft));

        expect(all("SELECT installment_number, due_date, opening_principal, principal_amount, interest_amount, total_amount, outstanding_principal FROM loan_payment_schedule WHERE loan_id = ? ORDER BY installment_number", id)).toEqual([
            { installment_number: 1, due_date: "2026-03-05", opening_principal: 30_000, principal_amount: 9_900, interest_amount: 300, total_amount: 10_200, outstanding_principal: 20_100 },
            { installment_number: 2, due_date: "2026-04-05", opening_principal: 20_100, principal_amount: 9_999, interest_amount: 201, total_amount: 10_200, outstanding_principal: 10_101 },
            { installment_number: 3, due_date: "2026-05-05", opening_principal: 10_101, principal_amount: 10_101, interest_amount: 101.01, total_amount: 10_202.01, outstanding_principal: 0 },
        ]);
        expect((await new LoanRepository().getById(id))!).toMatchObject({ scheduleSource: "LENDER_CSV", emiAmount: 10_200, tenureMonths: 3, maturityDate: "2026-05-05", outstandingInterest: 602.01 });
    });
});

describe("Add Loan - Overdraft", () => {
    async function createOd(drawingPower: number | null) {
        const draft = emptyLoanSetupDraft(LoanKind.OVERDRAFT, "INR");
        Object.assign(draft, {
            name: "TATA Capital (OD) test",
            lenderName: "TATA Capital",
            loanAccountNumber: "0099000123",
            interestRate: 10.5,
            startDate: "2026-01-31",
            creditLimit: 1_000_000,
            drawingPower,
            openingUsed: 300_000,
            openingUsedAsOf: "2026-02-28",
            odAccountIds: [BANK],
        });
        draft.expenses = [{ ...newExpenseDraft(draft), expenseType: "PROCESSING_FEE", settlement: "CHARGED_TO_LOAN_ACCOUNT", baseAmount: 5_000, gstRate: 18, paymentAccountId: "", expenseDate: "2026-01-31" }];
        return await new LoanService().create(draftToCreateRequest(draft));
    }

    async function position(id: string) {
        return await new OverdraftService().getPosition((await new LoanRepository().getById(id))!);
    }

    it("opens with the opening used balance, no bank transaction and no EMI schedule", async () => {
        const before = snapshotTransactions();
        const id = await createOd(null);

        expect(snapshotTransactions()).toEqual(before);
        expect(count("loan_payment_schedule")).toBe(0);
        expect((await new LoanRepository().getById(id))!).toMatchObject({ loanKind: LoanKind.OVERDRAFT, loanAccountNumber: "0099000123", openingUsed: 300_000, drawingPower: null, scheduleSource: null });
        expect(await position(id)).toMatchObject({ limit: 1_000_000, used: 300_000, available: 700_000 });
        expect(await new LoanSetupRepository().getInitialExpenses(id)).toMatchObject([{ settlement: "CHARGED_TO_LOAN_ACCOUNT", totalAmount: 5_900, transactionId: null }]);
    });

    it("drawdowns raise Used, repayments lower it, and Available is min(limit, drawing power) - Used", async () => {
        const id = await createOd(800_000);
        const links = new LoanTransactionLinkService();
        await links.linkOverdraft({ transactionId: "od-draw", loanId: id, entryKind: OverdraftEntryKind.DRAWDOWN });
        await links.linkOverdraft({ transactionId: "od-repay", loanId: id, entryKind: OverdraftEntryKind.REPAYMENT });

        // 3,00,000 + 5,00,000 - 2,00,000 = 6,00,000 used; drawing power 8,00,000 caps what is left.
        expect(await position(id)).toMatchObject({ limit: 1_000_000, drawingPower: 800_000, used: 600_000, available: 200_000, totalDrawdowns: 500_000, totalRepayments: 200_000 });
        // The outstanding principal is Used - separate from the available amount.
        expect((await new LoanRepository().getById(id))!.outstandingPrincipal).toBe(600_000);
    });
});

describe("Existing loan compatibility", () => {
    it("a loan created the old way (no setup) is exactly as before, with every new column empty", async () => {
        const id = await new LoanService().create({
            loanKind: LoanKind.TERM_LOAN,
            loanType: "Home Loan",
            name: "Legacy",
            principalAmount: 10_000,
            interestRate: 12,
            interestType: "REDUCING",
            tenureMonths: 12,
            startDate: "2026-09-20",
            paidInstallments: 0,
            outstandingPrincipal: 10_000,
            outstandingInterest: 0,
            currencyId: "INR",
            status: "ACTIVE",
            accountId: BANK,
        });

        const row = all("SELECT * FROM loans WHERE id = ?", id)[0]!;
        for (const column of ["loan_purpose", "rate_type", "interest_calculation_method", "sanction_date", "sanctioned_amount", "first_emi_date", "repayment_frequency", "payment_day", "grace_period_months", "balloon_amount", "schedule_source", "drawing_power"]) {
            expect(row[column]).toBeNull();
        }
        const first = all("SELECT due_date, total_amount, opening_principal FROM loan_payment_schedule WHERE loan_id = ? ORDER BY installment_number LIMIT 1", id)[0];
        expect(first).toEqual({ due_date: "2026-10-20", total_amount: 888.49, opening_principal: null });
        expect(count("loan_disbursements")).toBe(0);
        expect(count("loan_initial_expenses")).toBe(0);
    });
});

describe("Link candidate search", () => {
    it("offers only live, unclaimed transactions on the account, in the right direction, for exactly the amount", async () => {
        insert("overdraft_transaction_links", { id: "link-1", loan_id: "od", transaction_id: "od-draw", entry_kind: "DRAWDOWN" });
        const repository = new LoanSetupRepository();

        const credits = await repository.findLinkCandidates({ accountId: BANK, side: "IN", amount: 712_182, aroundDate: "2026-02-05" });
        expect(credits.map(t => t.id)).toEqual(["credit-net"]);

        const anyCredit = await repository.findLinkCandidates({ accountId: BANK, side: "IN", amount: null, aroundDate: "2026-02-05" });
        expect(anyCredit.map(t => t.id)).toEqual(["credit-net", "stage-2"]); // od-draw is claimed; deleted and 2790 rows never appear

        const debits = await repository.findLinkCandidates({ accountId: BANK, side: "OUT", amount: 10_620, aroundDate: null });
        expect(debits.map(t => [t.id, t.categoryName])).toEqual([["legal-fee", "Bank Charges"]]);
    });
});

describe("Add Loan - a loan already running before FinWea (historical instalments)", () => {
    const EMI = 8_290.49;

    beforeEach(() => {
        // "Today" is 04/11/2026: instalments 1-8 (05/03 .. 05/10) are due,
        // instalment 9 (05/11/2026) is still in the future.
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-11-04T12:00:00"));
        addTransaction("emi-mar", { type: "expense", amount: EMI, date: "2026-03-05" });
        addTransaction("emi-apr", { type: "transfer", direction: "OUT", amount: EMI, date: "2026-04-06" });
        addTransaction("emi-apr-dup", { type: "expense", amount: EMI, date: "2026-04-08" });
        addTransaction("not-emi", { type: "expense", amount: 8_291, date: "2026-05-05" });
        addTransaction("emi-other-acct", { type: "expense", amount: EMI, date: "2026-05-05", accountId: OTHER });
        sqlite.db!.prepare("UPDATE transactions SET original_narration = ? WHERE id = ?").run("ACH/ECS TXLNA0999000000000017 TATA CAPITAL", "emi-apr-dup");
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    async function runningDraft(count: number): Promise<LoanSetupDraft> {
        const draft = await termDraft();
        draft.historicalCount = count;
        draft.historical = Array.from({ length: count }, () => ({ resolution: null, transaction: null }));
        return draft;
    }

    async function matchesFor(draft: LoanSetupDraft) {
        const schedule = unmarkedSchedulePreview(draft).schedule.slice(0, draft.historicalCount);
        const found = await new LoanSetupRepository().findHistoricalEmiCandidates({
            accountId: BANK,
            amounts: schedule.map(row => row.totalAmount),
            fromDate: "2026-02-20",
            toDate: "2026-06-30",
        });
        return matchHistoricalEmiDebits(schedule, found, {
            accountId: BANK,
            loanStartDate: draft.startDate,
            today: localToday(),
            loanAccountNumber: draft.loanAccountNumber,
            lenderName: draft.lenderName,
        });
    }

    it("finds only exact-amount debits on the EMI account near each due date, and links nothing by itself", async () => {
        const draft = await runningDraft(3);
        const matches = await matchesFor(draft);

        expect(matches.get(1)!.map(c => c.transaction.id)).toEqual(["emi-mar"]);
        // The narration with the loan account number ranks first.
        expect(matches.get(2)!.map(c => c.transaction.id)).toEqual(["emi-apr-dup", "emi-apr"]);
        expect(matches.get(2)![0]!.reasons).toContain("Narration has the loan account number");
        // 8,291 is not 8,290.49 (no tolerance) and 2790 is not the EMI account.
        expect(matches.get(3)).toEqual([]);

        // Suggestions are only suggestions: the draft is still unresolved and cannot be saved.
        const suggestions = suggestHistoricalLinks(matches);
        expect([...suggestions.keys()]).toEqual([1, 2]);
        expect(draft.historical.every(item => item.resolution === null)).toBe(true);
        expect(validateStep(draft, "review").map(i => i.message).join(" ")).toMatch(/Instalment #1: link its bank debit, or mark it "Settled before FinWea"/);
        expect(() => draftToCreateRequest(draft)).toThrow(/Resolve each instalment paid before FinWea/);
        expect(count("loans")).toBe(0);
    });

    it("saves confirmed links as real linked payments and declared settlements as flagged, payment-free instalments", async () => {
        const before = snapshotTransactions();
        const draft = await runningDraft(3);
        draft.historical = [
            { resolution: "LINKED", transaction: await summary("emi-mar") },
            { resolution: "LINKED", transaction: await summary("emi-apr") },
            { resolution: "SETTLED_BEFORE_FINWEA", transaction: null },
        ];
        expect(validateStep(draft, "review")).toEqual([]);

        const request = draftToCreateRequest(draft);
        expect(request.paidInstallments).toBe(3);
        const id = await new LoanService().create(request);

        expect(snapshotTransactions()).toEqual(before);
        const rows = all("SELECT installment_number, status, paid_date, paid_amount, transaction_id, settled_before_finwea FROM loan_payment_schedule WHERE loan_id = ? ORDER BY installment_number LIMIT 4", id);
        expect(rows).toEqual([
            { installment_number: 1, status: "PAID", paid_date: "2026-03-05", paid_amount: EMI, transaction_id: "emi-mar", settled_before_finwea: 0 },
            { installment_number: 2, status: "PAID", paid_date: "2026-04-06", paid_amount: EMI, transaction_id: "emi-apr", settled_before_finwea: 0 },
            { installment_number: 3, status: "PAID", paid_date: "2026-05-05", paid_amount: EMI, transaction_id: null, settled_before_finwea: 1 },
            { installment_number: 4, status: "UPCOMING", paid_date: null, paid_amount: null, transaction_id: null, settled_before_finwea: 0 },
        ]);
        // Two real payments; the settlement has none.
        expect(all("SELECT transaction_id, amount, transaction_linked FROM loan_schedule_payments WHERE loan_id = ? ORDER BY payment_date", id)).toEqual([
            { transaction_id: "emi-mar", amount: EMI, transaction_linked: 1 },
            { transaction_id: "emi-apr", amount: EMI, transaction_linked: 1 },
        ]);

        const loan = (await new LoanRepository().getById(id))!;
        expect(loan.paidInstallments).toBe(3);
        const third = all("SELECT outstanding_principal FROM loan_payment_schedule WHERE loan_id = ? AND installment_number = 3", id)[0]!;
        expect(loan.outstandingPrincipal).toBe(third.outstanding_principal);
    });

    it("refuses one bank debit for two instalments", async () => {
        const draft = await runningDraft(2);
        const debit = await summary("emi-mar");
        draft.historical = [
            { resolution: "LINKED", transaction: debit },
            { resolution: "LINKED", transaction: debit },
        ];

        expect(validateStep(draft, "schedule").map(i => i.message).join(" ")).toMatch(/already used by another instalment/);
        await expect(new LoanService().create(draftToCreateRequest(draft))).rejects.toThrow(/already used by another instalment/);
        expect(count("loans")).toBe(0);
    });

    it("refuses a debit another loan's EMI payment already uses", async () => {
        insert("loan_schedule_payments", { id: "pay-x", loan_id: "x", schedule_id: "y", transaction_id: "emi-mar", payment_date: "2026-03-05", amount: EMI, principal_amount: 1, interest_amount: 0 });
        const draft = await runningDraft(1);
        draft.historical = [{ resolution: "LINKED", transaction: await summary("emi-mar") }];

        await expect(new LoanService().create(draftToCreateRequest(draft))).rejects.toThrow(/already used by a loan EMI payment/);
        expect(count("loans")).toBe(0);
    });

    it("never marks a future instalment paid", async () => {
        const draft = await runningDraft(9);
        draft.historical = Array.from({ length: 9 }, () => ({ resolution: "SETTLED_BEFORE_FINWEA" as const, transaction: null }));

        expect(validateStep(draft, "schedule").map(i => i.message)).toContain(
            "Only 8 instalments are due on or before today - a future instalment cannot be marked paid."
        );
        // Even past the wizard, the service refuses it.
        await expect(new LoanService().create(draftToCreateRequest(draft))).rejects.toThrow(/Instalment #9 is due on 2026-11-05, after today/);
        expect(count("loans")).toBe(0);
    });

    it("refuses a bare paid-instalment count (the old behaviour) for any caller", async () => {
        await expect(
            new LoanService().create({
                loanKind: LoanKind.TERM_LOAN,
                loanType: "Home Loan",
                name: "Count only",
                principalAmount: 10_000,
                interestRate: 12,
                interestType: "REDUCING",
                tenureMonths: 12,
                startDate: "2026-01-20",
                paidInstallments: 2,
                outstandingPrincipal: 10_000,
                outstandingInterest: 0,
                currencyId: "INR",
                status: "ACTIVE",
                accountId: BANK,
            })
        ).rejects.toThrow(/can't be entered as a count/);
        expect(count("loans")).toBe(0);
    });

    it("Edit Loan cannot change the paid-instalment count; it stays derived from the schedule", async () => {
        const draft = await runningDraft(1);
        draft.historical = [{ resolution: "SETTLED_BEFORE_FINWEA", transaction: null }];
        const id = await new LoanService().create(draftToCreateRequest(draft));
        const loan = (await new LoanRepository().getById(id))!;
        const edit = {
            id,
            loanKind: loan.loanKind,
            loanType: loan.loanType,
            name: "Renamed",
            principalAmount: loan.principalAmount,
            interestRate: loan.interestRate,
            interestType: loan.interestType,
            tenureMonths: loan.tenureMonths,
            emiAmount: loan.emiAmount,
            startDate: loan.startDate,
            maturityDate: loan.maturityDate,
            currencyId: loan.currencyId,
            status: loan.status,
            accountId: loan.accountId,
        };

        await expect(new LoanService().update({ ...edit, paidInstallments: 5 })).rejects.toThrow(/comes from the EMI schedule and can't be edited/);

        await new LoanService().update(edit);
        const after = (await new LoanRepository().getById(id))!;
        expect(after.name).toBe("Renamed");
        expect(after.paidInstallments).toBe(1);
        expect(all("SELECT COUNT(*) AS n FROM loan_payment_schedule WHERE loan_id = ? AND status = 'PAID'", id)[0]!.n).toBe(1);
    });

    it("a loan with linked historical payments cannot be deleted until they are reversed", async () => {
        const draft = await runningDraft(1);
        draft.historical = [{ resolution: "LINKED", transaction: await summary("emi-mar") }];
        const id = await new LoanService().create(draftToCreateRequest(draft));

        await expect(new LoanService().delete(id)).rejects.toThrow(/recorded payments/);
        expect(invoke).not.toHaveBeenCalledWith("delete_loan_atomic", expect.anything());
        expect(all("SELECT deleted_at FROM loans WHERE id = ?", id)[0]!.deleted_at).toBeNull();
    });
});

// ---------------------------------------------------------------------
// The whole Term Loan statement workflow: a lender PDF (the synthetic
// reference statement, as positioned text) -> engine -> customer review ->
// Add Loan draft -> the customer's links -> one atomic save. Only synthetic
// figures; no real statement is read.
// ---------------------------------------------------------------------
describe("Term Loan from a lender PDF statement, end to end", () => {
    const EMI = 8_199;
    const MONTHS = ["03", "04", "05", "06", "07", "08", "09", "10", "11"];
    const TABLES = ["loans", "accounts", "institutions", "loan_payment_schedule", "loan_schedule_payments", "loan_disbursements", "loan_initial_expenses", "transactions"];
    const counts = () => TABLES.map(count);

    function statement() {
        const path = join(__dirname, "../../../../../../packages/import-engine/src/tests/loanStatement/fixtures/term-reference.tokens.json");
        const tokens = JSON.parse(readFileSync(path, "utf8")) as Array<Array<[number, number, number, number, string]>>;
        const analysis = analyseLoanStatement(documentFromItems(tokens.map(page => page.map(([x, y, width, height, text]) => ({ x, y, width, height, text })))));
        expect(analysis.status).toBe("OK");
        return analysis.facilities[0]!;
    }

    beforeEach(() => {
        // "Today" is 10/11/2026: the statement's nine instalments (05/03 .. 05/11) are due.
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-11-10T12:00:00"));
        addTransaction("stmt-net", { type: "transfer", direction: "IN", amount: 712_182, date: "2026-02-11", categoryId: LOAN_CATEGORY });
        MONTHS.forEach(month => addTransaction(`stmt-emi-${month}`, { type: "expense", amount: EMI, date: `2026-${month}-05` }));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /** What the customer adds on the wizard steps: name, accounts, links. */
    async function completedDraft(): Promise<LoanSetupDraft> {
        const { draft } = reviewToDraft(setConfirmed(createReviewState(statement(), "term.pdf"), true));
        const full = { ...emptyLoanSetupDraft(LoanKind.TERM_LOAN, "INR"), ...draft, name: "Synthetic LAP", currencyId: "INR", linkedAccountId: BANK } as LoanSetupDraft;
        full.disbursements = full.disbursements.map(row => ({ ...row, destinationAccountId: BANK }));
        full.disbursements[0]!.transaction = await summary("stmt-net");
        full.historicalCount = MONTHS.length;
        full.historical = await Promise.all(MONTHS.map(async month => ({ resolution: "LINKED" as const, transaction: await summary(`stmt-emi-${month}`) })));
        return full;
    }

    it("reading, reviewing and cancelling a statement writes nothing and calls no command", () => {
        const before = counts();
        const review = createReviewState(statement(), "term.pdf");

        expect(review.selectedType).toBe("TERM_LOAN");
        expect(() => reviewToDraft(review)).toThrow(/Tick the confirmation/);
        expect(counts()).toEqual(before);
        expect(invoke).not.toHaveBeenCalled();
    });

    it("saves the confirmed statement as one loan: principal, deducted charges, linked payout and linked EMIs, with no new transaction", async () => {
        const transactionsBefore = snapshotTransactions();
        const draft = await completedDraft();
        for (const step of ["basics", "disbursement", "expenses", "repayment", "schedule", "review"] as const) {
            expect(validateStep(draft, step), step).toEqual([]);
        }

        const id = await new LoanService().create(draftToCreateRequest(draft));

        // Transactions are linked, never created or changed.
        expect(snapshotTransactions()).toEqual(transactionsBefore);

        const [loan] = all("SELECT loan_account_number, principal_amount, emi_amount, start_date, schedule_source, paid_installments FROM loans WHERE id = ?", id);
        expect(loan).toEqual({ loan_account_number: "XLOAN0000000000000001", principal_amount: 750_000, emi_amount: EMI, start_date: "2026-01-31", schedule_source: "GENERATED", paid_installments: 9 });

        // Gross liability, net payout linked to its bank credit, charges withheld once.
        expect(all("SELECT gross_amount, deductions_amount, net_amount, transaction_id FROM loan_disbursements WHERE loan_id = ?", id)).toEqual([
            { gross_amount: 750_000, deductions_amount: 37_818, net_amount: 712_182, transaction_id: "stmt-net" },
        ]);
        const expenses = all<{ total_amount: number; settlement: string; transaction_id: string | null }>("SELECT total_amount, settlement, transaction_id FROM loan_initial_expenses WHERE loan_id = ?", id);
        expect(expenses.reduce((sum, row) => sum + row.total_amount, 0)).toBeCloseTo(37_818, 2);
        expect(expenses.every(row => row.settlement === "DEDUCTED_FROM_DISBURSEMENT" && row.transaction_id === null)).toBe(true);

        // Each EMI debit is one real payment against its own instalment, split as the schedule says.
        const payments = all<{ transaction_id: string; amount: number; principal_amount: number; interest_amount: number }>(
            "SELECT p.transaction_id, p.amount, p.principal_amount, p.interest_amount FROM loan_schedule_payments p JOIN loan_payment_schedule s ON s.id = p.schedule_id WHERE p.loan_id = ? ORDER BY s.installment_number",
            id
        );
        expect(payments.map(row => row.transaction_id)).toEqual(MONTHS.map(month => `stmt-emi-${month}`));
        for (const row of payments) {
            expect(row.amount).toBe(EMI);
            expect(Math.round((row.principal_amount + row.interest_amount) * 100) / 100).toBe(EMI);
        }

        // Outstanding = principal less the principal of the nine paid instalments.
        const schedule = all<{ principal_amount: number; outstanding_principal: number; status: string }>(
            "SELECT principal_amount, outstanding_principal, status FROM loan_payment_schedule WHERE loan_id = ? ORDER BY installment_number",
            id
        );
        const repaid = schedule.slice(0, 9).reduce((sum, row) => sum + row.principal_amount, 0);
        const stored = (await new LoanRepository().getById(id))!;
        expect(stored.outstandingPrincipal).toBeCloseTo(750_000 - repaid, 2);
        expect(schedule[8]!.outstanding_principal).toBeCloseTo(750_000 - repaid, 2);
        expect(schedule.filter(row => row.status === "PAID")).toHaveLength(9);
    });

    it("compares the statement's position with the loan and explains each difference without changing either", async () => {
        const result = reviewToDraft(setConfirmed(createReviewState(statement(), "term.pdf"), true));
        expect(result.statementFacts).toEqual({
            fileName: "term.pdf",
            asOf: "2026-11-09",
            grossDisbursed: 750_000,
            emiAmount: EMI,
            instalmentsPaid: 9,
            principalRepaidTotal: 15_093,
            outstandingPrincipal: 734_907,
        });

        const draft = await completedDraft();
        const schedule = unmarkedSchedulePreview(draft).schedule;
        const checks = compareWithStatement(result.statementFacts!, {
            principal: 750_000,
            schedule,
            resolved: historicalSummary(entriesFromDraft(schedule, draft.historical)).linked,
        });
        const byId = Object.fromEntries(checks.map(check => [check.id, check]));

        expect(byId.principal!.agrees).toBe(true);
        expect(byId.emi!.agrees).toBe(true);
        expect(byId.instalmentsResolved!.agrees).toBe(true);
        expect(byId.instalmentsDue).toMatchObject({ finwea: "9 due", agrees: true });
        // Reported either way; a difference carries an explanation.
        for (const key of ["principalRepaid", "outstanding"] as const) {
            expect(byId[key]!.statement).toBe(key === "outstanding" ? formatMoney(734_907) : formatMoney(15_093));
            expect(byId[key]!.agrees === (byId[key]!.explanation === null)).toBe(true);
        }
        // Neither the draft nor the statement figures were touched.
        expect(draft.principalAmount).toBe(750_000);
        expect(draft.emiAmount).toBe(EMI);
        expect(result.statementFacts!.outstandingPrincipal).toBe(734_907);
    });

    it("importing the same statement again is refused and leaves everything as it was", async () => {
        await new LoanService().create(draftToCreateRequest(await completedDraft()));
        const before = counts();
        const links = all("SELECT * FROM loan_schedule_payments ORDER BY id");

        const again = await completedDraft();
        // Even with no links at all, the loan itself is the duplicate.
        again.disbursements[0]!.transaction = null;
        again.historicalCount = 0;
        again.historical = [];
        await expect(new LoanService().create(draftToCreateRequest(again))).rejects.toThrow(/XLOAN0000000000000001 already exists/);

        expect(counts()).toEqual(before);
        expect(all("SELECT * FROM loan_schedule_payments ORDER BY id")).toEqual(links);
    });

    it("re-using an EMI debit already linked to another loan is refused, and nothing of the new loan is written", async () => {
        await new LoanService().create(draftToCreateRequest(await completedDraft()));
        const before = counts();

        const other = await completedDraft();
        other.loanAccountNumber = "XLOAN0000000000000002";
        other.disbursements[0]!.transaction = null;
        await expect(new LoanService().create(draftToCreateRequest(other))).rejects.toThrow(/already used|already linked/);

        expect(counts()).toEqual(before);
    });

    it("a write failure part-way through the save rolls back the whole loan", async () => {
        const before = counts();
        const draft = await completedDraft();
        // A trigger makes a late setup write fail inside the transaction.
        sqlite.db!.exec("CREATE TRIGGER fail_expense BEFORE INSERT ON loan_initial_expenses BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END;");

        await expect(new LoanService().create(draftToCreateRequest(draft))).rejects.toThrow(/simulated disk failure/);
        expect(counts()).toEqual(before);
        sqlite.db!.exec("DROP TRIGGER fail_expense");
    });

    // ---- Saved straight from Statement Review (no Add Loan wizard) ----

    /** What the customer adds on Statement Review: only what a statement cannot give. */
    async function reviewCompletion(): Promise<StatementCompletion> {
        return {
            ...emptyStatementCompletion(),
            name: "Synthetic LAP",
            currencyId: "INR",
            linkedAccountId: BANK,
            disbursements: { "d-0": { destinationAccountId: BANK, transaction: await summary("stmt-net") } },
            historicalCount: MONTHS.length,
            historical: await Promise.all(MONTHS.map(async month => ({ resolution: "LINKED" as const, transaction: await summary(`stmt-emi-${month}`) }))),
        };
    }

    function fromReview(completion: StatementCompletion, review = createReviewState(statement(), "term.pdf")) {
        // The review's own confirmation tick is NOT set: the one final confirmation replaces it.
        const loan = statementLoanDraft(review, completion);
        if (loan.status !== "READY") throw new Error(loan.blockers.join("; "));
        return loan.draft;
    }

    it("Statement Review alone completes and saves the loan in one atomic write, the same as the wizard did", async () => {
        const transactionsBefore = snapshotTransactions();
        const draft = fromReview(await reviewCompletion());

        expect(statementSaveIssues(draft, await new LoanService().getAll())).toEqual([]);
        // Nothing is written until the save itself.
        expect(invoke).not.toHaveBeenCalled();

        const id = await new LoanService().create(draftToCreateRequest(draft));

        expect(invoke).toHaveBeenCalledTimes(1);
        expect(snapshotTransactions()).toEqual(transactionsBefore);
        const [loan] = all("SELECT name, loan_account_number, principal_amount, emi_amount, start_date, paid_installments FROM loans WHERE id = ?", id);
        expect(loan).toEqual({ name: "Synthetic LAP", loan_account_number: "XLOAN0000000000000001", principal_amount: 750_000, emi_amount: EMI, start_date: "2026-01-31", paid_installments: 9 });
        expect(all("SELECT net_amount, transaction_id FROM loan_disbursements WHERE loan_id = ?", id)).toEqual([{ net_amount: 712_182, transaction_id: "stmt-net" }]);
        expect(all("SELECT transaction_id FROM loan_schedule_payments WHERE loan_id = ? ORDER BY payment_date", id).map(row => (row as { transaction_id: string }).transaction_id)).toEqual(
            MONTHS.map(month => `stmt-emi-${month}`)
        );
    });

    it("cancelling Statement Review writes nothing, whatever the customer filled in", async () => {
        const before = counts();
        fromReview(await reviewCompletion());

        expect(counts()).toEqual(before);
        expect(invoke).not.toHaveBeenCalled();
    });

    it("the same statement reviewed again is refused before the save, and by the save itself", async () => {
        await new LoanService().create(draftToCreateRequest(fromReview(await reviewCompletion())));
        const before = counts();

        const again = fromReview({ ...(await reviewCompletion()), disbursements: { "d-0": { destinationAccountId: BANK, transaction: null } }, historicalCount: 0, historical: [] });
        expect(statementSaveIssues(again, await new LoanService().getAll()).map(issue => issue.field)).toContain("loanAccountNumber");
        await expect(new LoanService().create(draftToCreateRequest(again))).rejects.toThrow(/XLOAN0000000000000001 already exists/);

        expect(counts()).toEqual(before);
    });

    it("a charge paid separately is saved linked to its existing bank debit, unchanged, and that debit cannot be used twice", async () => {
        // The 20,000 charge was paid from the bank, not withheld: 17,818 was
        // withheld, so the bank received 7,32,182. Synthetic debits only.
        addTransaction("stmt-net-2", { type: "transfer", direction: "IN", amount: 732_182, date: "2026-02-11", categoryId: LOAN_CATEGORY });
        addTransaction("stmt-iho", { type: "expense", amount: 20_000, date: "2026-01-31", categoryId: FEE_CATEGORY });
        const transactionsBefore = snapshotTransactions();
        const review = updateDisbursement(createReviewState(statement(), "term.pdf"), "d-0", { deductions: 17_818 });
        const completion: StatementCompletion = {
            ...(await reviewCompletion()),
            disbursements: { "d-0": { destinationAccountId: BANK, transaction: await summary("stmt-net-2") } },
            charges: { "c-8": { settlement: "PAID_SEPARATELY", paymentAccountId: BANK, transaction: await summary("stmt-iho") } },
        };
        const draft = fromReview(completion, review);

        expect(statementSaveIssues(draft, await new LoanService().getAll())).toEqual([]);
        const id = await new LoanService().create(draftToCreateRequest(draft));

        expect(snapshotTransactions()).toEqual(transactionsBefore);
        const separately = all<{ total_amount: number; settlement: string; transaction_id: string | null; payment_account_id: string | null }>(
            "SELECT total_amount, settlement, transaction_id, payment_account_id FROM loan_initial_expenses WHERE loan_id = ? AND settlement = 'PAID_SEPARATELY'",
            id
        );
        expect(separately).toEqual([{ total_amount: 20_000, settlement: "PAID_SEPARATELY", transaction_id: "stmt-iho", payment_account_id: BANK }]);
        const deducted = all<{ total_amount: number }>("SELECT total_amount FROM loan_initial_expenses WHERE loan_id = ? AND settlement = 'DEDUCTED_FROM_DISBURSEMENT'", id);
        expect(deducted.reduce((sum, row) => sum + row.total_amount, 0)).toBeCloseTo(17_818, 2);

        // The same debit for another loan's charge is refused, and nothing of it is written.
        const before = counts();
        const other = fromReview({ ...completion, disbursements: { "d-0": { destinationAccountId: BANK, transaction: null } }, historicalCount: 0, historical: [] }, review);
        other.loanAccountNumber = "XLOAN0000000000000002";
        await expect(new LoanService().create(draftToCreateRequest(other))).rejects.toThrow(/already used|already linked/);
        expect(counts()).toEqual(before);
    });

    it("Additional Loan Details are saved when given, and nothing else changes", async () => {
        const draft = fromReview({ ...(await reviewCompletion()), purpose: "Synthetic working capital", gracePeriodMonths: 1 });
        const id = await new LoanService().create(draftToCreateRequest(draft));

        const [loan] = all("SELECT loan_purpose, grace_period_months, principal_amount, emi_amount FROM loans WHERE id = ?", id);
        expect(loan).toEqual({ loan_purpose: "Synthetic working capital", grace_period_months: 1, principal_amount: 750_000, emi_amount: EMI });
    });

    it("a loan saved from Statement Review records its initial rate in the same save (migration 054)", async () => {
        applyRateHistoryMigration();
        const id = await new LoanService().create(draftToCreateRequest(fromReview(await reviewCompletion())));

        // The statement's original rate (10.5%) from the disbursement date; floating per the statement.
        expect(rateRows()).toEqual([{ loan_id: id, effective_from: "2026-01-31", rate: 10.5, previous_rate: null, rate_type: "FLOATING", source: "INITIAL", superseded_at: null }]);
        expect(all("SELECT interest_rate FROM loans WHERE id = ?", id)).toEqual([{ interest_rate: 10.5 }]);
    });

    it("a failure inside the save from Statement Review rolls back everything", async () => {
        const before = counts();
        sqlite.db!.exec("CREATE TRIGGER fail_payment BEFORE INSERT ON loan_schedule_payments BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END;");

        await expect(new LoanService().create(draftToCreateRequest(fromReview(await reviewCompletion())))).rejects.toThrow(/simulated disk failure/);
        expect(counts()).toEqual(before);
        sqlite.db!.exec("DROP TRIGGER fail_payment");
    });
});

// ---------------------------------------------------------------------
// Interest Rate History, Stage 1: migration 054 + the initial rate row,
// written with the loan in create_loan_atomic. Synthetic loans only.
// ---------------------------------------------------------------------
describe("Interest Rate History - the initial rate of a new loan", () => {
    const TABLES = ["loans", "accounts", "institutions", "loan_payment_schedule", "loan_schedule_payments", "loan_disbursements", "loan_initial_expenses", "transactions"];
    const counts = () => TABLES.map(count);

    async function overdraft() {
        const draft = emptyLoanSetupDraft(LoanKind.OVERDRAFT, "INR");
        Object.assign(draft, {
            name: "Synthetic OD",
            lenderName: "Synthetic Lender",
            loanAccountNumber: "SYN-OD-0001",
            interestRate: 11.25,
            startDate: "2026-02-15",
            creditLimit: 1_000_000,
            openingUsed: 0,
            openingUsedAsOf: "2026-02-15",
            odAccountIds: [BANK],
        });
        return await new LoanService().create(draftToCreateRequest(draft));
    }

    it("a manually entered Term Loan records its rate from its start date, with its rate type", async () => {
        applyRateHistoryMigration();
        const id = await new LoanService().create(draftToCreateRequest(await termDraft()));

        expect(rateRows()).toEqual([{ loan_id: id, effective_from: "2026-02-05", rate: 10.5, previous_rate: null, rate_type: "FLOATING", source: "INITIAL", superseded_at: null }]);
        // Nothing else about the loan changes: its rate stays on the loan too.
        expect((await new LoanRepository().getById(id))!).toMatchObject({ interestRate: 10.5, emiAmount: 8_290.49 });
    });

    it("an Overdraft records its initial rate too", async () => {
        applyRateHistoryMigration();
        const id = await overdraft();

        expect(rateRows()).toEqual([{ loan_id: id, effective_from: "2026-02-15", rate: 11.25, previous_rate: null, rate_type: "FIXED", source: "INITIAL", superseded_at: null }]);
    });

    it("is read back with no end date, as the rate in effect from the start date only", async () => {
        applyRateHistoryMigration();
        const id = await new LoanService().create(draftToCreateRequest(await termDraft()));
        const repository = new InterestRateHistoryRepository();

        expect(await repository.isAvailable()).toBe(true);
        expect(await repository.findByLoan(id)).toMatchObject([{ loanId: id, effectiveFrom: "2026-02-05", effectiveUntil: null, rate: 10.5, source: "INITIAL" }]);
        expect((await repository.findInEffectOn(id, "2026-08-01"))?.rate).toBe(10.5);
        expect(await repository.findInEffectOn(id, "2026-02-04")).toBeNull();
    });

    it("a failure inside the save leaves no rate row, with the rest of the loan", async () => {
        applyRateHistoryMigration();
        const before = counts();
        // A late setup write fails after the rate row has been inserted.
        sqlite.db!.exec("CREATE TRIGGER fail_expense BEFORE INSERT ON loan_initial_expenses BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END;");

        await expect(new LoanService().create(draftToCreateRequest(await termDraft()))).rejects.toThrow(/simulated disk failure/);

        expect(counts()).toEqual(before);
        expect(rateRows()).toEqual([]);
        sqlite.db!.exec("DROP TRIGGER fail_expense");
    });

    it("a refused duplicate loan writes no rate row", async () => {
        applyRateHistoryMigration();
        await new LoanService().create(draftToCreateRequest(await termDraft()));
        const rows = rateRows();

        const again = await termDraft();
        again.disbursements[0]!.transaction = null;
        again.expenses = again.expenses.filter(e => e.settlement !== "PAID_SEPARATELY");
        await expect(new LoanService().create(draftToCreateRequest(again))).rejects.toThrow(/already exists/);

        expect(rateRows()).toEqual(rows);
    });

    it("on a database not yet at 054, a loan is created exactly as before, and no history is read", async () => {
        const id = await new LoanService().create(draftToCreateRequest(await termDraft()));

        expect(all("SELECT name FROM sqlite_master WHERE name = 'loan_interest_rate_history'")).toEqual([]);
        expect((await new LoanRepository().getById(id))!.interestRate).toBe(10.5);
        expect(await new InterestRateHistoryRepository().isAvailable()).toBe(false);
        expect(await new InterestRateHistoryRepository().findByLoan(id)).toEqual([]);
    });

    it("an existing loan gets no history when 054 is applied later, and is otherwise untouched", async () => {
        const id = await new LoanService().create(draftToCreateRequest(await termDraft()));
        const loanBefore = all("SELECT * FROM loans WHERE id = ?", id);
        const scheduleBefore = all("SELECT * FROM loan_payment_schedule WHERE loan_id = ? ORDER BY installment_number", id);

        applyRateHistoryMigration();

        expect(rateRows()).toEqual([]);
        expect(await new InterestRateHistoryRepository().findByLoan(id)).toEqual([]);
        expect(all("SELECT * FROM loans WHERE id = ?", id)).toEqual(loanBefore);
        expect(all("SELECT * FROM loan_payment_schedule WHERE loan_id = ? ORDER BY installment_number", id)).toEqual(scheduleBefore);
    });

    it("every create sends a fresh rate-row id, so two loans never collide", async () => {
        applyRateHistoryMigration();
        await new LoanService().create(draftToCreateRequest(await termDraft()));
        await overdraft();

        const ids = invoke.mock.calls.map(([, args]) => (args as { request: { initialRateHistoryId?: string } }).request.initialRateHistoryId);
        expect(ids).toHaveLength(2);
        expect(ids.every(id => typeof id === "string" && id.length > 0)).toBe(true);
        expect(new Set(ids).size).toBe(2);
        expect(rateRows()).toHaveLength(2);
    });
});
