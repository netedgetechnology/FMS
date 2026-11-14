import { DatabaseSync } from "node:sqlite";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NormalizedTransactionCandidate } from "@financeos/import-engine";

import { migrations } from "@/core/database/migrations/registry";
import { ImportService } from "@/modules/imports/services/ImportService";
import { TransactionService } from "@/modules/transactions/services/TransactionService";

import { EMIScheduleGenerator } from "./EMIScheduleGenerator";
import { LoanPaymentService } from "./LoanPaymentService";
import { LoanTransactionLinkService, type LoanLinkMode } from "./LoanTransactionLinkService";
import { describeLoanImportPayments } from "@/modules/imports/pages/importLoanPaymentMessage";
import { LoanRepository } from "../repositories/LoanRepository";
import { LoanSchedulePaymentRepository } from "../repositories/LoanSchedulePaymentRepository";
import { COULD_NOT_CHECK_IMPORT_REASON, COULD_NOT_RECORD_REASON } from "./LoanImportPaymentService";

// ---------------------------------------------------------------------
// Automatic loan EMI matching on statement import, end to end: the real
// ImportService, LoanImportPaymentService, LoanPaymentService and
// repositories run against an in-memory database built from every FinWea
// migration - never the production database. Only the Tauri IPC is
// replaced: the atomic EMI commands (src-tauri/src/loan_payment.rs, which
// has its own tests) are replayed here with the same SQL and the same
// refusals, inside a real SQLite transaction.
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

const REFUSED = "EMI_PAYMENT_REFUSED: ";

interface AtomicSchedule { id: string; status: string; paidDate: string | null; paidAmount: number | null; transactionId: string | null }
interface AtomicLoan { id: string; outstandingPrincipal: number; outstandingInterest: number; status: string }

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

function writeScheduleAndLoan(db: DatabaseSync, schedule: AtomicSchedule, loan: AtomicLoan): void {
    db.prepare("UPDATE loan_payment_schedule SET status = ?, paid_date = ?, paid_amount = ?, transaction_id = ? WHERE id = ?")
        .run(schedule.status, schedule.paidDate, schedule.paidAmount, schedule.transactionId, schedule.id);
    db.prepare("UPDATE loans SET outstanding_principal = ?, outstanding_interest = ?, status = ? WHERE id = ?")
        .run(loan.outstandingPrincipal, loan.outstandingInterest, loan.status, loan.id);
}

const invoke = vi.fn(async (command: string, args: { request: Record<string, any> }) => {
    const request = args.request;

    if (command === "record_emi_payment_atomic") {
        atomically(db => {
            const payment = request.payment;
            const schedule = db.prepare("SELECT status, total_amount AS total FROM loan_payment_schedule WHERE id = ?").get(payment.scheduleId) as { status: string; total: number };
            const paid = (db.prepare("SELECT COALESCE(SUM(amount), 0) AS paid FROM loan_schedule_payments WHERE schedule_id = ?").get(payment.scheduleId) as { paid: number }).paid;
            if (schedule.status === "PAID") throw `${REFUSED}This EMI installment has already been paid.`;
            if (payment.amount > schedule.total - paid + 0.005) throw `${REFUSED}only ${(schedule.total - paid).toFixed(2)} remains on this installment.`;
            if (payment.settlesInstallment && (payment.amount >= schedule.total - paid - 0.005 || request.schedule.status !== "PAID")) {
                throw `${REFUSED}Only a payment for less than what remains can settle an installment in full.`;
            }
            if (db.prepare("SELECT id FROM loan_schedule_payments WHERE transaction_id = ?").get(payment.transactionId)) {
                throw `${REFUSED}This transaction is already recorded as a loan payment.`;
            }
            const t = request.transaction;
            if (t) {
                db.prepare(`INSERT INTO transactions (id, account_id, payee, type, amount, transaction_date, notes, status, payment_method, is_imported, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                    .run(t.id, t.accountId, t.payee, t.type, t.amount, t.transactionDate, t.notes, t.status, t.paymentMethod, t.isImported ? 1 : 0, t.createdAt, t.updatedAt);
            } else {
                const existing = db.prepare("SELECT type, transfer_direction, amount FROM transactions WHERE id = ? AND deleted_at IS NULL").get(payment.transactionId) as { type: string; transfer_direction: string | null; amount: number } | undefined;
                if (!existing) throw `${REFUSED}The linked transaction was not found.`;
                if (!(existing.type === "expense" || (existing.type === "transfer" && existing.transfer_direction === "OUT"))) throw `${REFUSED}Only an outgoing transaction (an Expense or a Transfer Out) can record a loan payment.`;
                if (Math.abs(existing.amount - payment.amount) > 0.005) throw `${REFUSED}The payment amount does not match the linked transaction.`;
            }
            db.prepare(`INSERT INTO loan_schedule_payments (id, loan_id, schedule_id, transaction_id, payment_date, amount, principal_amount, interest_amount, transaction_linked, settles_installment)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(payment.id, payment.loanId, payment.scheduleId, payment.transactionId, payment.paymentDate, payment.amount, payment.principalAmount, payment.interestAmount,
                    t ? 0 : 1, payment.settlesInstallment ? 1 : 0);
            writeScheduleAndLoan(db, request.schedule, request.loan);
        });
        return;
    }

    if (command === "reverse_emi_payment_atomic") {
        atomically(db => {
            const payment = db.prepare("SELECT transaction_id AS txn, transaction_linked AS linked FROM loan_schedule_payments WHERE id = ?").get(request.paymentId) as { txn: string; linked: number } | undefined;
            if (!payment) throw `${REFUSED}This payment record was not found. It may have already been reversed.`;
            if (request.transactionId && request.transactionId === payment.txn && payment.linked === 0) {
                db.prepare("UPDATE transactions SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL AND COALESCE(is_imported, 0) = 0").run(request.transactionId);
            }
            db.prepare("DELETE FROM loan_schedule_payments WHERE id = ?").run(request.paymentId);
            writeScheduleAndLoan(db, request.schedule, request.loan);
        });
        return;
    }

    throw new Error(`Unexpected command ${command}`);
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...(args as [string, never])) }));

// Inserts a row, filling every NOT NULL column without a default with a
// placeholder so a test only states what it is about.
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
// loanLinkEligibility.ts) - the statement debits here are loan EMIs.
const LOAN_CATEGORY = "cat-loan-installment";
const OTHER_BANK = "acct-other";

interface SeedLoan {
    id: string;
    name: string;
    lender?: string | null;
    accountId?: string;
    principal: number;
    rate: number;
    tenure: number;
    emi: number;
    firstInstallment?: number | null;
    startDate: string;
}

