import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { migrations } from "./registry";
import { LoanAccountNumberMigration } from "./050_loan_account_number";

function run(db: DatabaseSync, sql: string): void {
    for (const statement of sql.split(";").map(part => part.trim()).filter(Boolean)) {
        if (!/^PRAGMA\s+foreign_keys\s*=\s*ON\s*$/i.test(statement)) {
            db.exec(statement);
        }
    }
}

// Every migration before 050, exactly as MigrationEngine runs them.
function databaseBefore050(): DatabaseSync {
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });

    for (const migration of migrations) {
        if (migration.version < LoanAccountNumberMigration.version) {
            run(db, migration.sql);
        }
    }

    return db;
}

function insertLoan(db: DatabaseSync, id: string, name: string) {
    db.prepare(
        `INSERT INTO loans (id, loan_type, name, principal_amount, start_date, currency_id, created_at, updated_at)
         VALUES (?, 'Term Loan', ?, 100000, '2026-01-01', 'cur-inr', '2026-01-01', '2026-01-01')`
    ).run(id, name);
}

describe("migration 050 - loan account number", () => {
    it("is registered, version 50", () => {
        expect(migrations).toContain(LoanAccountNumberMigration);
        expect(LoanAccountNumberMigration.version).toBe(50);
    });

    it("adds a nullable column and leaves every existing loan unchanged (NULL)", () => {
        const db = databaseBefore050();
        insertLoan(db, "loan-a", "Tata Capital");
        insertLoan(db, "loan-b", "Aditya Birla");
        const before = db.prepare(`SELECT * FROM loans ORDER BY id`).all();

        run(db, LoanAccountNumberMigration.sql);

        const after = db.prepare(`SELECT * FROM loans ORDER BY id`).all() as Record<string, unknown>[];
        expect(after.map(row => row.loan_account_number)).toEqual([null, null]);
        expect(after.map(({ loan_account_number: _ignored, ...rest }) => rest)).toEqual(before);
    });

    it("stores the number as text, keeping leading zeros", () => {
        const db = databaseBefore050();
        run(db, LoanAccountNumberMigration.sql);
        insertLoan(db, "loan-a", "Tata Capital");

        db.prepare(`UPDATE loans SET loan_account_number = ? WHERE id = 'loan-a'`).run("0099000123");

        const row = db.prepare(`SELECT loan_account_number, typeof(loan_account_number) AS kind FROM loans`).get() as {
            loan_account_number: string;
            kind: string;
        };
        expect(row).toEqual({ loan_account_number: "0099000123", kind: "text" });
    });
});
