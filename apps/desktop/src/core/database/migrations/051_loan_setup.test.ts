import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { migrations } from "./registry";
import { LoanSetupMigration } from "./051_loan_setup";

function run(db: DatabaseSync, sql: string): void {
    for (const statement of sql.split(";").map(part => part.trim()).filter(Boolean)) {
        if (!/^PRAGMA\s+foreign_keys\s*=\s*ON\s*$/i.test(statement)) {
            db.exec(statement);
        }
    }
}

// Every migration before 051, exactly as MigrationEngine runs them.
function databaseBefore051(): DatabaseSync {
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });

    for (const migration of migrations) {
        if (migration.version < LoanSetupMigration.version) {
            run(db, migration.sql);
        }
    }

    return db;
}

function seed(db: DatabaseSync) {
    db.exec(`
        INSERT INTO loans (id, loan_type, name, principal_amount, start_date, currency_id, created_at, updated_at, loan_account_number)
        VALUES ('loan-term', 'Term Loan', 'Tata Capital Term', 750000, '2026-03-05', 'cur-inr', '2026-10-15', '2026-10-15', 'TXLNA0999000000000017');
        INSERT INTO loans (id, loan_type, name, principal_amount, start_date, currency_id, created_at, updated_at, loan_kind, credit_limit, opening_used, opening_used_as_of)
        VALUES ('loan-od', 'Overdraft', 'Tata Capital (OD)', 0, '2026-01-31', 'cur-inr', '2026-10-08', '2026-10-08', 'OVERDRAFT', 12500000, 6150000, '2026-02-28');
        INSERT INTO loan_payment_schedule (id, loan_id, installment_number, due_date, principal_amount, interest_amount, total_amount, outstanding_principal, status)
        VALUES ('sched-1', 'loan-term', 1, '2026-04-05', 1727.99, 6562.50, 8290.49, 748272.01, 'PAID');
        INSERT INTO accounts (id, currency_id, name, account_type) VALUES ('acct-bank', 'cur-inr', 'Netedge 3999', 'CURRENT');
        INSERT INTO transactions (id, account_id, payee, type, amount, transaction_date)
        VALUES ('txn-credit', 'acct-bank', 'TATA CAPITAL', 'income', 712182, '2026-02-12');
        INSERT INTO transactions (id, account_id, payee, type, amount, transaction_date)
        VALUES ('txn-fee', 'acct-bank', 'Processing fee', 'expense', 10620, '2026-02-10');
    `);
}

const NEW_LOAN_COLUMNS = [
    "loan_purpose",
    "rate_type",
    "interest_calculation_method",
    "sanction_date",
    "sanctioned_amount",
    "first_emi_date",
    "repayment_frequency",
    "payment_day",
    "grace_period_months",
    "balloon_amount",
    "schedule_source",
    "drawing_power",
];

