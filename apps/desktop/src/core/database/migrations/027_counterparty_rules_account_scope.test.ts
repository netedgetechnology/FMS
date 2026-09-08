import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { CounterpartyRulesMigration } from "./026_counterparty_rules";
import { CounterpartyRulesAccountScopeMigration } from "./027_counterparty_rules_account_scope";

function runMigrationSql(
    db: DatabaseSync,
    sql: string
): void {
    for (const statement of sql
        .split(";")
        .map(part => part.trim())
        .filter(part => part.length > 0)) {
        db.exec(statement);
    }
}

// An existing database that already applied migration 026 in its
// originally-shipped (globally-unique-on-pattern, no account_id) shape -
// i.e. exactly what a real pre-existing local database looks like today.
function createPreExistingOldSchemaDb(): DatabaseSync {
    const db = new DatabaseSync(":memory:");

    db.exec(`
        CREATE TABLE accounts (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL
        );
    `);

    runMigrationSql(db, CounterpartyRulesMigration.sql);

    return db;
}

function insertAccount(
    db: DatabaseSync,
    id: string
): void {
    db.prepare(
        `INSERT INTO accounts (id, name) VALUES (?, ?)`
    ).run(id, id);
}

function insertOldSchemaRule(
    db: DatabaseSync,
    id: string,
    pattern: string,
    counterparty: string,
    matchCount = 1
): void {
    db.prepare(
        `
        INSERT INTO counterparty_rules
        (id, pattern, counterparty, match_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, '2026-08-01 10:00:00', '2026-08-01 10:00:00')
        `
    ).run(id, pattern, counterparty, matchCount);
}

function getRule(
    db: DatabaseSync,
    id: string
): Record<string, unknown> {
    return db
        .prepare(
            `SELECT * FROM counterparty_rules WHERE id = ?`
        )
        .get(id) as Record<string, unknown>;
}

function upsertScopedRule(
    db: DatabaseSync,
    id: string,
    accountId: string,
    pattern: string,
    counterparty: string
): void {
    db.prepare(
        `
        INSERT INTO counterparty_rules
        (id, account_id, pattern, counterparty, match_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(account_id, pattern) DO UPDATE SET
            counterparty = excluded.counterparty,
            match_count = counterparty_rules.match_count + 1,
            updated_at = CURRENT_TIMESTAMP
        `
    ).run(id, accountId, pattern, counterparty);
}

