import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FinanceFoundationMigration } from "@/core/database/migrations/004_finance_foundation";
import { resolveImportCategoryOptions } from "@/modules/imports/pages/importCategoryOptions";

import { CategoryService, parseCategoryCsv, CATEGORY_CSV_TEMPLATE } from "../services";
import type { Category, FinanceScope } from "../types";
import { categorySchema } from "../validation";

import {
    runBulkCategoryDelete,
    selectedCategories,
} from "./categoryBulkSelection";
import {
    financeScopeCovers,
    financeScopeFlags,
    financeScopeFromFlags,
    financeScopeIncludes,
    financeScopeLabel,
    isFinanceScope,
    matchesFinanceScopeFilter,
    parseFinanceScopeText,
    ZERO_SCOPE_MESSAGE,
} from "./financeScope";
import { resolveCategoryTransactionType } from "./resolveCategoryTransactionType";

// ---------------------------------------------------------------------
// Category multi-scope (Personal / Business / both).
//
// Storage is the existing categories.finance_scope column; "BOTH" is the
// only new value. The database tests run the real CategoryService /
// CategoryRepository SQL against a SQLite database built from the app's
// own categories migration (SQLiteProvider is mocked to it); the CSV
// import's Rust command is replaced by an equivalent INSERT (the Rust
// side has its own tests in src-tauri/src/category_import.rs).
// ---------------------------------------------------------------------

const sqlite = { db: null as DatabaseSync | null };

vi.mock("@/core/database/engine/SQLiteProvider", () => ({
    SQLiteProvider: {
        getInstance: () => ({
            async select(sql: string, binds: unknown[] = []) {
                return sqlite.db!.prepare(sql).all(...(binds as never[]));
            },
            async execute(sql: string, binds: unknown[] = []) {
                sqlite.db!.prepare(sql).run(...(binds as never[]));
            },
        }),
    },
}));

