import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { CounterpartyRulesMigration } from "./026_counterparty_rules";

function createDb(): DatabaseSync {
    const db = new DatabaseSync(":memory:");

    for (const statement of CounterpartyRulesMigration.sql
        .split(";")
        .map(part => part.trim())
        .filter(part => part.length > 0)) {
        db.exec(statement);
    }

    return db;
}

// Mirrors this migration's originally-shipped shape (single global
// UNIQUE on pattern). Account-scoping is added by migration 027 and
// tested there - this file must keep testing exactly what 026 itself
// creates, since 026 has already been applied to real databases and its
// SQL can never change again (see MigrationEngine: migrations are
// tracked by version number only, not by content).
function upsertRule(
    db: DatabaseSync,
    id: string,
    pattern: string,
    counterparty: string
): void {
    db.prepare(
        `
        INSERT INTO counterparty_rules
        (id, pattern, counterparty, match_count, created_at, updated_at)
        VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(pattern) DO UPDATE SET
            counterparty = excluded.counterparty,
            match_count = counterparty_rules.match_count + 1,
            updated_at = CURRENT_TIMESTAMP
        `
    ).run(id, pattern, counterparty);
}

function findByPattern(
    db: DatabaseSync,
    pattern: string
): Record<string, unknown> | undefined {
    return db
        .prepare(
            `SELECT * FROM counterparty_rules WHERE pattern = ?`
        )
        .get(pattern) as
        | Record<string, unknown>
        | undefined;
}

describe("migration 026 - counterparty rules", () => {
    it("is registered with version 26", () => {
        expect(
            CounterpartyRulesMigration.version
        ).toBe(26);
    });

    it("saves a learned pattern -> counterparty association and finds it again", () => {
        const db = createDb();

        upsertRule(
            db,
            "rule-1",
            "UPI/P#A/#/ASHVINKUMAR T DALWANI/SENT U/UCO BANK",
            "Ashvinkumar T Dalwani"
        );

        const found = findByPattern(
            db,
            "UPI/P#A/#/ASHVINKUMAR T DALWANI/SENT U/UCO BANK"
        );

        expect(found?.counterparty).toBe(
            "Ashvinkumar T Dalwani"
        );
        expect(found?.match_count).toBe(1);
    });

    it("refreshes (not duplicates) the rule and increments match_count on repeated confirmation", () => {
        const db = createDb();

        const pattern =
            "UPI/P#A/#/JOHN DOE/SENT U/HDFC BANK";

        upsertRule(db, "rule-1", pattern, "John Doe");
        upsertRule(
            db,
            "rule-1",
            pattern,
            "John Doe Enterprises"
        );

        const count = db
            .prepare(
                `SELECT COUNT(*) AS n FROM counterparty_rules WHERE pattern = ?`
            )
            .get(pattern) as { n: number };

        expect(count.n).toBe(1);

        const found = findByPattern(db, pattern);
        expect(found?.counterparty).toBe(
            "John Doe Enterprises"
        );
        expect(found?.match_count).toBe(2);
    });

    it("does not match a different transaction pattern to an unrelated counterparty", () => {
        const db = createDb();

        upsertRule(
            db,
            "rule-1",
            "UPI/P#A/#/ASHVINKUMAR T DALWANI/SENT U/UCO BANK",
            "Ashvinkumar T Dalwani"
        );

        upsertRule(
            db,
            "rule-2",
            "NEFT/IN#/TATA CAPITAL LIMITED",
            "Tata Capital Limited"
        );

        expect(
            findByPattern(
                db,
                "NEFT/IN#/TATA CAPITAL LIMITED"
            )?.counterparty
        ).toBe("Tata Capital Limited");

        expect(
            findByPattern(
                db,
                "SOME COMPLETELY DIFFERENT PATTERN"
            )
        ).toBeUndefined();
    });
});