describe("migration 027 - counterparty rules account scope", () => {
    it("is registered with version 27", () => {
        expect(
            CounterpartyRulesAccountScopeMigration.version
        ).toBe(27);
    });

    it("adds account_id to an already-existing (old-schema) database without losing existing rules", () => {
        const db = createPreExistingOldSchemaDb();

        insertOldSchemaRule(
            db,
            "rule-1",
            "UPI/P#A/#/ASHVINKUMAR T DALWANI/SENT U/UCO BANK",
            "Ashvinkumar T Dalwani",
            3
        );

        insertOldSchemaRule(
            db,
            "rule-2",
            "NEFT/IN#/TATA CAPITAL LIMITED",
            "Tata Capital Limited",
            1
        );

        runMigrationSql(
            db,
            CounterpartyRulesAccountScopeMigration.sql
        );

        const count = db
            .prepare(
                `SELECT COUNT(*) AS n FROM counterparty_rules`
            )
            .get() as { n: number };

        expect(count.n).toBe(2);

        const rule1 = getRule(db, "rule-1");
        expect(rule1.pattern).toBe(
            "UPI/P#A/#/ASHVINKUMAR T DALWANI/SENT U/UCO BANK"
        );
        expect(rule1.counterparty).toBe(
            "Ashvinkumar T Dalwani"
        );
        expect(rule1.match_count).toBe(3);
        expect(rule1.created_at).toBe(
            "2026-08-01 10:00:00"
        );

        // No reliable account to attribute a pre-existing rule to - left
        // NULL rather than guessed/fabricated. Data is preserved, not
        // deleted.
        expect(rule1.account_id).toBeNull();

        const rule2 = getRule(db, "rule-2");
        expect(rule2.counterparty).toBe(
            "Tata Capital Limited"
        );
        expect(rule2.account_id).toBeNull();
    });

    it("adds the account_id column even when counterparty_rules has no existing rows", () => {
        const db = createPreExistingOldSchemaDb();

        runMigrationSql(
            db,
            CounterpartyRulesAccountScopeMigration.sql
        );

        const count = db
            .prepare(
                `SELECT COUNT(*) AS n FROM counterparty_rules`
            )
            .get() as { n: number };

        expect(count.n).toBe(0);

        // Column exists and the new constraint works - would throw if
        // the rebuild didn't apply.
        insertAccount(db, "acct-1");
        upsertScopedRule(
            db,
            "rule-1",
            "acct-1",
            "UPI/P#A/#/JOHN DOE",
            "John Doe"
        );

        expect(
            getRule(db, "rule-1").account_id
        ).toBe("acct-1");
    });

    it("removes the old global UNIQUE(pattern) constraint - the same pattern can now be saved for different accounts", () => {
        const db = createPreExistingOldSchemaDb();

        insertOldSchemaRule(
            db,
            "rule-1",
            "UPI/P#A/#/ASHVINKUMAR T DALWANI/SENT U/UCO BANK",
            "Ashvinkumar T Dalwani"
        );

        runMigrationSql(
            db,
            CounterpartyRulesAccountScopeMigration.sql
        );

        insertAccount(db, "acct-1");
        insertAccount(db, "acct-2");

        const pattern =
            "UPI/P#A/#/ASHVINKUMAR T DALWANI/SENT U/UCO BANK";

        // Under the old schema this second insert of the same pattern
        // would violate UNIQUE(pattern). After the rebuild it must
        // succeed, scoped independently per account.
        upsertScopedRule(
            db,
            "rule-2",
            "acct-1",
            pattern,
            "Ashvinkumar T Dalwani"
        );

        upsertScopedRule(
            db,
            "rule-3",
            "acct-2",
            pattern,
            "A. T. Dalwani (Business)"
        );

        const rowsForPattern = db
            .prepare(
                `SELECT account_id, counterparty FROM counterparty_rules WHERE pattern = ? ORDER BY account_id IS NULL DESC, account_id`
            )
            .all(pattern) as Array<{
            account_id: string | null;
            counterparty: string;
        }>;

        // The migrated (unattributed) row, plus one row per account.
        expect(rowsForPattern).toHaveLength(3);

        expect(
            rowsForPattern.find(
                row => row.account_id === "acct-1"
            )?.counterparty
        ).toBe("Ashvinkumar T Dalwani");

        expect(
            rowsForPattern.find(
                row => row.account_id === "acct-2"
            )?.counterparty
        ).toBe("A. T. Dalwani (Business)");
    });

    it("still refreshes (upserts) an account-scoped rule in place after the migration", () => {
        const db = createPreExistingOldSchemaDb();

        runMigrationSql(
            db,
            CounterpartyRulesAccountScopeMigration.sql
        );

        insertAccount(db, "acct-1");

        const pattern =
            "UPI/P#A/#/JOHN DOE/SENT U/HDFC BANK";

        upsertScopedRule(
            db,
            "rule-1",
            "acct-1",
            pattern,
            "John Doe"
        );
        upsertScopedRule(
            db,
            "rule-1",
            "acct-1",
            pattern,
            "John Doe Enterprises"
        );

        const count = db
            .prepare(
                `SELECT COUNT(*) AS n FROM counterparty_rules WHERE account_id = ? AND pattern = ?`
            )
            .get("acct-1", pattern) as {
            n: number;
        };

        expect(count.n).toBe(1);

        const rule = getRule(db, "rule-1");
        expect(rule.counterparty).toBe(
            "John Doe Enterprises"
        );
        expect(rule.match_count).toBe(2);
    });
});
