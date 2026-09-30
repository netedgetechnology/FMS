import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { InvestmentPriceUpdatedAtMigration } from "./036_investment_price_updated_at";

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

function createDb(): DatabaseSync {
    const db = new DatabaseSync(":memory:");

    db.exec(`
        CREATE TABLE investments (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            current_price REAL NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            deleted_at TEXT
        );
    `);

    db.prepare(
        `INSERT INTO investments (id, name, current_price)
         VALUES ('inv-1', 'Existing Fund', 100)`
    ).run();

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

describe("migration 036 - Investment Price Updated At", () => {
    it("is registered with version 36", () => {
        expect(
            InvestmentPriceUpdatedAtMigration.version
        ).toBe(36);
    });

    it("adds a nullable price_updated_at column", () => {
        const db = createDb();
        run(db, InvestmentPriceUpdatedAtMigration.sql);

        const cols = columns(db, "investments");

        expect(cols.price_updated_at).toBeDefined();
        expect(cols.price_updated_at.notnull).toBe(0);

        db.close();
    });

    it("leaves existing investment rows with a NULL price_updated_at", () => {
        const db = createDb();
        run(db, InvestmentPriceUpdatedAtMigration.sql);

        const row = db
            .prepare(
                `SELECT price_updated_at AS priceUpdatedAt FROM investments WHERE id = 'inv-1'`
            )
            .get() as { priceUpdatedAt: unknown };

        expect(row.priceUpdatedAt).toBeNull();

        db.close();
    });

    it("accepts a value once set", () => {
        const db = createDb();
        run(db, InvestmentPriceUpdatedAtMigration.sql);

        db.prepare(
            `UPDATE investments SET price_updated_at = '2026-06-01T00:00:00.000Z' WHERE id = 'inv-1'`
        ).run();

        const row = db
            .prepare(
                `SELECT price_updated_at AS priceUpdatedAt FROM investments WHERE id = 'inv-1'`
            )
            .get() as { priceUpdatedAt: string };

        expect(row.priceUpdatedAt).toBe(
            "2026-06-01T00:00:00.000Z"
        );

        db.close();
    });
});
