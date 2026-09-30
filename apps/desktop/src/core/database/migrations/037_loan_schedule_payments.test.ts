import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { LoanSchedulePaymentsMigration } from "./037_loan_schedule_payments";

/** Replicates MigrationEngine's statement splitting. */
function statements(sql: string): string[] {
    return sql
        .split(";")
        .map(statement => statement.trim())
        .filter(statement => statement.length > 0)
        .filter(
            statement =>
                !/^PRAGMA\s+foreign_keys\s*=\s*ON\s*$/i.test(
                    statement
                )
        );
}

function run(db: DatabaseSync, sql: string): void {
    for (const statement of statements(sql)) {
        db.exec(statement);
    }
}

/** A DB carrying loans/schedule/transactions as they stand before this migration. */
function createDb(): DatabaseSync {
    const db = new DatabaseSync(":memory:");

    db.exec(`
        CREATE TABLE loans (id TEXT PRIMARY KEY);

        CREATE TABLE loan_payment_schedule (
            id TEXT PRIMARY KEY,
            loan_id TEXT NOT NULL
        );

        CREATE TABLE transactions (id TEXT PRIMARY KEY);
    `);

    db.exec(`INSERT INTO loans (id) VALUES ('loan-1')`);
    db.exec(
        `INSERT INTO loan_payment_schedule (id, loan_id) VALUES ('sch-1', 'loan-1')`
    );
    db.exec(
        `INSERT INTO transactions (id) VALUES ('txn-1')`
    );
    db.exec(
        `INSERT INTO transactions (id) VALUES ('txn-2')`
    );

    return db;
}

function columns(
    db: DatabaseSync,
    table: string
): Record<string, { notnull: number; dflt: unknown }> {
    const rows = db
        .prepare(`PRAGMA table_info(${table})`)
        .all() as Array<{
        name: string;
        notnull: number;
        dflt_value: unknown;
    }>;

    return Object.fromEntries(
        rows.map(row => [
            row.name,
            {
                notnull: row.notnull,
                dflt: row.dflt_value,
            },
        ])
    );
}

describe("migration 037 - Loan Schedule Payments", () => {
    it("is registered with version 37", () => {
        expect(
            LoanSchedulePaymentsMigration.version
        ).toBe(37);
    });

    it("creates loan_schedule_payments with the expected shape", () => {
        const db = createDb();
        run(db, LoanSchedulePaymentsMigration.sql);

        const cols = columns(
            db,
            "loan_schedule_payments"
        );

        expect(Object.keys(cols).sort()).toEqual(
            [
                "id",
                "loan_id",
                "schedule_id",
                "transaction_id",
                "payment_date",
                "amount",
                "principal_amount",
                "interest_amount",
                "created_at",
            ].sort()
        );

        expect(cols.loan_id.notnull).toBe(1);
        expect(cols.schedule_id.notnull).toBe(1);
        expect(cols.transaction_id.notnull).toBe(1);
        expect(cols.payment_date.notnull).toBe(1);
        expect(cols.amount.notnull).toBe(1);
        expect(cols.principal_amount.notnull).toBe(1);
        expect(cols.interest_amount.notnull).toBe(1);

        db.close();
    });

    it("has foreign keys to loans, loan_payment_schedule and transactions", () => {
        const db = createDb();
        run(db, LoanSchedulePaymentsMigration.sql);

        const fks = db
            .prepare(
                `PRAGMA foreign_key_list(loan_schedule_payments)`
            )
            .all() as Array<{ table: string }>;

        const tables = fks
            .map(fk => fk.table)
            .sort();

        expect(tables).toEqual(
            [
                "loans",
                "loan_payment_schedule",
                "transactions",
            ].sort()
        );

        db.close();
    });

    it("creates the schedule and loan indexes", () => {
        const db = createDb();
        run(db, LoanSchedulePaymentsMigration.sql);

        const indexes = db
            .prepare(
                `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'loan_schedule_payments'`
            )
            .all()
            .map(r => (r as { name: string }).name);

        for (const name of [
            "idx_loan_schedule_payments_schedule",
            "idx_loan_schedule_payments_loan",
        ]) {
            expect(indexes).toContain(name);
        }

        db.close();
    });

    it("is idempotent on re-run (CREATE TABLE / INDEX IF NOT EXISTS only) and leaves existing data untouched with zero payment rows", () => {
        const db = createDb();

        const before = db
            .prepare(`SELECT * FROM loans ORDER BY id`)
            .all();

        run(db, LoanSchedulePaymentsMigration.sql);
        run(db, LoanSchedulePaymentsMigration.sql);

        const after = db
            .prepare(`SELECT * FROM loans ORDER BY id`)
            .all();

        expect(after).toEqual(before);

        const count = db
            .prepare(
                `SELECT COUNT(*) AS n FROM loan_schedule_payments`
            )
            .get() as { n: number };

        expect(count.n).toBe(0);

        db.close();
    });

    it("allows two separate payment rows against the same schedule row, each keeping its own transaction link", () => {
        const db = createDb();
        run(db, LoanSchedulePaymentsMigration.sql);

        db.prepare(
            `INSERT INTO loan_schedule_payments
             (id, loan_id, schedule_id, transaction_id, payment_date, amount, principal_amount, interest_amount)
             VALUES ('pay-1', 'loan-1', 'sch-1', 'txn-1', '2026-02-01', 300, 0, 300)`
        ).run();

        db.prepare(
            `INSERT INTO loan_schedule_payments
             (id, loan_id, schedule_id, transaction_id, payment_date, amount, principal_amount, interest_amount)
             VALUES ('pay-2', 'loan-1', 'sch-1', 'txn-2', '2026-03-01', 8500, 8000, 500)`
        ).run();

        const rows = db
            .prepare(
                `SELECT transaction_id, amount FROM loan_schedule_payments WHERE schedule_id = 'sch-1' ORDER BY id`
            )
            .all() as Array<{
            transaction_id: string;
            amount: number;
        }>;

        expect(rows).toEqual([
            { transaction_id: "txn-1", amount: 300 },
            { transaction_id: "txn-2", amount: 8500 },
        ]);

        db.close();
    });
});