// A loan exactly as LoanService creates it: the real schedule generator
// (with or without a custom first instalment) and outstanding balances
// from the generated schedule.
function seedLoan(spec: SeedLoan): void {
    let lenderId: string | null = null;
    if (spec.lender) {
        lenderId = `inst-${spec.id}`;
        insert("institutions", { id: lenderId, name: spec.lender, type: "NBFC" });
    }
    const schedule = new EMIScheduleGenerator().generate({
        loanId: spec.id,
        principalAmount: spec.principal,
        interestRate: spec.rate,
        interestType: "REDUCING",
        tenureMonths: spec.tenure,
        emiAmount: spec.emi,
        startDate: spec.startDate,
        firstInstallmentAmount: spec.firstInstallment ?? null,
    });
    insert("loans", {
        id: spec.id, account_id: spec.accountId ?? BANK, lender_institution_id: lenderId,
        loan_type: "HOME", name: spec.name, principal_amount: spec.principal, interest_rate: spec.rate,
        interest_type: "REDUCING", tenure_months: spec.tenure, emi_amount: spec.emi,
        first_installment_amount: spec.firstInstallment ?? null, start_date: spec.startDate,
        outstanding_principal: spec.principal,
        outstanding_interest: Math.round(schedule.reduce((sum, row) => sum + row.interestAmount, 0) * 100) / 100,
        paid_installments: 0, currency_id: "cur-inr", status: "ACTIVE",
    });
    for (const row of schedule) {
        insert("loan_payment_schedule", {
            id: row.id, loan_id: spec.id, installment_number: row.installmentNumber, due_date: row.dueDate,
            principal_amount: row.principalAmount, interest_amount: row.interestAmount, total_amount: row.totalAmount,
            outstanding_principal: row.outstandingPrincipal, status: row.status,
        });
    }
}

// Like the user's loan: a custom first instalment of 68,943, then
// regular EMIs of 1,51,167.39 - but a fictional lender, to show nothing
// about any particular loan is assumed.
const CUSTOM_FIRST: SeedLoan = {
    id: "loan-nw", name: "Northwind Capital", lender: "Northwind Capital",
    principal: 13300000, rate: 11, tenure: 180, emi: 151167.39, firstInstallment: 68943, startDate: "2026-04-05",
};

const REGULAR: SeedLoan = {
    id: "loan-reg", name: "Car Loan", lender: "Contoso Bank",
    principal: 500000, rate: 9, tenure: 24, emi: 22842.47, startDate: "2026-01-10",
};

function candidate(rowNumber: number, overrides: Partial<NormalizedTransactionCandidate>): NormalizedTransactionCandidate {
    return {
        rowNumber, transactionDate: "2026-06-05", payee: "", description: `ROW ${rowNumber}`,
        amount: 100, type: "expense", referenceNumber: null, externalTransactionId: null,
        balance: null, branch: null, transactionType: null, counterparty: null, notes: null, rawData: {},
        categoryId: LOAN_CATEGORY,
        ...overrides,
    };
}

function importService(): ImportService {
    const service = new ImportService();
    // The learning store is irrelevant here.
    Object.defineProperty(service, "counterpartyRuleRepository", {
        value: { findByAccountAndPattern: async () => null, upsert: async () => null },
    });
    return service;
}

async function importStatement(rows: Array<Partial<NormalizedTransactionCandidate>>, accountId = BANK) {
    return await importService().importCandidates(
        accountId, "statement.csv", "BANK_CSV",
        rows.map((row, index) => candidate(index + 1, row)), "Test Mapping"
    );
}

const scheduleOf = (loanId: string) =>
    all<{ n: number; status: string; paid: number | null; total: number; txn: string | null }>(
        "SELECT installment_number AS n, status, paid_amount AS paid, total_amount AS total, transaction_id AS txn FROM loan_payment_schedule WHERE loan_id = ? ORDER BY installment_number", loanId
    );
const paymentsOf = (loanId: string) =>
    all<{ schedule: number; amount: number; txn: string; principal: number; interest: number }>(
        `SELECT s.installment_number AS schedule, p.amount, p.transaction_id AS txn, p.principal_amount AS principal, p.interest_amount AS interest
         FROM loan_schedule_payments p JOIN loan_payment_schedule s ON s.id = p.schedule_id WHERE p.loan_id = ? ORDER BY s.installment_number, p.payment_date`, loanId
    );
const loanRow = (loanId: string) =>
    all<{ principal: number; interest: number; status: string }>(
        "SELECT outstanding_principal AS principal, outstanding_interest AS interest, status FROM loans WHERE id = ?", loanId
    )[0]!;
const liveTransactions = () => all("SELECT * FROM transactions WHERE deleted_at IS NULL ORDER BY transaction_date, id");

const scheduleIdOf = (loanId: string, n: number) =>
    all<{ id: string }>("SELECT id FROM loan_payment_schedule WHERE loan_id = ? AND installment_number = ?", loanId, n)[0]!.id;

// The ids the Transactions page shows as linked (green icon).
const linkedIds = async () => new Set((await new LoanSchedulePaymentRepository().getAll()).map(p => p.transactionId));

// Transactions -> Link to Loan EMI, exactly as the dialog does it.
async function linkByHand(transactionId: string, loanId: string, n: number, mode: LoanLinkMode) {
    return await new LoanTransactionLinkService().link({ transactionId, loanId, scheduleId: scheduleIdOf(loanId, n), mode });
}

