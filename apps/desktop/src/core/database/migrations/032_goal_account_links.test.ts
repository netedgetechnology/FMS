import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { GoalAccountLinksMigration } from "./032_goal_account_links";

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

/** A DB carrying `goals` / `accounts` as they stand before this migration. */
function createDb(): DatabaseSync {
    const db = new DatabaseSync(":memory:");

    db.exec(`
        CREATE TABLE accounts (id TEXT PRIMARY KEY);

        CREATE TABLE goals (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            goal_type TEXT NOT NULL,
            target_amount REAL NOT NULL,
            current_amount REAL NOT NULL DEFAULT 0,
            currency_id TEXT NOT NULL,
            target_date TEXT,
            priority INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'ACTIVE',
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            deleted_at TEXT
        );
    `);

    db.prepare(
        `INSERT INTO goals
         (id, name, goal_type, target_amount, currency_id)
         VALUES ('goal-1', 'Emergency Fund', 'EMERGENCY_FUND', 500000, 'INR')`
    ).run();

    db.exec(`INSERT INTO accounts (id) VALUES ('acc-1')`);
    db.exec(`INSERT INTO accounts (id) VALUES ('acc-2')`);

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

describe("migration 032 - Goal Account Links", () => {
    it("is registered with version 32", () => {
        expect(
            GoalAccountLinksMigration.version
        ).toBe(32);
    });

    it("adds goal_mode to goals, defaulting existing rows to MANUAL", () => {
        const db = createDb();
        run(db, GoalAccountLinksMigration.sql);

        const row = db
            .prepare(
                `SELECT goal_mode FROM goals WHERE id = 'goal-1'`
            )
            .get() as { goal_mode: string };

        expect(row.goal_mode).toBe("MANUAL");

        const cols = columns(db, "goals");
        expect(cols.goal_mode.notnull).toBe(1);

        db.close();
    });

    it("creates goal_account_links with the expected shape", () => {
        const db = createDb();
        run(db, GoalAccountLinksMigration.sql);

        const cols = columns(
            db,
            "goal_account_links"
        );

        expect(Object.keys(cols).sort()).toEqual(
            [
                "id",
                "goal_id",
                "account_id",
                "is_active",
                "created_at",
                "updated_at",
                "deleted_at",
            ].sort()
        );

        expect(cols.goal_id.notnull).toBe(1);
        expect(cols.account_id.notnull).toBe(1);
        expect(cols.is_active.notnull).toBe(1);
        expect(cols.deleted_at.notnull).toBe(0);

        db.close();
    });

    it("has foreign keys to goals and accounts", () => {
        const db = createDb();
        run(db, GoalAccountLinksMigration.sql);

        const fks = db
            .prepare(
                `PRAGMA foreign_key_list(goal_account_links)`
            )
            .all() as Array<{ table: string }>;

        const tables = fks
            .map(fk => fk.table)
            .sort();

        expect(tables).toEqual(["accounts", "goals"]);

        db.close();
    });

    it("creates the goal and account indexes", () => {
        const db = createDb();
        run(db, GoalAccountLinksMigration.sql);

        const indexes = db
            .prepare(
                `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'goal_account_links'`
            )
            .all()
            .map(r => (r as { name: string }).name);

        for (const name of [
            "idx_goal_account_links_goal",
            "idx_goal_account_links_account",
        ]) {
            expect(indexes).toContain(name);
        }

        db.close();
    });

    // Note: unlike 031 (a brand-new table, fully guarded with
    // IF NOT EXISTS), this migration also does `ALTER TABLE goals ADD
    // COLUMN goal_mode`, which SQLite has no idempotent form for - so
    // it is not safe to execute twice against the same connection
    // (matching migration 012's precedent, which does the same kind of
    // ALTER TABLE with no re-run guard). MigrationEngine tracks applied
    // versions in `schema_version` and never re-applies a migration, so
    // this is never actually exercised at runtime.

    it("leaves existing goals' data untouched, with zero links after a single run", () => {
        const db = createDb();

        const before = db
            .prepare(
                `SELECT id, name, target_amount FROM goals ORDER BY id`
            )
            .all();

        run(db, GoalAccountLinksMigration.sql);

        const after = db
            .prepare(
                `SELECT id, name, target_amount FROM goals ORDER BY id`
            )
            .all();

        expect(after).toEqual(before);

        const count = db
            .prepare(
                `SELECT COUNT(*) AS n FROM goal_account_links`
            )
            .get() as { n: number };

        expect(count.n).toBe(0);

        db.close();
    });

    it("accepts a link row for an existing goal and account", () => {
        const db = createDb();
        run(db, GoalAccountLinksMigration.sql);

        db.prepare(
            `INSERT INTO goal_account_links
             (id, goal_id, account_id)
             VALUES ('link-1', 'goal-1', 'acc-1')`
        ).run();

        const row = db
            .prepare(
                `SELECT * FROM goal_account_links WHERE id = 'link-1'`
            )
            .get() as Record<string, unknown>;

        expect(row.is_active).toBe(1);
        expect(row.deleted_at).toBeNull();

        db.close();
    });

    it("allows multiple accounts linked to the same goal", () => {
        const db = createDb();
        run(db, GoalAccountLinksMigration.sql);

        db.prepare(
            `INSERT INTO goal_account_links (id, goal_id, account_id)
             VALUES ('link-1', 'goal-1', 'acc-1')`
        ).run();
        db.prepare(
            `INSERT INTO goal_account_links (id, goal_id, account_id)
             VALUES ('link-2', 'goal-1', 'acc-2')`
        ).run();

        const count = db
            .prepare(
                `SELECT COUNT(*) AS n FROM goal_account_links WHERE goal_id = 'goal-1'`
            )
            .get() as { n: number };

        expect(count.n).toBe(2);

        db.close();
    });
});
