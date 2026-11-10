import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { migrations } from "./registry";
import { LoanOverdraftMigration } from "./047_loan_overdraft";

// Every migration before 047, exactly as MigrationEngine runs them.
function databaseBefore047(): DatabaseSync {
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });

    for (const migration of migrations) {
        if (migration.version >= LoanOverdraftMigration.version) {
            continue;
        }

        for (const statement of migration.sql.split(";").map(part => part.trim()).filter(Boolean)) {
            if (!/^PRAGMA\s+foreign_keys\s*=\s*ON\s*$/i.test(statement)) {
                db.exec(statement);
            }
        }
    }

    return db;
}

function run047(db: DatabaseSync): void {
    for (const statement of LoanOverdraftMigration.sql.split(";").map(part => part.trim()).filter(Boolean)) {
        db.exec(statement);
    }
}

// Like the live data: a Term Loan whose free-text label is "DOD", with an
// EMI schedule and a payment.
function seedExistingLoan(db: DatabaseSync): void {
    db.exec(`
        INSERT INTO accounts (id, name, account_type, currency_id, opening_balance) VALUES ('bank', 'Bank', 'CURRENT', 'cur-inr', 0);
        INSERT INTO transactions (id, account_id, payee, type, amount, transaction_date) VALUES ('txn-1', 'bank', 'TATA', 'expense', 168216.35, '2026-05-05');
        INSERT INTO loans (id, account_id, loan_type, name, principal_amount, interest_rate, interest_type, tenure_months, emi_amount, start_date, outstanding_principal, outstanding_interest, currency_id, status)
        VALUES ('loan-dod', 'bank', 'DOD', 'TATA Capital', 14800000, 10, 'REDUCING', 180, 168216.35, '2026-04-05', 14600171.24, 1000, 'cur-inr', 'ACTIVE');
        INSERT INTO loan_payment_schedule (id, loan_id, installment_number, due_date, principal_amount, interest_amount, total_amount, outstanding_principal, status)
        VALUES ('sch-1', 'loan-dod', 1, '2026-05-05', 199828.76, 0, 168216.35, 14600171.24, 'PAID');
        INSERT INTO loan_schedule_payments (id, loan_id, schedule_id, transaction_id, payment_date, amount, principal_amount, interest_amount)
        VALUES ('pay-1', 'loan-dod', 'sch-1', 'txn-1', '2026-05-05', 168216.35, 0, 0);
    `);
}

describe("migration 047 - loan overdraft", () => {
    it("is registered right after 046", () => {
        const index = migrations.indexOf(LoanOverdraftMigration);
        expect(LoanOverdraftMigration.version).toBe(47);
        expect(migrations[index - 1]!.version).toBe(46);
    });

    it("O. every existing loan stays a Term Loan - including one labelled DOD - and no existing row changes", () => {
        const db = databaseBefore047();
        seedExistingLoan(db);
        const tables = ["loans", "loan_payment_schedule", "loan_schedule_payments", "transactions", "accounts"];
        const before = Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM ${table}`).all()]));

        run047(db);

        const loans = db.prepare("SELECT * FROM loans").all() as Record<string, unknown>[];
        expect(loans.map(({ loan_kind, credit_limit, opening_used, opening_used_as_of }) => ({ loan_kind, credit_limit, opening_used, opening_used_as_of })))
            .toEqual([{ loan_kind: "TERM_LOAN", credit_limit: null, opening_used: null, opening_used_as_of: null }]);
        expect(loans.map(({ loan_kind: _k, credit_limit: _c, opening_used: _o, opening_used_as_of: _a, ...rest }) => rest)).toEqual(before.loans);
        for (const table of tables.slice(1)) {
            expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual(before[table]);
        }
        expect(db.prepare("SELECT COUNT(*) AS n FROM overdraft_transaction_links").get()).toEqual({ n: 0 });
    });

    it("allows only the two Loan Types and the three movement kinds, and one link per transaction", () => {
        const db = databaseBefore047();
        seedExistingLoan(db);
        run047(db);

        expect(() => db.exec("UPDATE loans SET loan_kind = 'OTHER'")).toThrow(/CHECK/);
        expect(() => db.exec("INSERT INTO overdraft_transaction_links (id, loan_id, transaction_id, entry_kind) VALUES ('a', 'loan-dod', 'txn-1', 'EMI')")).toThrow(/CHECK/);
        db.exec("INSERT INTO overdraft_transaction_links (id, loan_id, transaction_id, entry_kind) VALUES ('a', 'loan-dod', 'txn-1', 'REPAYMENT')");
        expect(() => db.exec("INSERT INTO overdraft_transaction_links (id, loan_id, transaction_id, entry_kind) VALUES ('b', 'loan-dod', 'txn-1', 'REPAYMENT')")).toThrow(/UNIQUE/);
        expect(db.prepare("SELECT link_source FROM overdraft_transaction_links").get()).toEqual({ link_source: "MANUAL" });
    });
});