describe("migration 051 - loan setup workflow", () => {
    it("is registered as version 51, right after 050", () => {
        const index = migrations.indexOf(LoanSetupMigration);
        expect(index).toBeGreaterThan(0);
        expect(LoanSetupMigration.version).toBe(51);
        expect(migrations[index - 1]!.version).toBe(50);
    });

    it("adds only nullable columns and leaves every existing loan, schedule and transaction unchanged", () => {
        const db = databaseBefore051();
        seed(db);
        const loansBefore = db.prepare(`SELECT * FROM loans ORDER BY id`).all();
        const scheduleBefore = db.prepare(`SELECT * FROM loan_payment_schedule`).all();
        const transactionsBefore = db.prepare(`SELECT * FROM transactions ORDER BY id`).all();

        run(db, LoanSetupMigration.sql);

        const loansAfter = db.prepare(`SELECT * FROM loans ORDER BY id`).all() as Record<string, unknown>[];
        for (const row of loansAfter) {
            for (const column of NEW_LOAN_COLUMNS) {
                expect(row[column]).toBeNull();
            }
        }
        expect(
            loansAfter.map(row => {
                const copy = { ...row };
                for (const column of NEW_LOAN_COLUMNS) delete copy[column];
                return copy;
            })
        ).toEqual(loansBefore);

        const scheduleAfter = db.prepare(`SELECT * FROM loan_payment_schedule`).all() as Record<string, unknown>[];
        expect(scheduleAfter[0]!.opening_principal).toBeNull();
        expect(scheduleAfter.map(({ opening_principal: _ignored, ...rest }) => rest)).toEqual(scheduleBefore);

        expect(db.prepare(`SELECT * FROM transactions ORDER BY id`).all()).toEqual(transactionsBefore);
        expect(db.prepare(`SELECT COUNT(*) AS n FROM loan_disbursements`).get()).toEqual({ n: 0 });
        expect(db.prepare(`SELECT COUNT(*) AS n FROM loan_initial_expenses`).get()).toEqual({ n: 0 });
    });

    it("lets one bank transaction back at most one disbursement and at most one expense", () => {
        const db = databaseBefore051();
        seed(db);
        run(db, LoanSetupMigration.sql);

        const insertDisbursement = db.prepare(
            `INSERT INTO loan_disbursements (id, loan_id, sequence, disbursement_date, gross_amount, deductions_amount, net_amount, transaction_id)
             VALUES (?, 'loan-term', ?, '2026-02-12', 750000, 37818, 712182, ?)`
        );
        insertDisbursement.run("d1", 1, "txn-credit");
        expect(() => insertDisbursement.run("d2", 2, "txn-credit")).toThrow(/UNIQUE/);
        // Unlinked disbursements are not limited.
        insertDisbursement.run("d3", 3, null);
        insertDisbursement.run("d4", 4, null);

        const insertExpense = db.prepare(
            `INSERT INTO loan_initial_expenses (id, loan_id, expense_type, expense_date, base_amount, gst_rate, gst_amount, total_amount, settlement, transaction_id)
             VALUES (?, 'loan-term', 'PROCESSING_FEE', '2026-02-10', 9000, 18, 1620, 10620, 'PAID_SEPARATELY', ?)`
        );
        insertExpense.run("e1", "txn-fee");
        expect(() => insertExpense.run("e2", "txn-fee")).toThrow(/UNIQUE/);
        insertExpense.run("e3", null);
        insertExpense.run("e4", null);
    });

    it("rejects values outside the allowed lists", () => {
        const db = databaseBefore051();
        seed(db);
        run(db, LoanSetupMigration.sql);

        expect(() => db.exec(`UPDATE loans SET rate_type = 'VARIABLE' WHERE id = 'loan-term'`)).toThrow(/CHECK/);
        expect(() => db.exec(`UPDATE loans SET schedule_source = 'PDF' WHERE id = 'loan-term'`)).toThrow(/CHECK/);
        expect(() => db.exec(`UPDATE loans SET repayment_frequency = 'WEEKLY' WHERE id = 'loan-term'`)).toThrow(/CHECK/);
        db.exec(`UPDATE loans SET rate_type = 'FLOATING', interest_calculation_method = 'ACTUAL_365', schedule_source = 'LENDER_CSV' WHERE id = 'loan-term'`);

        expect(() =>
            db.exec(
                `INSERT INTO loan_initial_expenses (id, loan_id, expense_type, expense_date, base_amount, total_amount, settlement)
                 VALUES ('bad', 'loan-term', 'BROKERAGE', '2026-02-10', 100, 100, 'PAID_SEPARATELY')`
            )
        ).toThrow(/CHECK/);
        expect(() =>
            db.exec(
                `INSERT INTO loan_disbursements (id, loan_id, sequence, disbursement_date, gross_amount, net_amount)
                 VALUES ('bad', 'loan-term', 1, '2026-02-12', 0, 0)`
            )
        ).toThrow(/CHECK/);
    });
});