// Pays instalment 1 manually through the existing Record EMI Payment
// path (a new, non-imported transaction).
async function payFirstInstalmentManually(loanId: string, paymentDate: string) {
    const first = all<{ id: string }>("SELECT id FROM loan_payment_schedule WHERE loan_id = ? AND installment_number = 1", loanId)[0]!;
    return await new LoanPaymentService().processPayment({ loanId, scheduleId: first.id, paymentDate });
}

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
    invoke.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("automatic loan EMI matching on a confirmed statement import", () => {
    it("A. a regular loan's exact EMI debit pays its first instalment, linked to the imported transaction", async () => {
        seedLoan(REGULAR);
        const before = loanRow(REGULAR.id);
        const first = all<{ principal: number; interest: number }>(
            "SELECT principal_amount AS principal, interest_amount AS interest FROM loan_payment_schedule WHERE loan_id = ? AND installment_number = 1", REGULAR.id
        )[0]!;

        const batch = await importStatement([
            { transactionDate: "2026-02-10", amount: 22842.47, payee: "Contoso Bank", description: "NACH DR CONTOSO BANK LTD 88213" },
        ]);

        const [txn] = liveTransactions();
        expect(liveTransactions()).toHaveLength(1);
        expect(scheduleOf(REGULAR.id)[0]).toMatchObject({ n: 1, status: "PAID", paid: 22842.47, txn: txn!.id });
        expect(scheduleOf(REGULAR.id)[1]).toMatchObject({ status: "UPCOMING", paid: null });
        expect(paymentsOf(REGULAR.id)).toEqual([
            { schedule: 1, amount: 22842.47, txn: txn!.id, principal: first.principal, interest: first.interest },
        ]);
        // Balances move exactly as a manual full payment moves them.
        expect(loanRow(REGULAR.id).principal).toBeCloseTo(before.principal - first.principal, 2);
        expect(loanRow(REGULAR.id).interest).toBeCloseTo(before.interest - first.interest, 2);
        expect(batch.loanPayments?.applied).toEqual([
            expect.objectContaining({ transactionId: txn!.id, loanName: "Car Loan", installmentNumber: 1, installmentStatus: "PAID" }),
        ]);
    });

    it("B. custom first instalment already paid: the next regular EMI debit pays instalment 2, instalment 1 untouched", async () => {
        seedLoan(CUSTOM_FIRST);
        await payFirstInstalmentManually(CUSTOM_FIRST.id, "2026-04-06");
        const instalmentOneBefore = all("SELECT * FROM loan_payment_schedule WHERE loan_id = ? AND installment_number = 1", CUSTOM_FIRST.id);
        const rowsBefore = scheduleOf(CUSTOM_FIRST.id).length;

        await importStatement([
            { transactionDate: "2026-06-05", amount: 151167.39, payee: "", description: "ACH-DR-TP ACH NORTHWINDCAP-2293071249-UTIB001504" },
        ]);

        const schedule = scheduleOf(CUSTOM_FIRST.id);
        expect(schedule).toHaveLength(rowsBefore);
        expect(all("SELECT * FROM loan_payment_schedule WHERE loan_id = ? AND installment_number = 1", CUSTOM_FIRST.id)).toEqual(instalmentOneBefore);
        expect(schedule[0]).toMatchObject({ status: "PAID", total: 68943 });
        expect(schedule[1]).toMatchObject({ n: 2, status: "PAID", paid: 151167.39, total: 151167.39 });
        expect(schedule[2]).toMatchObject({ status: "UPCOMING" });
        expect(paymentsOf(CUSTOM_FIRST.id).map(p => [p.schedule, p.amount])).toEqual([[1, 68943], [2, 151167.39]]);
    });

    it("C. a debit that is not exactly what remains is never applied by guesswork - it is left for review", async () => {
        seedLoan(REGULAR);
        const scheduleBefore = all("SELECT * FROM loan_payment_schedule");

        const batch = await importStatement([
            { transactionDate: "2026-02-10", amount: 10000, payee: "Contoso Bank", description: "NACH DR CONTOSO" },
            // Just 0.47 short of the EMI - still not assumed to be rounding.
            { transactionDate: "2026-02-11", amount: 22842, payee: "Contoso Bank", description: "NACH DR CONTOSO" },
        ]);

        expect(all("SELECT * FROM loan_schedule_payments")).toHaveLength(0);
        expect(all("SELECT * FROM loan_payment_schedule")).toEqual(scheduleBefore);
        expect(liveTransactions()).toHaveLength(2);
        expect(batch.loanPayments?.applied).toEqual([]);
        expect(batch.loanPayments?.needsReview.map(item => item.reason)).toEqual([
            expect.stringContaining("10,000.00, not the 22,842.47 remaining"),
            expect.stringContaining("22,842.00, not the 22,842.47 remaining"),
        ]);
    });

    it("D. several partial payments accumulate - interest first - until the instalment is PAID", async () => {
        seedLoan(REGULAR);
        const first = all<{ principal: number; interest: number }>(
            "SELECT principal_amount AS principal, interest_amount AS interest FROM loan_payment_schedule WHERE loan_id = ? AND installment_number = 1", REGULAR.id
        )[0]!;

        // Partial amounts are left for review on import, then linked by
        // hand as partial payments.
        await importStatement([
            { transactionDate: "2026-02-03", amount: 2000, payee: "Contoso Bank", description: "NACH DR CONTOSO A" },
            { transactionDate: "2026-02-07", amount: 10000, payee: "Contoso Bank", description: "NACH DR CONTOSO B" },
        ]);
        expect(all("SELECT * FROM loan_schedule_payments")).toHaveLength(0);
        for (const txn of liveTransactions()) {
            await linkByHand(txn.id, REGULAR.id, 1, "partial");
        }
        expect(scheduleOf(REGULAR.id)[0]).toMatchObject({ status: "PARTIAL", paid: 12000 });

        await importStatement([
            { transactionDate: "2026-02-10", amount: 10842.47, payee: "Contoso Bank", description: "NACH DR CONTOSO C" },
        ]);

        expect(scheduleOf(REGULAR.id)[0]).toMatchObject({ status: "PAID", paid: 22842.47 });
        expect(scheduleOf(REGULAR.id)[1]).toMatchObject({ status: "UPCOMING", paid: null });
        const payments = paymentsOf(REGULAR.id);
        expect(payments.map(p => p.amount)).toEqual([2000, 10000, 10842.47]);
        // Interest is covered first, cumulatively; the totals equal the
        // instalment's own split.
        expect(payments[0]!.interest).toBe(2000);
        expect(payments.reduce((s, p) => s + p.interest, 0)).toBeCloseTo(first.interest, 2);
        expect(payments.reduce((s, p) => s + p.principal, 0)).toBeCloseTo(first.principal, 2);
    });

    it("E. several EMIs in one statement each pay the right instalment, in date order", async () => {
        seedLoan(REGULAR);

        await importStatement([
            // Listed out of date order in the file.
            { transactionDate: "2026-04-10", amount: 22842.47, payee: "Contoso Bank", description: "NACH DR CONTOSO APR" },
            { transactionDate: "2026-02-10", amount: 22842.47, payee: "Contoso Bank", description: "NACH DR CONTOSO FEB" },
            { transactionDate: "2026-03-10", amount: 22842.47, payee: "Contoso Bank", description: "NACH DR CONTOSO MAR" },
            { transactionDate: "2026-03-12", amount: 499, payee: "Coffee Shop", description: "UPI COFFEE" },
        ]);

        const byNarration = new Map(liveTransactions().map(t => [t.original_narration, t.id]));
        expect(scheduleOf(REGULAR.id).slice(0, 4).map(r => [r.n, r.status, r.txn])).toEqual([
            [1, "PAID", byNarration.get("NACH DR CONTOSO FEB")],
            [2, "PAID", byNarration.get("NACH DR CONTOSO MAR")],
            [3, "PAID", byNarration.get("NACH DR CONTOSO APR")],
            [4, "UPCOMING", null],
        ]);
        expect(paymentsOf(REGULAR.id)).toHaveLength(3);
    });

    it("F. a debit that could belong to more than one loan is not applied to any", async () => {
        seedLoan({ ...REGULAR, id: "loan-a", name: "Contoso Home Loan" });
        seedLoan({ ...REGULAR, id: "loan-b", name: "Contoso Car Loan" });

        const batch = await importStatement([
            { transactionDate: "2026-02-10", amount: 22842.47, payee: "Contoso Bank", description: "NACH DR CONTOSO" },
        ]);

        expect(all("SELECT * FROM loan_schedule_payments")).toHaveLength(0);
        expect(scheduleOf("loan-a").every(r => r.status === "UPCOMING" || r.status === "OVERDUE")).toBe(true);
        expect(liveTransactions()).toHaveLength(1);
        expect(batch.loanPayments?.needsReview).toEqual([
            expect.objectContaining({ loanNames: ["Contoso Car Loan", "Contoso Home Loan"], reason: expect.stringContaining("more than one loan") }),
        ]);
    });

    it("G. more than what remains on the instalment is never applied (no overpayment, no split)", async () => {
        seedLoan(REGULAR);
        const scheduleBefore = all("SELECT * FROM loan_payment_schedule");
        const loanBefore = loanRow(REGULAR.id);

        const batch = await importStatement([
            { transactionDate: "2026-02-10", amount: 30000, payee: "Contoso Bank", description: "NACH DR CONTOSO" },
        ]);

        expect(all("SELECT * FROM loan_schedule_payments")).toHaveLength(0);
        expect(all("SELECT * FROM loan_payment_schedule")).toEqual(scheduleBefore);
        expect(loanRow(REGULAR.id)).toEqual(loanBefore);
        expect(liveTransactions()).toHaveLength(1);
        expect(batch.loanPayments?.needsReview[0]?.reason).toContain("more than the 22,842.47 remaining");
    });

    it("H. re-importing the same statement never creates a second payment", async () => {
        seedLoan(REGULAR);
        const rows = [{ transactionDate: "2026-02-10", amount: 22842.47, payee: "Contoso Bank", description: "NACH DR CONTOSO 1" }];

        await importStatement(rows);
        const afterFirst = { payments: all("SELECT * FROM loan_schedule_payments"), schedule: all("SELECT * FROM loan_payment_schedule"), loan: loanRow(REGULAR.id) };

        const again = await importStatement(rows);

        expect(again.duplicateRows).toBe(1);
        expect(again.loanPayments).toBeUndefined();
        expect(all("SELECT * FROM loan_schedule_payments")).toEqual(afterFirst.payments);
        expect(all("SELECT * FROM loan_payment_schedule")).toEqual(afterFirst.schedule);
        expect(loanRow(REGULAR.id)).toEqual(afterFirst.loan);
        expect(liveTransactions()).toHaveLength(1);
    });

    it("H. a transaction that already records a payment is never linked again", async () => {
        seedLoan(REGULAR);
        await importStatement([{ transactionDate: "2026-02-10", amount: 22842.47, payee: "Contoso Bank", description: "NACH DR CONTOSO" }]);
        const txn = liveTransactions()[0]!;
        const second = all<{ id: string }>("SELECT id FROM loan_payment_schedule WHERE loan_id = ? AND installment_number = 2", REGULAR.id)[0]!;

        await expect(
            new LoanPaymentService().recordPaymentFromTransaction({ loanId: REGULAR.id, scheduleId: second.id, transactionId: txn.id })
        ).rejects.toThrow("already recorded as a loan payment");
        expect(paymentsOf(REGULAR.id)).toHaveLength(1);
    });

    it("I. a statement debit for an EMI already recorded manually does not pay a second instalment", async () => {
        seedLoan(REGULAR);
        await payFirstInstalmentManually(REGULAR.id, "2026-02-10");
        const manual = { payments: all("SELECT * FROM loan_schedule_payments"), schedule: all("SELECT * FROM loan_payment_schedule"), loan: loanRow(REGULAR.id) };

        const batch = await importStatement([
            { transactionDate: "2026-02-11", amount: 22842.47, payee: "Contoso Bank", description: "NACH DR CONTOSO BANK" },
        ]);

        expect(all("SELECT * FROM loan_schedule_payments")).toEqual(manual.payments);
        expect(all("SELECT * FROM loan_payment_schedule")).toEqual(manual.schedule);
        expect(loanRow(REGULAR.id)).toEqual(manual.loan);
        expect(batch.loanPayments?.needsReview[0]?.reason).toContain("already recorded manually");
    });

    it("J. Import Preview never writes anything", async () => {
        seedLoan(REGULAR);
        const dump = () => Object.fromEntries(
            all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
                .map(({ name }) => [name, JSON.stringify(all(`SELECT * FROM "${name}" ORDER BY rowid`))])
        );
        const before = dump();

        const preview = await importService().previewCsv(BANK, [
            "Date,Description,Debit,Credit,Balance",
            "10/02/2026,NACH DR CONTOSO BANK LTD,22842.47,,100000.00",
        ].join("\n"));

        expect(preview.candidates).toHaveLength(1);
        expect(dump()).toEqual(before);
        expect(invoke).not.toHaveBeenCalled();
    });

    it("K. a loan without a first instalment keeps its schedule exactly; unrelated imports never touch it", async () => {
        seedLoan(REGULAR);
        const schedule = all("SELECT * FROM loan_payment_schedule WHERE loan_id = ?", REGULAR.id);
        expect(schedule).toHaveLength(REGULAR.tenure);
        expect(all<{ total: number }>("SELECT DISTINCT total_amount AS total FROM loan_payment_schedule WHERE loan_id = ? AND installment_number < ?", REGULAR.id, REGULAR.tenure).map(r => r.total)).toEqual([22842.47]);

        await importStatement([
            { transactionDate: "2026-02-10", amount: 22842.47, payee: "Someone Else", description: "UPI RENT" },
            { transactionDate: "2026-02-10", amount: 22842.47, payee: "Contoso Bank", description: "NACH DR CONTOSO" },
        ], OTHER_BANK); // not the loan's EMI account

        expect(all("SELECT * FROM loan_payment_schedule WHERE loan_id = ?", REGULAR.id)).toEqual(schedule);
        expect(all("SELECT * FROM loan_schedule_payments")).toHaveLength(0);
    });

    it("L. an incoming credit is never a loan payment, even with the lender's name and the EMI amount", async () => {
        seedLoan(REGULAR);

        const batch = await importStatement([
            { transactionDate: "2026-02-10", amount: 22842.47, type: "income", payee: "Contoso Bank", description: "NACH CR CONTOSO REFUND" },
        ]);

        expect(all("SELECT * FROM loan_schedule_payments")).toHaveLength(0);
        expect(batch.loanPayments).toEqual({ applied: [], needsReview: [] });
    });

    it("M. the imported transaction stays exactly as imported - no second transaction, nothing rewritten", async () => {
        seedLoan(REGULAR);
        const transactionCreate = vi.spyOn(TransactionService.prototype, "prepareCreate");

        await importStatement([
            { transactionDate: "2026-02-10", amount: 22842.47, payee: "Contoso Bank", description: "NACH DR CONTOSO BANK LTD 88213", referenceNumber: "REF-1" },
        ]);

        const [txn] = liveTransactions();
        expect(liveTransactions()).toHaveLength(1);
        expect(txn).toMatchObject({
            account_id: BANK, type: "expense", amount: 22842.47, transaction_date: "2026-02-10", payee: "Contoso Bank",
            original_narration: "NACH DR CONTOSO BANK LTD 88213", reference_number: "REF-1", is_imported: 1,
            source_statement: "Test Mapping", deleted_at: null,
        });
        expect(txn!.created_at).toBe(txn!.updated_at);
        expect(paymentsOf(REGULAR.id)[0]!.txn).toBe(txn!.id);
        // Only the import's own create - the EMI path built no transaction.
        expect(transactionCreate).toHaveBeenCalledTimes(1);
    });

    it("recognises a later debit by the narration pattern of the loan's earlier imported payments", async () => {
        seedLoan({ ...REGULAR, name: "Vehicle Finance", lender: "Contoso Bank" });

        await importStatement([{ transactionDate: "2026-02-10", amount: 22842.47, payee: "Contoso Bank", description: "ACH-DR CTSO-112233" }]);
        // No name in the payee or narration this time - only the same
        // narration pattern as the linked February debit.
        await importStatement([{ transactionDate: "2026-03-10", amount: 22842.47, payee: "", description: "ACH-DR CTSO-445566" }]);

        expect(scheduleOf(REGULAR.id).slice(0, 2).map(r => r.status)).toEqual(["PAID", "PAID"]);
    });

    it("does not pay an instalment that is not due for months", async () => {
        seedLoan({ ...REGULAR, startDate: "2026-09-10" }); // first EMI due 2026-10-10

        const batch = await importStatement([
            { transactionDate: "2026-02-10", amount: 22842.47, payee: "Contoso Bank", description: "NACH DR CONTOSO" },
        ]);

        expect(all("SELECT * FROM loan_schedule_payments")).toHaveLength(0);
        expect(batch.loanPayments?.needsReview[0]?.reason).toContain("not due until");
    });

    it("reversing an automatically applied payment keeps the imported transaction and reopens the instalment", async () => {
        seedLoan(REGULAR);
        const loanBefore = loanRow(REGULAR.id);
        await importStatement([{ transactionDate: "2026-02-10", amount: 22842.47, payee: "Contoso Bank", description: "NACH DR CONTOSO" }]);
        const payment = all<{ id: string }>("SELECT id FROM loan_schedule_payments")[0]!;

        await new LoanPaymentService().reversePayment(payment.id);

        expect(liveTransactions()).toHaveLength(1);
        expect(all("SELECT * FROM loan_schedule_payments")).toHaveLength(0);
        expect(scheduleOf(REGULAR.id)[0]).toMatchObject({ paid: null, txn: null });
        expect(loanRow(REGULAR.id).principal).toBeCloseTo(loanBefore.principal, 2);
        expect(loanRow(REGULAR.id).interest).toBeCloseTo(loanBefore.interest, 2);
        // Now an ordinary transaction again - deletable like any other.
        await new TransactionService().delete(liveTransactions()[0]!.id as string);
        expect(liveTransactions()).toHaveLength(0);
    });

    it("manual Record EMI Payment still creates its own transaction and is still reversed by deleting it", async () => {
        seedLoan(REGULAR);

        const result = await payFirstInstalmentManually(REGULAR.id, "2026-02-10");
        expect(liveTransactions()).toEqual([expect.objectContaining({ id: result.transactionId, is_imported: 0, payee: "Car Loan" })]);
        expect(scheduleOf(REGULAR.id)[0]).toMatchObject({ status: "PAID" });

        const payment = all<{ id: string }>("SELECT id FROM loan_schedule_payments")[0]!;
        await new LoanPaymentService().reversePayment(payment.id);

        expect(liveTransactions()).toHaveLength(0);
        expect(scheduleOf(REGULAR.id)[0]).toMatchObject({ status: "UPCOMING", paid: null });
    });
});

