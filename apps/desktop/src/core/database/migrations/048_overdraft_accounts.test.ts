import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { migrations } from "./registry";
import { OverdraftAccountsMigration } from "./048_overdraft_accounts";

function run(db: DatabaseSync, sql: string): void {
    for (const statement of sql.split(";").map(part => part.trim()).filter(Boolean)) {
        if (!/^PRAGMA\s+foreign_keys\s*=\s*ON\s*$/i.test(statement)) {
            db.exec(statement);
        }
    }
}

// Every migration before 048, exactly as MigrationEngine runs them.
function databaseBefore048(): DatabaseSync {
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });

    for (const migration of migrations) {
        if (migration.version < OverdraftAccountsMigration.version) {
            run(db, migration.sql);
        }
    }

    return db;
}

// Like the live data: an OD created with one account (3999), a Term Loan
// on the same account, and a soft-deleted OD.
function seed(db: DatabaseSync): void {
    db.exec(`
        INSERT INTO accounts (id, name, account_type, currency_id, opening_balance) VALUES ('acct-3999', 'Netedge 3999', 'CURRENT', 'cur-inr', 0);
        INSERT INTO accounts (id, name, account_type, currency_id, opening_balance) VALUES ('acct-2790', 'Netedge 2790', 'CURRENT', 'cur-inr', 0);
        INSERT INTO loans (id, account_id, loan_type, loan_kind, name, principal_amount, start_date, currency_id, status, credit_limit, opening_used, opening_used_as_of)
        VALUES ('od-tata', 'acct-3999', 'Overdraft', 'OVERDRAFT', 'TATA Capital', 0, '2026-01-31', 'cur-inr', 'ACTIVE', 12500000, 0, '2026-10-08');
        INSERT INTO loans (id, account_id, loan_type, name, principal_amount, start_date, currency_id, status)
        VALUES ('term-1', 'acct-3999', 'Term Loan', 'Aditya Birla Capital', 13300000, '2026-04-05', 'cur-inr', 'ACTIVE');
        INSERT INTO loans (id, account_id, loan_type, loan_kind, name, principal_amount, start_date, currency_id, status, deleted_at)
        VALUES ('od-gone', 'acct-2790', 'Overdraft', 'OVERDRAFT', 'Old OD', 0, '2026-01-01', 'cur-inr', 'ACTIVE', '2026-02-01');
    `);
}

describe("migration 048 - overdraft accounts", () => {
    it("is registered right after 047", () => {
        const index = migrations.indexOf(OverdraftAccountsMigration);
        expect(OverdraftAccountsMigration.version).toBe(48);
        expect(migrations[index - 1]!.version).toBe(47);
    });

    it("an existing OD keeps exactly its one account - no account is added - and no other row changes", () => {
        const db = databaseBefore048();
        seed(db);
        const before = Object.fromEntries(
            ["loans", "accounts", "transactions", "overdraft_transaction_links", "loan_schedule_payments"].map(table => [
                table,
                db.prepare(`SELECT * FROM ${table}`).all(),
            ])
        );

        run(db, OverdraftAccountsMigration.sql);

        expect(db.prepare("SELECT loan_id, account_id FROM overdraft_accounts").all()).toEqual([
            { loan_id: "od-tata", account_id: "acct-3999" },
        ]);
        for (const [table, rows] of Object.entries(before)) {
            expect(db.prepare(`SELECT * FROM ${table}`).all(), table).toEqual(rows);
        }
    });

    it("lists an account only once per OD", () => {
        const db = databaseBefore048();
        seed(db);
        run(db, OverdraftAccountsMigration.sql);

        expect(() => db.exec("INSERT INTO overdraft_accounts (id, loan_id, account_id) VALUES ('x', 'od-tata', 'acct-3999')")).toThrow(/UNIQUE/);
        db.exec("INSERT INTO overdraft_accounts (id, loan_id, account_id) VALUES ('y', 'od-tata', 'acct-2790')");
        expect(db.prepare("SELECT COUNT(*) AS n FROM overdraft_accounts WHERE loan_id = 'od-tata'").get()).toEqual({ n: 2 });
    });
});
