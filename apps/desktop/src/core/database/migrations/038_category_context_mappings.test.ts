import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { CategoryContextMappingsMigration } from "./038_category_context_mappings";

function createDb(): DatabaseSync {
    const db = new DatabaseSync(":memory:");

    db.exec(`
        CREATE TABLE categories (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            category_type TEXT NOT NULL
        );

        CREATE TABLE accounts (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL
        );

        CREATE TABLE business_entities (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL
        );

        INSERT INTO categories (id, name, category_type) VALUES ('cat-salary', 'Salary', 'INCOME');
        INSERT INTO accounts (id, name) VALUES ('acct-family', 'Family Account');
        INSERT INTO business_entities (id, name) VALUES ('entity-netedge', 'Netedge Technology');
    `);

    for (const statement of CategoryContextMappingsMigration.sql
        .split(";")
        .map(part => part.trim())
        .filter(part => part.length > 0)) {
        db.exec(statement);
    }

    return db;
}

function insertMapping(
    db: DatabaseSync,
    row: {
        id: string;
        accountId?: string | null;
        businessEntityId?: string | null;
        categoryType: string;
    }
): void {
    db.prepare(
        `
        INSERT INTO category_context_mappings
        (id, category_id, account_id, business_entity_id, category_type)
        VALUES (?, 'cat-salary', ?, ?, ?)
        `
    ).run(
        row.id,
        row.accountId ?? null,
        row.businessEntityId ?? null,
        row.categoryType
    );
}

describe("migration 038 - category context mappings", () => {
    it("is registered with version 38", () => {
        expect(
            CategoryContextMappingsMigration.version
        ).toBe(38);
    });

    it("allows an account-specific mapping", () => {
        const db = createDb();

        insertMapping(db, {
            id: "map-1",
            accountId: "acct-family",
            categoryType: "INCOME",
        });

        const row = db
            .prepare(`SELECT * FROM category_context_mappings WHERE id = ?`)
            .get("map-1") as Record<string, unknown>;

        expect(row.account_id).toBe("acct-family");
        expect(row.business_entity_id).toBeNull();
        expect(row.category_type).toBe("INCOME");
    });

    it("allows a business-entity-specific mapping", () => {
        const db = createDb();

        insertMapping(db, {
            id: "map-2",
            businessEntityId: "entity-netedge",
            categoryType: "EXPENSE",
        });

        const row = db
            .prepare(`SELECT * FROM category_context_mappings WHERE id = ?`)
            .get("map-2") as Record<string, unknown>;

        expect(row.business_entity_id).toBe("entity-netedge");
        expect(row.account_id).toBeNull();
        expect(row.category_type).toBe("EXPENSE");
    });

    it("rejects a mapping with both an account and a business entity", () => {
        const db = createDb();

        expect(() =>
            insertMapping(db, {
                id: "map-both",
                accountId: "acct-family",
                businessEntityId: "entity-netedge",
                categoryType: "INCOME",
            })
        ).toThrow();
    });

    it("rejects a mapping with neither an account nor a business entity", () => {
        const db = createDb();

        expect(() =>
            insertMapping(db, {
                id: "map-neither",
                categoryType: "INCOME",
            })
        ).toThrow();
    });

    it("rejects a category_type outside INCOME/EXPENSE", () => {
        const db = createDb();

        expect(() =>
            insertMapping(db, {
                id: "map-transfer",
                accountId: "acct-family",
                categoryType: "TRANSFER",
            })
        ).toThrow();
    });

    it("allows the same category to be mapped as both Income and Expense in different contexts", () => {
        const db = createDb();

        insertMapping(db, {
            id: "map-income",
            accountId: "acct-family",
            categoryType: "INCOME",
        });

        insertMapping(db, {
            id: "map-expense",
            businessEntityId: "entity-netedge",
            categoryType: "EXPENSE",
        });

        const rows = db
            .prepare(`SELECT category_type FROM category_context_mappings ORDER BY id`)
            .all() as Array<{ category_type: string }>;

        expect(rows.map(row => row.category_type)).toEqual([
            "EXPENSE",
            "INCOME",
        ]);
    });

    it("rejects a second active mapping for the same category and account", () => {
        const db = createDb();

        insertMapping(db, {
            id: "map-a",
            accountId: "acct-family",
            categoryType: "INCOME",
        });

        expect(() =>
            insertMapping(db, {
                id: "map-b",
                accountId: "acct-family",
                categoryType: "EXPENSE",
            })
        ).toThrow();
    });

    it("rejects a second active mapping for the same category and business entity", () => {
        const db = createDb();

        insertMapping(db, {
            id: "map-a",
            businessEntityId: "entity-netedge",
            categoryType: "EXPENSE",
        });

        expect(() =>
            insertMapping(db, {
                id: "map-b",
                businessEntityId: "entity-netedge",
                categoryType: "INCOME",
            })
        ).toThrow();
    });

    it("allows re-adding a mapping for the same category and account once the earlier one is soft-deleted", () => {
        const db = createDb();

        insertMapping(db, {
            id: "map-a",
            accountId: "acct-family",
            categoryType: "INCOME",
        });

        db.prepare(
            `UPDATE category_context_mappings SET deleted_at = CURRENT_TIMESTAMP WHERE id = 'map-a'`
        ).run();

        expect(() =>
            insertMapping(db, {
                id: "map-b",
                accountId: "acct-family",
                categoryType: "EXPENSE",
            })
        ).not.toThrow();
    });
});