// The user's situation, with a fictional lender: the real ACH debit is a
// whole 1,51,167 while the calculated EMI is 1,51,167.39, and the bank's
// narration does not name the loan or the lender.
const ACH = (reference: string) => `ACH-DR-TP ACH NWCAPFINL-${reference}-UTIB001504`;
const LENDER_DEBIT = 151167;

describe("Link Existing Transaction to EMI, and learning from it", () => {
    async function historicImport() {
        seedLoan(CUSTOM_FIRST);
        await payFirstInstalmentManually(CUSTOM_FIRST.id, "2026-04-06");
        // Statements imported before any link: June-September debits.
        await importStatement([
            { transactionDate: "2026-06-05", amount: LENDER_DEBIT, description: ACH("2227538664") },
            { transactionDate: "2026-07-05", amount: LENDER_DEBIT, description: ACH("2260466417") },
            { transactionDate: "2026-08-05", amount: LENDER_DEBIT, description: ACH("2293071249") },
            { transactionDate: "2026-09-05", amount: LENDER_DEBIT, description: ACH("2326157416") },
        ]);
        return new Map(
            all<{ id: string; transaction_date: string }>("SELECT id, transaction_date FROM transactions WHERE is_imported = 1")
                .map(row => [row.transaction_date, row.id])
        );
    }

    it("existing debits are never turned into loan payments on their own", async () => {
        await historicImport();

        // Only the manual instalment-1 payment exists.
        expect(paymentsOf(CUSTOM_FIRST.id).map(p => p.schedule)).toEqual([1]);
        expect(scheduleOf(CUSTOM_FIRST.id).slice(1, 6).every(r => r.status !== "PAID" && r.paid === null)).toBe(true);
    });

    it("linking June by hand records the existing transaction - same id, unchanged, no new transaction - and keeps the difference", async () => {
        const byDate = await historicImport();
        const june = byDate.get("2026-06-05")!;
        const transactionsBefore = all("SELECT * FROM transactions ORDER BY id");
        const loanBefore = loanRow(CUSTOM_FIRST.id);

        const result = await linkByHand(june, CUSTOM_FIRST.id, 2, "settle");

        expect(result.transactionId).toBe(june);
        expect(all("SELECT * FROM transactions ORDER BY id")).toEqual(transactionsBefore);
        expect(scheduleOf(CUSTOM_FIRST.id)[1]).toMatchObject({ n: 2, status: "PAID", total: 151167.39, paid: LENDER_DEBIT, txn: june });
        expect(all("SELECT transaction_id, amount, transaction_linked, settles_installment FROM loan_schedule_payments WHERE transaction_id = ?", june))
            .toEqual([{ transaction_id: june, amount: LENDER_DEBIT, transaction_linked: 1, settles_installment: 1 }]);
        // Only what was really paid reduces the balances (interest first) -
        // the 0.39 is not written off.
        const paid = paymentsOf(CUSTOM_FIRST.id).find(p => p.txn === june)!;
        expect(paid.interest + paid.principal).toBeCloseTo(LENDER_DEBIT, 2);
        expect(loanRow(CUSTOM_FIRST.id).principal).toBeCloseTo(loanBefore.principal - paid.principal, 2);

        // July-September stay ordinary, unlinked transactions.
        for (const date of ["2026-07-05", "2026-08-05", "2026-09-05"]) {
            expect(all("SELECT id FROM loan_schedule_payments WHERE transaction_id = ?", byDate.get(date))).toEqual([]);
        }
        expect(scheduleOf(CUSTOM_FIRST.id)[2]).toMatchObject({ paid: null });
    });

    it("after June is linked, the next statement debits with the same pattern settle the next EMIs automatically", async () => {
        seedLoan(CUSTOM_FIRST);
        await payFirstInstalmentManually(CUSTOM_FIRST.id, "2026-04-06");
        await importStatement([{ transactionDate: "2026-06-05", amount: LENDER_DEBIT, description: ACH("2227538664") }]);
        await linkByHand(liveTransactions().find(t => t.is_imported === 1)!.id, CUSTOM_FIRST.id, 2, "settle");

        const july = await importStatement([{ transactionDate: "2026-07-05", amount: LENDER_DEBIT, description: ACH("2260466417") }]);
        const august = await importStatement([{ transactionDate: "2026-08-05", amount: LENDER_DEBIT, description: ACH("2293071249") }]);

        expect(july.loanPayments?.applied).toEqual([expect.objectContaining({ loanName: "Northwind Capital", installmentNumber: 3, installmentStatus: "PAID" })]);
        expect(august.loanPayments?.applied).toEqual([expect.objectContaining({ installmentNumber: 4, installmentStatus: "PAID" })]);
        expect(scheduleOf(CUSTOM_FIRST.id).slice(1, 5).map(r => [r.n, r.status, r.paid])).toEqual([
            [2, "PAID", LENDER_DEBIT], [3, "PAID", LENDER_DEBIT], [4, "PAID", LENDER_DEBIT], [5, "UPCOMING", null],
        ]);
        expect(all<{ s: number }>("SELECT settles_installment AS s FROM loan_schedule_payments ORDER BY payment_date").map(r => r.s)).toEqual([0, 1, 1, 1]);
    });

    it("with July-September still unlinked, a new October debit is left for review - EMI #3 is never skipped or paid with it", async () => {
        const byDate = await historicImport();
        await linkByHand(byDate.get("2026-06-05")!, CUSTOM_FIRST.id, 2, "settle");

        const october = await importStatement([{ transactionDate: "2026-10-05", amount: LENDER_DEBIT, description: ACH("2359000001") }]);

        expect(october.loanPayments?.applied).toEqual([]);
        expect(october.loanPayments?.needsReview[0]?.reason).toBe(
            "Earlier EMI #3 (due 2026-07-05) is still unpaid and must be reviewed before this payment can be automatically matched to EMI #6."
        );
        expect(scheduleOf(CUSTOM_FIRST.id)[2]).toMatchObject({ paid: null });
    });

    it("once every month is linked by hand, the October import settles the next EMI", async () => {
        const byDate = await historicImport();
        for (const [date, n] of [["2026-06-05", 2], ["2026-07-05", 3], ["2026-08-05", 4], ["2026-09-05", 5]] as const) {
            await linkByHand(byDate.get(date)!, CUSTOM_FIRST.id, n, "settle");
        }

        const october = await importStatement([{ transactionDate: "2026-10-05", amount: LENDER_DEBIT, description: ACH("2359000001") }]);

        expect(october.loanPayments?.applied).toEqual([expect.objectContaining({ installmentNumber: 6 })]);
    });

    it("full and partial are explicit: the same amount can be linked as a partial payment instead", async () => {
        const byDate = await historicImport();

        await linkByHand(byDate.get("2026-06-05")!, CUSTOM_FIRST.id, 2, "partial");

        expect(scheduleOf(CUSTOM_FIRST.id)[1]).toMatchObject({ status: "PARTIAL", paid: LENDER_DEBIT });
        // A choice that does not fit the amount is refused.
        await expect(linkByHand(byDate.get("2026-07-05")!, CUSTOM_FIRST.id, 3, "full")).rejects.toThrow("does not fit");
        expect(paymentsOf(CUSTOM_FIRST.id)).toHaveLength(2);
    });

    it("duplicate protection: a linked transaction cannot be linked again, and a same-amount manual payment is flagged", async () => {
        seedLoan(CUSTOM_FIRST);
        await payFirstInstalmentManually(CUSTOM_FIRST.id, "2026-04-06");
        // The same 68,943 debit, imported from the statement afterwards.
        await importStatement([{ transactionDate: "2026-04-06", amount: 68943, description: "CLG/NORTHWIND CAP LIM/ICICI BANKING" }]);
        const imported = liveTransactions().find(t => t.is_imported === 1)!;

        const options = await new LoanTransactionLinkService().getLinkOptions(imported.id);
        expect(options.loans[0]!.possibleDuplicates).toEqual([expect.stringContaining("already recorded on 2026-04-06 for instalment #1")]);

        await linkByHand(imported.id, CUSTOM_FIRST.id, 2, "partial");
        await expect(linkByHand(imported.id, CUSTOM_FIRST.id, 3, "partial")).rejects.toThrow("already recorded as a payment");
        expect((await new LoanTransactionLinkService().getLinkOptions(imported.id)).refusal).toContain("already recorded");
    });

    it("linked state: before linking it is not linked; after, the popup details name the loan, the EMI and the amount; it cannot be linked again", async () => {
        const ids = await historicImport();
        const june = ids.get("2026-06-05")!;
        const service = new LoanTransactionLinkService();

        expect(await service.getLinkDetails(june)).toBeNull();
        expect((await linkedIds()).has(june)).toBe(false);

        await linkByHand(june, CUSTOM_FIRST.id, 2, "settle");
        const paymentsBefore = all("SELECT * FROM loan_schedule_payments");

        expect((await linkedIds()).has(june)).toBe(true);
        expect(await service.getLinkDetails(june)).toEqual({ loanName: "Northwind Capital", installmentNumber: 2, amount: LENDER_DEBIT });

        // A second link - to any instalment, in any mode - is refused and writes nothing.
        expect((await service.getLinkOptions(june)).refusal).toContain("already recorded");
        await expect(linkByHand(june, CUSTOM_FIRST.id, 3, "settle")).rejects.toThrow("already recorded");
        expect(all("SELECT * FROM loan_schedule_payments")).toEqual(paymentsBefore);
    });

    it("the instalment-1 duplicate fix: reverse the manual payment, then link the imported debit to #1", async () => {
        seedLoan(CUSTOM_FIRST);
        const manual = await payFirstInstalmentManually(CUSTOM_FIRST.id, "2026-04-06");
        await importStatement([{ transactionDate: "2026-04-06", amount: 68943, description: "CLG/NORTHWIND CAP LIM/ICICI BANKING" }]);
        const imported = liveTransactions().find(t => t.is_imported === 1)!;
        // Both transactions exist - the same payment counted twice.
        expect(liveTransactions()).toHaveLength(2);
        const loanBefore = loanRow(CUSTOM_FIRST.id);

        // a-b. Reverse the manual payment: its generated transaction goes.
        const manualPayment = all<{ id: string }>("SELECT id FROM loan_schedule_payments WHERE transaction_id = ?", manual.transactionId)[0]!;
        await new LoanPaymentService().reversePayment(manualPayment.id);
        expect(all("SELECT deleted_at FROM transactions WHERE id = ?", manual.transactionId)[0]!.deleted_at).not.toBeNull();
        // c. The imported bank transaction remains.
        expect(liveTransactions().map(t => t.id)).toEqual([imported.id]);
        expect(scheduleOf(CUSTOM_FIRST.id)[0]).toMatchObject({ status: "UPCOMING", paid: null });

        // d-e. 68,943 is exactly what is scheduled, so "Full payment" is the
        // only choice offered (a lender's-full-instalment settlement is only
        // for an amount below the scheduled one).
        const options = await new LoanTransactionLinkService().getLinkOptions(imported.id);
        expect(options.loans[0]!.possibleDuplicates).toEqual([]);
        expect(options.loans[0]!.installments[0]).toMatchObject({ installmentNumber: 1, scheduledAmount: 68943, remaining: 68943, modes: ["full"] });
        await expect(linkByHand(imported.id, CUSTOM_FIRST.id, 1, "settle")).rejects.toThrow("does not fit");
        await linkByHand(imported.id, CUSTOM_FIRST.id, 1, "full");

        // f. Paid: scheduled 68,943, paid 68,943, remaining 0 - one live
        // transaction, the imported one, unchanged.
        expect(scheduleOf(CUSTOM_FIRST.id)[0]).toMatchObject({ n: 1, status: "PAID", total: 68943, paid: 68943, txn: imported.id });
        expect(liveTransactions()).toEqual([imported]);
        expect(loanRow(CUSTOM_FIRST.id)).toEqual(loanBefore);
    });

    it("an ordinary transaction the user entered and then linked is kept when the payment is reversed", async () => {
        seedLoan(REGULAR);
        const transaction = { id: "entered-by-hand" };
        insert("transactions", {
            id: transaction.id, account_id: BANK, payee: "Contoso", type: "expense", amount: 22842.47,
            transaction_date: "2026-02-10", status: "CLEARED", is_imported: 0, category_id: LOAN_CATEGORY,
        });

        await linkByHand(transaction.id, REGULAR.id, 1, "full");
        expect(scheduleOf(REGULAR.id)[0]).toMatchObject({ status: "PAID", txn: transaction.id });

        const payment = all<{ id: string }>("SELECT id FROM loan_schedule_payments")[0]!;
        await new LoanPaymentService().reversePayment(payment.id);

        expect(liveTransactions().map(t => t.id)).toEqual([transaction.id]);
        expect(scheduleOf(REGULAR.id)[0]).toMatchObject({ status: "UPCOMING", paid: null });
    });

    it("reversing the settling payment reopens the instalment, and the settlement is no longer repeated", async () => {
        seedLoan(CUSTOM_FIRST);
        await payFirstInstalmentManually(CUSTOM_FIRST.id, "2026-04-06");
        await importStatement([{ transactionDate: "2026-06-05", amount: LENDER_DEBIT, description: ACH("1") }]);
        const june = liveTransactions().find(t => t.is_imported === 1)!;
        await linkByHand(june.id, CUSTOM_FIRST.id, 2, "settle");
        const payment = all<{ id: string }>("SELECT id FROM loan_schedule_payments WHERE transaction_id = ?", june.id)[0]!;

        await new LoanPaymentService().reversePayment(payment.id);

        expect(scheduleOf(CUSTOM_FIRST.id)[1]).toMatchObject({ status: "UPCOMING", paid: null });
        expect(liveTransactions().some(t => t.id === june.id)).toBe(true);
        const july = await importStatement([{ transactionDate: "2026-07-05", amount: LENDER_DEBIT, description: ACH("2") }]);
        expect(july.loanPayments?.applied ?? []).toEqual([]);
    });

    it("a transaction from another account links to the loan the user chooses; an income can never be an EMI", async () => {
        seedLoan(REGULAR);
        await importStatement([{ transactionDate: "2026-02-10", amount: 22842.47, description: "NACH DR CONTOSO" }], OTHER_BANK);
        await importStatement([{ transactionDate: "2026-02-11", amount: 100, type: "income", description: "NEFT CR SOMEONE" }]);
        const [otherAccount, income] = liveTransactions();

        // Another account: offered like any loan, and linked by the user's choice alone.
        const offered = await new LoanTransactionLinkService().getLinkOptions(otherAccount!.id);
        expect(offered.refusal).toBeNull();
        expect(offered.loans[0]).toMatchObject({ loanId: REGULAR.id, refusal: null });
        const scheduleId = offered.loans[0]!.installments[0]!.scheduleId;
        await new LoanTransactionLinkService().link({ transactionId: otherAccount!.id, loanId: REGULAR.id, scheduleId, mode: "full" });
        expect(all("SELECT transaction_id FROM loan_schedule_payments")).toEqual([{ transaction_id: otherAccount!.id }]);

        // Money in: the loan is listed, but refuses it.
        const incomeOptions = await new LoanTransactionLinkService().getLinkOptions(income!.id);
        expect(incomeOptions.refusal).toBeNull();
        expect(incomeOptions.loans[0]!.refusal).toContain("outgoing");
    });
});

