import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { migrations } from "./registry";
import { CategoryTransferDirectionMigration } from "./049_category_transfer_direction";

function run(db: DatabaseSync, sql: string): void {
    for (const statement of sql.split(";").map(part => part.trim()).filter(Boolean)) {
        if (!/^PRAGMA\s+foreign_keys\s*=\s*ON\s*$/i.test(statement)) {
            db.exec(statement);
        }
    }
}

// Every migration before 049, exactly as MigrationEngine runs them.
function databaseBefore049(): DatabaseSync {
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });

    for (const migration of migrations) {
        if (migration.version < CategoryTransferDirectionMigration.version) {
            run(db, migration.sql);
        }
    }

    return db;
}

function insertCategory(db: DatabaseSync, id: string, name: string, type: string) {
    db.prepare(
        `INSERT INTO categories (id, name, category_type, finance_scope, created_at, updated_at)
         VALUES (?, ?, ?, 'BOTH', '2026-01-01', '2026-01-01')`
    ).run(id, name, type);
}

describe("migration 049 - category transfer direction", () => {
    it("is registered, version 49", () => {
        expect(migrations).toContain(CategoryTransferDirectionMigration);
        expect(CategoryTransferDirectionMigration.version).toBe(49);
    });

    it("adds a nullable column and leaves every existing category unchanged (NULL)", () => {
        const db = databaseBefore049();
        insertCategory(db, "c-drawdown", "Loan Principal Drawdown", "TRANSFER");
        insertCategory(db, "c-groceries", "Groceries", "EXPENSE");
        const before = db.prepare(`SELECT * FROM categories ORDER BY id`).all();

        run(db, CategoryTransferDirectionMigration.sql);

        const after = db.prepare(`SELECT * FROM categories ORDER BY id`).all() as Record<string, unknown>[];
        expect(after.map(row => row.transfer_direction)).toEqual([null, null]);
        expect(after.map(({ transfer_direction: _ignored, ...rest }) => rest)).toEqual(before);
    });

    it("accepts IN / OUT / NULL and rejects anything else", () => {
        const db = databaseBefore049();
        run(db, CategoryTransferDirectionMigration.sql);
        insertCategory(db, "c1", "A", "TRANSFER");

        const set = (value: string | null) =>
            db.prepare(`UPDATE categories SET transfer_direction = ? WHERE id = 'c1'`).run(value);

        expect(() => set("IN")).not.toThrow();
        expect(() => set("OUT")).not.toThrow();
        expect(() => set(null)).not.toThrow();
        expect(() => set("in")).toThrow();
        expect(() => set("SIDEWAYS")).toThrow();
    });
});
