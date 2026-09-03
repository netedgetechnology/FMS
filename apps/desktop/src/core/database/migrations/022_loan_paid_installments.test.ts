import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { LoanPaidInstallmentsMigration } from "./022_loan_paid_installments";

function runMigration(db: DatabaseSync): void {
    const statements = LoanPaidInstallmentsMigration.sql
        .split(";")
        .map(statement => statement.trim())
        .filter(statement => statement.length > 0)
        .filter(
            statement =>
                !/^PRAGMA\s+foreign_keys\s*=\s*ON\s*$/i.test(statement)
        );

    for (const statement of statements) {
        db.exec(statement);
    }
}

function createDb(): DatabaseSync {
    const db = new DatabaseSync(":memory:");

    db.exec(`
        CREATE TABLE loans (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            principal_amount REAL NOT NULL DEFAULT 0,
            outstanding_principal REAL NOT NULL DEFAULT 0,
            outstanding_interest REAL NOT NULL DEFAULT 0,
            currency_id TEXT NOT NULL DEFAULT 'INR',
            deleted_at TEXT
        );
    `);

    return db;
}

describe("migration 022 - loan paid installments", () => {
    it("is registered with version 22", () => {
        expect(LoanPaidInstallmentsMigration.version).toBe(22);
    });

    it("adds paid_installments to loans, defaulting existing rows to 0", () => {
        const db = createDb();

        db.prepare(
            `INSERT INTO loans (id, name, principal_amount) VALUES (?, ?, ?)`
        ).run("loan-1", "Existing Loan", 500000);

        runMigration(db);

        const columns = db
            .prepare(`PRAGMA table_info(loans)`)
            .all() as Array<{
            name: string;
            type: string;
            notnull: number;
            dflt_value: unknown;
        }>;

        const column = columns.find(c => c.name === "paid_installments");

        expect(column).toBeTruthy();
        expect(column?.type).toBe("INTEGER");
        expect(column?.notnull).toBe(1);

        const row = db
            .prepare(
                `SELECT paid_installments AS paidInstallments FROM loans WHERE id = ?`
            )
            .get("loan-1") as { paidInstallments: number };

        expect(row.paidInstallments).toBe(0);
    });

    it("accepts an explicit paid-installment count on insert", () => {
        const db = createDb();
        runMigration(db);

        db.prepare(
            `INSERT INTO loans (id, name, principal_amount, paid_installments)
             VALUES (?, ?, ?, ?)`
        ).run("loan-2", "Imported Loan", 500000, 12);

        const row = db
            .prepare(
                `SELECT paid_installments AS paidInstallments FROM loans WHERE id = ?`
            )
            .get("loan-2") as { paidInstallments: number };

        expect(row.paidInstallments).toBe(12);
    });
});