vi.mock("@tauri-apps/api/core", () => ({
    async invoke(
        command: string,
        args: { request: { categories: Category[] } }
    ) {
        if (command !== "create_categories_atomic") {
            throw new Error(`unexpected invoke ${command}`);
        }

        const insert = sqlite.db!.prepare(
            `INSERT INTO categories
            (id, parent_id, name, category_type, finance_scope, business_entity_id,
             description, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );

        for (const c of args.request.categories) {
            insert.run(
                c.id, c.parentId, c.name, c.categoryType, c.financeScope,
                c.businessEntityId, c.description, c.isActive ? 1 : 0,
                c.createdAt, c.updatedAt
            );
        }

        return {
            inserted: args.request.categories.length,
            skippedDuplicates: 0,
        };
    },
}));

type Row = Record<string, unknown>;

const tempDirs: string[] = [];

// The pre-change database: categories exactly as the app has always
// stored them (PERSONAL / BUSINESS), plus transactions linked to them.
function seed(db: DatabaseSync) {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("CREATE TABLE currencies (id TEXT PRIMARY KEY)");
    db.exec(FinanceFoundationMigration.sql);
    db.exec(`
        CREATE TABLE transactions (
            id TEXT PRIMARY KEY,
            category_id TEXT,
            amount REAL NOT NULL,
            FOREIGN KEY (category_id) REFERENCES categories(id)
        );

        INSERT INTO currencies (id) VALUES ('INR');
        INSERT INTO business_entities (id, name, currency_id) VALUES ('be-1', 'Netedge', 'INR');

        INSERT INTO categories
            (id, parent_id, name, category_type, finance_scope, business_entity_id, description, is_active, created_at, updated_at)
        VALUES
            ('cat-groceries', NULL, 'Groceries',     'EXPENSE', 'PERSONAL', NULL,   'Food',     1, 'c1', 'u1'),
            ('cat-sales',     NULL, 'Sales Revenue', 'INCOME',  'BUSINESS', 'be-1', 'Invoices', 1, 'c2', 'u2'),
            ('cat-fuel',      NULL, 'Fuel',          'EXPENSE', 'PERSONAL', NULL,   NULL,       0, 'c3', 'u3');

        INSERT INTO categories (id, name, category_type, finance_scope, deleted_at)
            VALUES ('cat-old', 'Old', 'EXPENSE', 'BUSINESS', '2026-09-01');

        INSERT INTO transactions (id, category_id, amount) VALUES
            ('txn-1', 'cat-groceries', 120.5),
            ('txn-2', 'cat-sales', 5000),
            ('txn-3', 'cat-fuel', 60),
            ('txn-4', 'cat-old', 10);
    `);
}

function openFileDatabase(): { db: DatabaseSync; file: string } {
    const dir = mkdtempSync(path.join(tmpdir(), "finwea-scope-test-"));
    tempDirs.push(dir);
    const file = path.join(dir, "finwea.db");
    const db = new DatabaseSync(file);

    seed(db);

    return { db, file };
}

function rows(sql: string): Row[] {
    return sqlite.db!.prepare(sql).all() as Row[];
}

function notifier() {
    return { success: vi.fn(), error: vi.fn() };
}

const service = () => new CategoryService();

// What the Scopes screen's Save does (CategoryService.updateScopes).
const setScope = (ids: string[], financeScope: FinanceScope) =>
    service().updateScopes(ids.map(id => ({ id, financeScope })));

beforeEach(() => {
    const db = new DatabaseSync(":memory:");
    seed(db);
    sqlite.db = db;
    vi.restoreAllMocks();
});

afterEach(() => {
    sqlite.db?.close();
    sqlite.db = null;

    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe("scope model", () => {
    it("maps each stored scope to the two checkboxes and back", () => {
        expect(financeScopeFlags("PERSONAL")).toEqual({ personal: true, business: false });
        expect(financeScopeFlags("BUSINESS")).toEqual({ personal: false, business: true });
        expect(financeScopeFlags("BOTH")).toEqual({ personal: true, business: true });

        for (const scope of ["PERSONAL", "BUSINESS", "BOTH"] as const) {
            expect(financeScopeFromFlags(financeScopeFlags(scope))).toBe(scope);
        }
    });

    it("has no zero-scope value", () => {
        expect(financeScopeFromFlags({ personal: false, business: false })).toBeNull();
        expect(financeScopeFlags("")).toEqual({ personal: false, business: false });
    });

    it("accepts only Personal, Business and both", () => {
        expect(["PERSONAL", "BUSINESS", "BOTH"].every(isFinanceScope)).toBe(true);
        expect(["", "personal", "GLOBAL", "PERSONAL,BUSINESS", null].some(isFinanceScope)).toBe(false);
    });

    it("labels scopes", () => {
        expect(financeScopeLabel("PERSONAL")).toBe("Personal");
        expect(financeScopeLabel("BUSINESS")).toBe("Business");
        expect(financeScopeLabel("BOTH")).toBe("Personal + Business");
    });

    it("a both-scope category is in the Personal and the Business context", () => {
        expect(financeScopeIncludes("BOTH", "PERSONAL")).toBe(true);
        expect(financeScopeIncludes("BOTH", "BUSINESS")).toBe(true);
        expect(financeScopeIncludes("PERSONAL", "BUSINESS")).toBe(false);
        expect(financeScopeIncludes("BUSINESS", "PERSONAL")).toBe(false);
    });

    it("a parent must cover every scope of its sub-category", () => {
        expect(financeScopeCovers("PERSONAL", "PERSONAL")).toBe(true);
        expect(financeScopeCovers("BOTH", "PERSONAL")).toBe(true);
        expect(financeScopeCovers("BOTH", "BOTH")).toBe(true);
        expect(financeScopeCovers("PERSONAL", "BOTH")).toBe(false);
        expect(financeScopeCovers("BUSINESS", "PERSONAL")).toBe(false);
    });
});

describe("Category Create/Edit form - no scope", () => {
    it("the form schema has no scope field; details validate without one", () => {
        const result = categorySchema.safeParse({
            name: "Fuel",
            categoryType: "EXPENSE",
            isActive: true,
            financeScope: "BUSINESS",
        });

        expect(result.success).toBe(true);
        expect(result.data).not.toHaveProperty("financeScope");
        expect(Object.keys(categorySchema.shape)).not.toContain("financeScope");
    });
});

describe("existing data - no migration of stored values needed", () => {
    it("existing Personal and Business categories load unchanged: Personal-only / Business-only", async () => {
        const before = rows("SELECT * FROM categories ORDER BY id");

        const loaded = await service().getAll();
        const scopes = Object.fromEntries(loaded.map(c => [c.id, c.financeScope]));

        expect(scopes).toEqual({
            "cat-groceries": "PERSONAL",
            "cat-sales": "BUSINESS",
            "cat-fuel": "PERSONAL",
        });
        expect(financeScopeFlags(scopes["cat-groceries"])).toEqual({ personal: true, business: false });
        expect(financeScopeFlags(scopes["cat-sales"])).toEqual({ personal: false, business: true });

        // Loading writes nothing: ids, scopes, timestamps all identical.
        expect(rows("SELECT * FROM categories ORDER BY id")).toEqual(before);
    });

    it("changing a category to both scopes keeps its id and every transaction link", async () => {
        const transactionsBefore = rows("SELECT * FROM transactions ORDER BY id");

        await setScope(["cat-fuel", "cat-groceries"], "BOTH");

        expect(
            rows("SELECT id, finance_scope FROM categories ORDER BY id")
        ).toEqual([
            { id: "cat-fuel", finance_scope: "BOTH" },
            { id: "cat-groceries", finance_scope: "BOTH" },
            { id: "cat-old", finance_scope: "BUSINESS" },
            { id: "cat-sales", finance_scope: "BUSINESS" },
        ]);
        expect(rows("SELECT * FROM transactions ORDER BY id")).toEqual(transactionsBefore);
        expect(
            rows(
                "SELECT t.id, c.name FROM transactions t JOIN categories c ON c.id = t.category_id ORDER BY t.id"
            )
        ).toEqual([
            { id: "txn-1", name: "Groceries" },
            { id: "txn-2", name: "Sales Revenue" },
            { id: "txn-3", name: "Fuel" },
            { id: "txn-4", name: "Old" },
        ]);
    });
});

describe("create / edit", () => {
    it("creates Personal-only, Business-only and both-scope categories", async () => {
        const ids: Record<string, string> = {};

        for (const [name, financeScope] of [
            ["Home Rent", "PERSONAL"],
            ["Salaries & Wages", "BUSINESS"],
            ["Bank Charges", "BOTH"],
        ] as [string, FinanceScope][]) {
            ids[name] = await service().create({
                name,
                categoryType: "EXPENSE",
                financeScope,
            });
        }

        const loaded = await service().getAll();

        expect(loaded.find(c => c.id === ids["Home Rent"])?.financeScope).toBe("PERSONAL");
        expect(loaded.find(c => c.id === ids["Salaries & Wages"])?.financeScope).toBe("BUSINESS");
        expect(loaded.find(c => c.id === ids["Bank Charges"])?.financeScope).toBe("BOTH");
        // One category - never duplicated per scope.
        expect(loaded.filter(c => c.name === "Bank Charges")).toHaveLength(1);
    });

    it("refuses to create a category or save scopes with zero or unknown scopes", async () => {
        const before = rows("SELECT * FROM categories ORDER BY id");

        await expect(
            service().create({
                name: "Nowhere",
                categoryType: "EXPENSE",
                financeScope: "" as FinanceScope,
            })
        ).rejects.toThrow(ZERO_SCOPE_MESSAGE);

        await expect(
            setScope(["cat-groceries"], "" as FinanceScope)
        ).rejects.toThrow(ZERO_SCOPE_MESSAGE);

        await expect(
            setScope(["cat-groceries"], "GLOBAL" as FinanceScope)
        ).rejects.toThrow('Invalid scope "GLOBAL"');

        expect(rows("SELECT * FROM categories ORDER BY id")).toEqual(before);
    });

    it("Edit saves category details only and never changes the scope", async () => {
        await setScope(["cat-sales"], "BOTH");

        await service().update({
            id: "cat-sales",
            parentId: null,
            name: "  Sales  ",
            categoryType: "INCOME",
            businessEntityId: "be-1",
            description: "All invoices",
            isActive: false,
        });

        expect(await service().getById("cat-sales")).toMatchObject({
            id: "cat-sales",
            name: "Sales",
            description: "All invoices",
            isActive: false,
            financeScope: "BOTH",
        });
    });

    it("persists both-scope categories across an app restart", async () => {
        sqlite.db!.close();

        const { db, file } = openFileDatabase();
        sqlite.db = db;

        const id = await service().create({
            name: "Loan Interest",
            categoryType: "EXPENSE",
            financeScope: "BOTH",
        });
        await setScope(["cat-sales"], "BOTH");

        // "Restart": close the database, open the same file fresh.
        db.close();
        sqlite.db = new DatabaseSync(file);

        const loaded = await service().getAll();

        expect(loaded.find(c => c.id === id)?.financeScope).toBe("BOTH");
        expect(loaded.find(c => c.id === "cat-sales")?.financeScope).toBe("BOTH");
        expect(loaded.find(c => c.id === "cat-groceries")?.financeScope).toBe("PERSONAL");
    });
});

describe("filtering by scope", () => {
    it("a both-scope category appears under Personal and under Business", async () => {
        await setScope(["cat-fuel"], "BOTH");

        const loaded = await service().getAll();
        const shown = (filter: string) =>
            loaded
                .filter(c => matchesFinanceScopeFilter(c.financeScope, filter))
                .map(c => c.name)
                .sort();

        expect(shown("ALL")).toEqual(["Fuel", "Groceries", "Sales Revenue"]);
        expect(shown("PERSONAL")).toEqual(["Fuel", "Groceries"]);
        expect(shown("BUSINESS")).toEqual(["Fuel", "Sales Revenue"]);
    });

    it("the page's Personal / Business counts include both-scope categories in each", async () => {
        await setScope(["cat-fuel"], "BOTH");

        const loaded = await service().getAll();

        expect(loaded.filter(c => financeScopeIncludes(c.financeScope, "PERSONAL"))).toHaveLength(2);
        expect(loaded.filter(c => financeScopeIncludes(c.financeScope, "BUSINESS"))).toHaveLength(2);
    });

    it("deleted and inactive categories behave as before", async () => {
        await setScope(["cat-fuel", "cat-old"], "BOTH");

        const loaded = await service().getAll();

        // Deleted stays deleted (and untouched); inactive still listed as inactive.
        expect(loaded.map(c => c.id)).not.toContain("cat-old");
        expect(rows("SELECT finance_scope FROM categories WHERE id = 'cat-old'")).toEqual([
            { finance_scope: "BUSINESS" },
        ]);
        expect(loaded.find(c => c.id === "cat-fuel")).toMatchObject({
            financeScope: "BOTH",
            isActive: false,
        });
    });
});

describe("CSV scope column", () => {
    it("parses Personal, Business and both in the accepted spellings", () => {
        for (const [text, scope] of [
            ["Personal", "PERSONAL"],
            ["business", "BUSINESS"],
            ["Personal+Business", "BOTH"],
            ["business + PERSONAL", "BOTH"],
            ["Personal & Business", "BOTH"],
            ["Personal/Business", "BOTH"],
            ["Personal|Business", "BOTH"],
            ["Personal;Business", "BOTH"],
            ["Personal, Business", "BOTH"],
            ["Personal and Business", "BOTH"],
            ["Both", "BOTH"],
            ["Personal+Personal", "PERSONAL"],
        ] as const) {
            expect(parseFinanceScopeText(text)).toBe(scope);
        }

        for (const bad of ["", "Global", "Personal+Global", "+", "Pers"]) {
            expect(parseFinanceScopeText(bad)).toBeNull();
        }
    });

    it("the template covers Personal, Business and both", () => {
        const preview = parseCategoryCsv(CATEGORY_CSV_TEMPLATE, []);

        expect(preview.invalidRows).toBe(0);
        expect(new Set(preview.rows.map(r => r.scope))).toEqual(
            new Set(["PERSONAL", "BUSINESS", "BOTH"])
        );
    });

    it("a file without a scope column imports as Personal, exactly as before", () => {
        const preview = parseCategoryCsv(
            ["name,type,description", "Rent,EXPENSE,Monthly"].join("\n"),
            []
        );

        expect(preview.rows[0]).toMatchObject({ scope: "PERSONAL", status: "valid" });
    });

    it("an empty scope cell is Personal; an unknown scope makes the row invalid", () => {
        const preview = parseCategoryCsv(
            [
                "name,type,scope",
                "Rent,EXPENSE,",
                'Fuel,EXPENSE,"Personal, Business"',
                "Travel,EXPENSE,Global",
            ].join("\n"),
            []
        );

        expect(preview.rows.map(r => [r.name, r.scope, r.status])).toEqual([
            ["Rent", "PERSONAL", "valid"],
            ["Fuel", "BOTH", "valid"],
            ["Travel", "Global", "invalid"],
        ]);
        expect(preview.rows[2].messages).toEqual([
            'Invalid scope "Global". Use Personal, Business or Personal+Business.',
        ]);
    });

    it("the same name with a different scope is still a duplicate - never a second category", () => {
        const preview = parseCategoryCsv(
            ["name,type,scope", "Fuel,EXPENSE,Business", "fuel,EXPENSE,Personal"].join("\n"),
            [{ name: "Groceries" }]
        );

        expect(preview.rows.map(r => r.status)).toEqual(["valid", "duplicate"]);
    });

    it("imports each row with its scope", async () => {
        const loaded = await service().getAll();
        const preview = parseCategoryCsv(CATEGORY_CSV_TEMPLATE, loaded);

        const result = await service().importCsvRows(preview.rows);

        // Sales Revenue, Groceries and Fuel already exist -> duplicates.
        expect(result.imported).toBe(2);

        const scopes = Object.fromEntries(
            (await service().getAll()).map(c => [c.name, c.financeScope])
        );

        expect(scopes).toMatchObject({
            "Sales Revenue": "BUSINESS", // existing - untouched (duplicate)
            "Rental Income": "BOTH",
            "Salaries & Wages": "BUSINESS",
            Groceries: "PERSONAL", // existing - untouched (duplicate)
        });
        // Template's "Fuel" duplicated the existing (inactive) Fuel.
        expect(result.imported + preview.duplicateRows).toBe(preview.totalRows);
    });
});

describe("existing behaviour", () => {
    it("transaction categorization treats a both-scope category exactly like before", async () => {
        await setScope(["cat-groceries"], "BOTH");

        const loaded = await service().getAll();
        const both = loaded.find(c => c.id === "cat-groceries")!;

        expect(
            resolveCategoryTransactionType({
                categoryId: both.id,
                accountId: "acct-1",
                businessEntityId: "be-1",
                mappings: [],
                categories: loaded,
            })
        ).toEqual({ categoryType: "EXPENSE", source: "default" });

        for (const [account, scope] of [
            [{ id: "personal-acct", businessEntityId: null }, "PERSONAL"],
            [{ id: "business-acct", businessEntityId: "be-1" }, "BUSINESS"],
        ] as const) {
            expect(
                resolveImportCategoryOptions({
                    categories: loaded,
                    mappings: [],
                    account,
                    direction: "expense",
                    scope,
                }).map(option => option.name)
            ).toContain("Groceries");
        }
    });

    it("bulk Delete and single Delete still soft-delete, whatever the scope", async () => {
        await setScope(["cat-groceries"], "BOTH");

        const loaded = await service().getAll();
        const outcome = await runBulkCategoryDelete(
            service(),
            selectedCategories(loaded, new Set(["cat-groceries", "cat-sales"])),
            notifier()
        );

        expect(outcome).toEqual({ deletedIds: ["cat-groceries", "cat-sales"], failed: false });

        await service().delete("cat-fuel");

        expect(await service().getAll()).toEqual([]);
        expect(rows("SELECT COUNT(*) AS n FROM categories")).toEqual([{ n: 4 }]);
        expect(rows("SELECT COUNT(*) AS n FROM transactions")).toEqual([{ n: 4 }]);
    });
});
