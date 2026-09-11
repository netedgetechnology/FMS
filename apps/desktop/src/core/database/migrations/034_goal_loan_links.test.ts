import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { GoalLoanLinksMigration } from "./034_goal_loan_links";

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

/** A DB carrying `goals` / `loans` as they stand before this migration. */
function createDb(): DatabaseSync {
    const db = new DatabaseSync(":memory:");

    db.exec(`
        CREATE TABLE loans (id TEXT PRIMARY KEY);

        CREATE TABLE goals (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            goal_type TEXT NOT NULL,
            goal_mode TEXT NOT NULL DEFAULT 'MANUAL',
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
         (id, name, goal_type, goal_mode, target_amount, currency_id)
         VALUES ('goal-1', 'Personal Loan Payoff', 'LOAN_PAYOFF_LINKED', 'LOAN_PAYOFF_LINKED', 200000, 'INR')`
    ).run();

    db.exec(`INSERT INTO loans (id) VALUES ('loan-1')`);
    db.exec(`INSERT INTO loans (id) VALUES ('loan-2')`);

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

describe("migration 034 - Goal Loan Links", () => {
    it("is registered with version 34", () => {
        expect(
            GoalLoanLinksMigration.version
        ).toBe(34);
    });

    it("creates goal_loan_links with the expected shape", () => {
        const db = createDb();
        run(db, GoalLoanLinksMigration.sql);

        const cols = columns(db, "goal_loan_links");

        expect(Object.keys(cols).sort()).toEqual(
            [
                "id",
                "goal_id",
                "loan_id",
                "is_active",
                "created_at",
                "updated_at",
                "deleted_at",
            ].sort()
        );

        expect(cols.goal_id.notnull).toBe(1);
        expect(cols.loan_id.notnull).toBe(1);
        expect(cols.is_active.notnull).toBe(1);
        expect(cols.deleted_at.notnull).toBe(0);

        db.close();
    });

    it("has foreign keys to goals and loans", () => {
        const db = createDb();
        run(db, GoalLoanLinksMigration.sql);

        const fks = db
            .prepare(
                `PRAGMA foreign_key_list(goal_loan_links)`
            )
            .all() as Array<{ table: string }>;

        const tables = fks
            .map(fk => fk.table)
            .sort();

        expect(tables).toEqual(["goals", "loans"]);

        db.close();
    });

    it("creates the goal and loan indexes", () => {
        const db = createDb();
        run(db, GoalLoanLinksMigration.sql);

        const indexes = db
            .prepare(
                `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'goal_loan_links'`
            )
            .all()
            .map(r => (r as { name: string }).name);

        for (const name of [
            "idx_goal_loan_links_goal",
            "idx_goal_loan_links_loan",
        ]) {
            expect(indexes).toContain(name);
        }

        db.close();
    });

    it("is idempotent on re-run (CREATE TABLE / INDEX IF NOT EXISTS only) and leaves existing goals untouched with zero links", () => {
        const db = createDb();

        const before = db
            .prepare(`SELECT * FROM goals ORDER BY id`)
            .all();

        run(db, GoalLoanLinksMigration.sql);
        run(db, GoalLoanLinksMigration.sql);

        const after = db
            .prepare(`SELECT * FROM goals ORDER BY id`)
            .all();

        expect(after).toEqual(before);

        const count = db
            .prepare(
                `SELECT COUNT(*) AS n FROM goal_loan_links`
            )
            .get() as { n: number };

        expect(count.n).toBe(0);

        db.close();
    });

    it("accepts a link row for an existing goal and loan", () => {
        const db = createDb();
        run(db, GoalLoanLinksMigration.sql);

        db.prepare(
            `INSERT INTO goal_loan_links
             (id, goal_id, loan_id)
             VALUES ('link-1', 'goal-1', 'loan-1')`
        ).run();

        const row = db
            .prepare(
                `SELECT * FROM goal_loan_links WHERE id = 'link-1'`
            )
            .get() as Record<string, unknown>;

        expect(row.is_active).toBe(1);
        expect(row.deleted_at).toBeNull();

        db.close();
    });

    it("allows multiple loans linked to the same goal", () => {
        const db = createDb();
        run(db, GoalLoanLinksMigration.sql);

        db.prepare(
            `INSERT INTO goal_loan_links (id, goal_id, loan_id)
             VALUES ('link-1', 'goal-1', 'loan-1')`
        ).run();
        db.prepare(
            `INSERT INTO goal_loan_links (id, goal_id, loan_id)
             VALUES ('link-2', 'goal-1', 'loan-2')`
        ).run();

        const count = db
            .prepare(
                `SELECT COUNT(*) AS n FROM goal_loan_links WHERE goal_id = 'goal-1'`
            )
            .get() as { n: number };

        expect(count.n).toBe(2);

        db.close();
    });
});