describe("an unexpected failure while applying loan payments never fails the import", () => {
    const TECHNICAL = "error returned from database: (code: 5) database is locked";

    it("the payment write fails: the import succeeds, the transaction stays ordinary, and the user is told plainly", async () => {
        seedLoan(REGULAR);
        const scheduleBefore = all("SELECT * FROM loan_payment_schedule");
        const loanBefore = loanRow(REGULAR.id);
        const real = invoke.getMockImplementation()!;
        invoke.mockImplementation(async (command, args) => {
            if (command === "record_emi_payment_atomic") throw TECHNICAL;
            return await real(command, args);
        });

        let batch;
        try {
            batch = await importStatement([
                { transactionDate: "2026-02-10", amount: 22842.47, payee: "Contoso Bank", description: "NACH DR CONTOSO BANK LTD 88213" },
            ]);
        } finally {
            invoke.mockImplementation(real);
        }

        expect(batch.status).toBe("COMPLETED");
        const [txn] = liveTransactions();
        expect(liveTransactions()).toHaveLength(1);
        expect(all("SELECT * FROM loan_schedule_payments")).toHaveLength(0);
        expect(all("SELECT * FROM loan_payment_schedule")).toEqual(scheduleBefore);
        expect(loanRow(REGULAR.id)).toEqual(loanBefore);
        expect(batch.loanPayments).toEqual({
            applied: [],
            needsReview: [expect.objectContaining({ transactionId: (txn as { id: string }).id, loanNames: ["Car Loan"], reason: COULD_NOT_RECORD_REASON })],
        });
        const message = describeLoanImportPayments(batch.loanPayments);
        expect(message).toBe(" 1 loan payment needs your attention.");
        expect(JSON.stringify(batch.loanPayments)).not.toMatch(/database|code: 5|locked|Error/);

        // ...and the same transaction can then be linked by hand as usual.
        await linkByHand((txn as { id: string }).id, REGULAR.id, 1, "full");
        expect(paymentsOf(REGULAR.id).map(p => [p.schedule, p.amount, p.txn])).toEqual([[1, 22842.47, (txn as { id: string }).id]]);
        expect(liveTransactions()).toHaveLength(1);
    });

    it("the loans cannot be read at all: the import succeeds, nothing is touched, and one plain notice is shown", async () => {
        seedLoan(REGULAR);
        const scheduleBefore = all("SELECT * FROM loan_payment_schedule");
        const getAll = vi.spyOn(LoanRepository.prototype, "getAll").mockRejectedValueOnce(new Error(TECHNICAL));

        let batch;
        try {
            batch = await importStatement([
                { transactionDate: "2026-02-10", amount: 22842.47, payee: "Contoso Bank", description: "NACH DR CONTOSO BANK LTD 88213" },
                { transactionDate: "2026-02-11", amount: 450, payee: "Grocer", description: "UPI GROCER" },
            ]);
        } finally {
            getAll.mockRestore();
        }

        expect(batch.status).toBe("COMPLETED");
        expect(liveTransactions()).toHaveLength(2);
        expect(all("SELECT * FROM loan_schedule_payments")).toHaveLength(0);
        expect(all("SELECT * FROM loan_payment_schedule")).toEqual(scheduleBefore);
        expect(batch.loanPayments).toEqual({
            applied: [],
            needsReview: [expect.objectContaining({ transactionId: null, reason: COULD_NOT_CHECK_IMPORT_REASON })],
        });
        expect(describeLoanImportPayments(batch.loanPayments)).toBe(" 1 loan payment needs your attention.");
        expect(JSON.stringify(batch.loanPayments)).not.toMatch(/database|code: 5|locked|Error/);
    });
});

