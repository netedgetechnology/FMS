import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { migrations } from "./registry";
import { HistoricalInstalmentSettlementMigration } from "./052_historical_instalment_settlement";

function run(db: DatabaseSync, sql: string): void {
    for (const statement of sql.split(";").map(part => part.trim()).filter(Boolean)) {
        if (!/^PRAGMA\s+foreign_keys\s*=\s*ON\s*$/i.test(statement)) {
            db.exec(statement);
        }
    }
}

function databaseBefore052(): DatabaseSync {
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });

    for (const migration of migrations) {
        if (migration.version < HistoricalInstalmentSettlementMigration.version) {
            run(db, migration.sql);
        }
    }

    return db;
}

describe("migration 052 - historical instalment settlement flag", () => {
    it("is registered as version 52, right after 051", () => {
        const index = migrations.indexOf(HistoricalInstalmentSettlementMigration);
        expect(index).toBeGreaterThan(0);
        expect(HistoricalInstalmentSettlementMigration.version).toBe(52);
        expect(migrations[index - 1]!.version).toBe(51);
    });

    it("adds the flag as 0 on every existing instalment and changes nothing else", () => {
        const db = databaseBefore052();
        db.exec(`
            INSERT INTO loans (id, loan_type, name, principal_amount, start_date, currency_id, created_at, updated_at, paid_installments)
            VALUES ('loan-term', 'Term Loan', 'Tata Capital Term', 750000, '2026-03-05', 'cur-inr', '2026-10-15', '2026-10-15', 8);
            INSERT INTO loan_payment_schedule (id, loan_id, installment_number, due_date, principal_amount, interest_amount, total_amount, outstanding_principal, status, paid_date, paid_amount)
            VALUES ('s1', 'loan-term', 1, '2026-04-05', 1727.99, 6562.50, 8290.49, 748272.01, 'PAID', '2026-04-05', 8290.49);
            INSERT INTO loan_payment_schedule (id, loan_id, installment_number, due_date, principal_amount, interest_amount, total_amount, outstanding_principal, status)
            VALUES ('s2', 'loan-term', 2, '2026-05-05', 2103.35, 7900.51, 8290.49, 900811.54, 'UPCOMING');
        `);
        const loansBefore = db.prepare("SELECT * FROM loans").all();
        const scheduleBefore = db.prepare("SELECT * FROM loan_payment_schedule ORDER BY id").all();

        run(db, HistoricalInstalmentSettlementMigration.sql);

        const scheduleAfter = db.prepare("SELECT * FROM loan_payment_schedule ORDER BY id").all() as Record<string, unknown>[];
        // The old, unverified PAID row is NOT relabelled as settled.
        expect(scheduleAfter.map(row => row.settled_before_finwea)).toEqual([0, 0]);
        expect(scheduleAfter.map(({ settled_before_finwea: _ignored, ...rest }) => rest)).toEqual(scheduleBefore);
        expect(db.prepare("SELECT * FROM loans").all()).toEqual(loansBefore);
    });

    it("accepts only 0 or 1", () => {
        const db = databaseBefore052();
        run(db, HistoricalInstalmentSettlementMigration.sql);
        db.exec(`
            INSERT INTO loans (id, loan_type, name, principal_amount, start_date, currency_id, created_at, updated_at)
            VALUES ('l', 'Term Loan', 'L', 1000, '2026-01-01', 'cur-inr', '2026-01-01', '2026-01-01');
        `);
        const insert = db.prepare(
            `INSERT INTO loan_payment_schedule (id, loan_id, installment_number, due_date, total_amount, status, settled_before_finwea)
             VALUES (?, 'l', 1, '2026-02-01', 100, 'PAID', ?)`
        );
        insert.run("ok", 1);
        expect(() => insert.run("bad", 2)).toThrow(/CHECK/);
    });
});
