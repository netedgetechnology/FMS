import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { RestoreOrphanedInvestmentAccountsMigration } from "./019_restore_orphaned_investment_accounts";

/** Replicates MigrationEngine's statement splitting. */
function runMigration(db: DatabaseSync): void {
    const statements = RestoreOrphanedInvestmentAccountsMigration.sql
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
        CREATE TABLE accounts (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            account_type TEXT NOT NULL,
            opening_balance REAL NOT NULL DEFAULT 0,
            is_active INTEGER NOT NULL DEFAULT 1,
            business_entity_id TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            deleted_at TEXT
        );

        CREATE TABLE investments (
            id TEXT PRIMARY KEY,
            account_id TEXT,
            name TEXT NOT NULL,
            business_entity_id TEXT,
            deleted_at TEXT
        );
    `);

    return db;
}

interface AccountRow {
    id: string;
    name: string;
    type: string;
    be?: string | null;
    deleted?: string | null;
}

interface InvestmentRow {
    id: string;
    accountId?: string | null;
    name: string;
    be?: string | null;
    deleted?: string | null;
}

function insertAccount(db: DatabaseSync, row: AccountRow): void {
    db.prepare(
        `INSERT INTO accounts (id, name, account_type, business_entity_id, deleted_at)
         VALUES (?, ?, ?, ?, ?)`
    ).run(row.id, row.name, row.type, row.be ?? null, row.deleted ?? null);
}

function insertInvestment(db: DatabaseSync, row: InvestmentRow): void {
    db.prepare(
        `INSERT INTO investments (id, account_id, name, business_entity_id, deleted_at)
         VALUES (?, ?, ?, ?, ?)`
    ).run(
        row.id,
        row.accountId ?? null,
        row.name,
        row.be ?? null,
        row.deleted ?? null
    );
}

function getAccount(
    db: DatabaseSync,
    id: string
): Record<string, unknown> {
    return db
        .prepare(`SELECT * FROM accounts WHERE id = ?`)
        .get(id) as Record<string, unknown>;
}

describe("migration 019 - restore orphaned investment accounts", () => {
    it("is registered with version 19", () => {
        expect(RestoreOrphanedInvestmentAccountsMigration.version).toBe(19);
    });

    it("restores a soft-deleted INVESTMENT account referenced by a live investment and re-syncs name + business entity", () => {
        const db = createDb();

        insertAccount(db, {
            id: "acct-1",
            name: "stale account name",
            type: "INVESTMENT",
            be: null,
            deleted: "2026-09-02 16:28:28",
        });
        insertInvestment(db, {
            id: "inv-1",
            accountId: "acct-1",
            name: "HDFC Mutual funds",
            be: "be-personal",
            deleted: null,
        });

        runMigration(db);

        const account = getAccount(db, "acct-1");
        expect(account.deleted_at).toBeNull();
        expect(account.name).toBe("HDFC Mutual funds");
        expect(account.business_entity_id).toBe("be-personal");
        // untouched columns stay as they were
        expect(account.account_type).toBe("INVESTMENT");
        expect(account.opening_balance).toBe(0);
    });

    it("keeps the account's own business_entity_id when it already has one", () => {
        const db = createDb();

        insertAccount(db, {
            id: "acct-2",
            name: "x",
            type: "INVESTMENT",
            be: "be-on-account",
            deleted: "2026-09-02 16:28:28",
        });
        insertInvestment(db, {
            id: "inv-2",
            accountId: "acct-2",
            name: "Fund 2",
            be: "be-on-investment",
            deleted: null,
        });

        runMigration(db);

        const account = getAccount(db, "acct-2");
        expect(account.deleted_at).toBeNull();
        expect(account.business_entity_id).toBe("be-on-account");
    });

    it("leaves a soft-deleted INVESTMENT account untouched when no live investment references it", () => {
        const db = createDb();

        // account whose investment is also deleted
        insertAccount(db, {
            id: "acct-3",
            name: "orphan-with-deleted-investment",
            type: "INVESTMENT",
            deleted: "2026-09-01 18:29:26",
        });
        insertInvestment(db, {
            id: "inv-3",
            accountId: "acct-3",
            name: "deleted investment",
            deleted: "2026-09-01 18:29:26",
        });

        // account with no investment at all (manual INVESTMENT account)
        insertAccount(db, {
            id: "acct-4",
            name: "manually deleted investment account",
            type: "INVESTMENT",
            deleted: "2026-09-01 18:29:36",
        });

        runMigration(db);

        expect(getAccount(db, "acct-3").deleted_at).toBe(
            "2026-09-01 18:29:26"
        );
        expect(getAccount(db, "acct-4").deleted_at).toBe(
            "2026-09-01 18:29:36"
        );
    });

    it("leaves soft-deleted non-INVESTMENT accounts untouched", () => {
        const db = createDb();

        insertAccount(db, {
            id: "sav-1",
            name: "old savings",
            type: "SAVINGS",
            deleted: "2026-09-01 18:29:40",
        });
        // a live investment that (wrongly) points at a savings account id -
        // migration must still not touch a non-INVESTMENT account
        insertInvestment(db, {
            id: "inv-x",
            accountId: "sav-1",
            name: "weird",
            deleted: null,
        });

        runMigration(db);

        expect(getAccount(db, "sav-1").deleted_at).toBe(
            "2026-09-01 18:29:40"
        );
    });

    it("does not touch a live (non-deleted) INVESTMENT account", () => {
        const db = createDb();

        insertAccount(db, {
            id: "acct-live",
            name: "keep this name",
            type: "INVESTMENT",
            be: "be-existing",
            deleted: null,
        });
        insertInvestment(db, {
            id: "inv-live",
            accountId: "acct-live",
            name: "different name",
            be: "be-different",
            deleted: null,
        });

        runMigration(db);

        const account = getAccount(db, "acct-live");
        expect(account.name).toBe("keep this name");
        expect(account.business_entity_id).toBe("be-existing");
        expect(account.deleted_at).toBeNull();
    });

    it("is idempotent", () => {
        const db = createDb();

        insertAccount(db, {
            id: "acct-1",
            name: "stale",
            type: "INVESTMENT",
            deleted: "2026-09-02 16:28:28",
        });
        insertInvestment(db, {
            id: "inv-1",
            accountId: "acct-1",
            name: "Fund",
            be: "be-1",
            deleted: null,
        });

        runMigration(db);
        const afterFirst = getAccount(db, "acct-1");

        runMigration(db);
        const afterSecond = getAccount(db, "acct-1");

        expect(afterSecond.deleted_at).toBeNull();
        expect(afterSecond.name).toBe(afterFirst.name);
        expect(afterSecond.business_entity_id).toBe(
            afterFirst.business_entity_id
        );
    });

    it("restores multiple orphaned accounts in one pass", () => {
        const db = createDb();

        for (const n of [1, 2, 3]) {
            insertAccount(db, {
                id: `acct-${n}`,
                name: `stale ${n}`,
                type: "INVESTMENT",
                deleted: "2026-09-02 16:28:28",
            });
            insertInvestment(db, {
                id: `inv-${n}`,
                accountId: `acct-${n}`,
                name: `Fund ${n}`,
                be: "be-1",
                deleted: null,
            });
        }

        runMigration(db);

        const restored = db
            .prepare(
                `SELECT COUNT(*) AS n FROM accounts
                 WHERE account_type = 'INVESTMENT' AND deleted_at IS NULL`
            )
            .get() as { n: number };
        expect(restored.n).toBe(3);
    });
});