describe("Unlink from Transactions - the transaction is kept, only the loan EMI payment goes", () => {
    const transactionRow = (id: string) => all("SELECT * FROM transactions WHERE id = ?", id)[0];
    const loanState = () => ({
        loan: loanRow(CUSTOM_FIRST.id),
        schedule: all("SELECT * FROM loan_payment_schedule WHERE loan_id = ? ORDER BY installment_number", CUSTOM_FIRST.id),
        payments: all("SELECT * FROM loan_schedule_payments ORDER BY id"),
    });
    const NARRATION = (ref: string) => `ACH-DR-TP ACH NORTHWINDCAP-${ref}-UTIB001504`;

    async function linkedJune() {
        seedLoan(CUSTOM_FIRST);
        await payFirstInstalmentManually(CUSTOM_FIRST.id, "2026-04-06");
        await importStatement([{ transactionDate: "2026-06-05", amount: 151167, description: NARRATION("2227538664") }]);
        const june = all<{ id: string }>("SELECT id FROM transactions WHERE is_imported = 1")[0]!.id;
        const beforeLink = { ...loanState(), transaction: transactionRow(june), transactions: liveTransactions().length };
        await linkByHand(june, CUSTOM_FIRST.id, 2, "settle");
        return { june, beforeLink };
    }

    it("6-8. unlink removes the association, keeps the transaction exactly as it was, and restores the EMI and the loan balances", async () => {
        const { june, beforeLink } = await linkedJune();
        expect(scheduleOf(CUSTOM_FIRST.id)[1]).toMatchObject({ n: 2, status: "PAID", paid: 151167 });

        await new LoanTransactionLinkService().unlink(june);

        // 6. The association is gone.
        expect(all("SELECT * FROM loan_schedule_payments WHERE transaction_id = ?", june)).toEqual([]);
        // 7. The transaction is untouched - same row, every column - and none was added or deleted.
        expect(transactionRow(june)).toEqual(beforeLink.transaction);
        expect(liveTransactions()).toHaveLength(beforeLink.transactions);
        // 8. Instalment, its remaining amount and the loan balances are back to before the link.
        const after = loanState();
        expect(after.schedule).toEqual(beforeLink.schedule);
        expect(after.payments).toEqual(beforeLink.payments);
        expect(after.loan.principal).toBeCloseTo(beforeLink.loan.principal, 2);
        expect(after.loan.interest).toBeCloseTo(beforeLink.loan.interest, 2);
        expect(after.loan.status).toBe(beforeLink.loan.status);
        expect(scheduleOf(CUSTOM_FIRST.id)[1]).toMatchObject({ n: 2, paid: null, txn: null });
        expect(scheduleOf(CUSTOM_FIRST.id)[1]!.status).not.toBe("PAID");
    });

    it("9-10. after unlink it is shown unlinked (gray) again and can be linked again", async () => {
        const { june } = await linkedJune();
        const service = new LoanTransactionLinkService();

        await service.unlink(june);

        expect((await linkedIds()).has(june)).toBe(false);
        expect(await service.getLinkDetails(june)).toBeNull();
        expect((await service.getLinkOptions(june)).refusal).toBeNull();

        await linkByHand(june, CUSTOM_FIRST.id, 2, "settle");
        expect(paymentsOf(CUSTOM_FIRST.id).map(p => [p.schedule, p.amount, p.txn])).toEqual([[1, 68943, expect.any(String)], [2, 151167, june]]);
        expect((await linkedIds()).has(june)).toBe(true);
    });

    it("11. a double click / repeated unlink is refused and corrupts nothing", async () => {
        const { june, beforeLink } = await linkedJune();
        const service = new LoanTransactionLinkService();

        const results = await Promise.allSettled([service.unlink(june), service.unlink(june)]);
        expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
        expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
        await expect(service.unlink(june)).rejects.toThrow("not linked to a loan EMI any more");

        const after = loanState();
        expect(after.schedule).toEqual(beforeLink.schedule);
        expect(after.payments).toEqual(beforeLink.payments);
        expect(after.loan.principal).toBeCloseTo(beforeLink.loan.principal, 2);
        expect(after.loan.interest).toBeCloseTo(beforeLink.loan.interest, 2);
        expect(transactionRow(june)).toEqual(beforeLink.transaction);
        expect(liveTransactions()).toHaveLength(beforeLink.transactions);
    });

    it("unlink never deletes a transaction - not even the one a manual Record EMI Payment created", async () => {
        seedLoan(CUSTOM_FIRST);
        const manual = await payFirstInstalmentManually(CUSTOM_FIRST.id, "2026-04-06");
        const before = transactionRow(manual.transactionId);

        await new LoanTransactionLinkService().unlink(manual.transactionId);

        expect(transactionRow(manual.transactionId)).toEqual(before);
        expect(all("SELECT * FROM loan_schedule_payments")).toEqual([]);
        expect(scheduleOf(CUSTOM_FIRST.id)[0]).toMatchObject({ n: 1, paid: null, txn: null });
    });

    it("12. automatic import matching is unchanged: an unlinked pattern is no longer learned, a re-link teaches it again", async () => {
        const { june } = await linkedJune();
        await new LoanTransactionLinkService().unlink(june);

        // Nothing taught any more: July's debit stays an ordinary transaction.
        const july = await importStatement([{ transactionDate: "2026-07-05", amount: 151167, description: NARRATION("2260466417") }]);
        expect(july.loanPayments?.applied ?? []).toEqual([]);
        const julyId = all<{ id: string }>("SELECT id FROM transactions WHERE transaction_date = '2026-07-05'")[0]!.id;

        // Linked again by hand -> the next month is matched as before.
        await linkByHand(june, CUSTOM_FIRST.id, 2, "settle");
        await linkByHand(julyId, CUSTOM_FIRST.id, 3, "settle");
        const august = await importStatement([{ transactionDate: "2026-08-05", amount: 151167, description: NARRATION("2293071249") }]);
        expect(august.loanPayments?.applied).toEqual([expect.objectContaining({ installmentNumber: 4, installmentStatus: "PAID" })]);
    });
});
