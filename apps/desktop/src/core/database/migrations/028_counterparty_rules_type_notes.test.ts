import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { CounterpartyRulesMigration } from "./026_counterparty_rules";
import { CounterpartyRulesAccountScopeMigration } from "./027_counterparty_rules_account_scope";
import { CounterpartyRulesTypeNotesMigration } from "./028_counterparty_rules_type_notes";

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

function createDbAtMigration027(): DatabaseSync {
    const db = new DatabaseSync(":memory:");

    db.exec(`
        CREATE TABLE accounts (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL
        );
    `);

    runMigrationSql(db, CounterpartyRulesMigration.sql);
    runMigrationSql(
        db,
        CounterpartyRulesAccountScopeMigration.sql
    );

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

describe("migration 028 - counterparty rules type and notes", () => {
    it("is registered with version 28", () => {
        expect(
            CounterpartyRulesTypeNotesMigration.version
        ).toBe(28);
    });

    it("adds nullable type and notes columns without losing existing rules", () => {
        const db = createDbAtMigration027();

        insertAccount(db, "acct-1");

        db.prepare(
            `
            INSERT INTO counterparty_rules
            (id, account_id, pattern, counterparty, match_count, created_at, updated_at)
            VALUES ('rule-1', 'acct-1', 'NBSM/#/SBI CARD (BILLDESK)/', 'SBI Card', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `
        ).run();

        runMigrationSql(
            db,
            CounterpartyRulesTypeNotesMigration.sql
        );

        const rule = getRule(db, "rule-1");

        expect(rule.counterparty).toBe("SBI Card");
        expect(rule.type).toBeNull();
        expect(rule.notes).toBeNull();
    });

    it("stores and retrieves a learned type and notes alongside the payee", () => {
        const db = createDbAtMigration027();
        runMigrationSql(
            db,
            CounterpartyRulesTypeNotesMigration.sql
        );

        insertAccount(db, "acct-1");

        db.prepare(
            `
            INSERT INTO counterparty_rules
            (id, account_id, pattern, counterparty, type, notes, match_count, created_at, updated_at)
            VALUES ('rule-1', 'acct-1', 'NBSM/#/SBI CARD (BILLDESK)/', 'SBI Card', 'NEFT', 'Credit card bill', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `
        ).run();

        const rule = getRule(db, "rule-1");

        expect(rule.counterparty).toBe("SBI Card");
        expect(rule.type).toBe("NEFT");
        expect(rule.notes).toBe("Credit card bill");
    });

    it("is safe to run on a freshly created (no existing rows) database", () => {
        const db = createDbAtMigration027();

        runMigrationSql(
            db,
            CounterpartyRulesTypeNotesMigration.sql
        );

        const count = db
            .prepare(
                `SELECT COUNT(*) AS n FROM counterparty_rules`
            )
            .get() as { n: number };

        expect(count.n).toBe(0);
    });
});
