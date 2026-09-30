import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { FinanceFoundationMigration } from "@/core/database/migrations/004_finance_foundation";

import { CategoryService } from "../services";
import type { Category } from "../types";
import {
    filterScopeCategories,
    initialScopeDrafts,
    runBulkCategoryDelete,
    runSaveCategoryScopes,
    scopeChanges,
    scopeManagedCategories,
    selectedCategories,
    toggleScopeDraft,
    ZERO_SCOPE_MESSAGE,
    zeroScopeIds,
    type ScopeDrafts,
} from "../utils";

import { CategoryScopesTable } from "./CategoryScopesDialog";

// ---------------------------------------------------------------------
// Scopes screen. No DOM / interaction test setup exists (vitest runs
// with environment: "node"), so:
// - the table is rendered for real (server-side) to check rows,
//   checkbox states and the label wrapping each checkbox;
// - the screen's behaviour runs through the exact functions the dialog
//   calls (drafts, toggle, zero-scope check, changes, filters, save);
// - saves run the real CategoryService/CategoryRepository SQL against a
//   SQLite database built from the app's categories migration;
// - page/dialog wiring is checked against their source.
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

type Row = Record<string, unknown>;

beforeEach(() => {
    const db = new DatabaseSync(":memory:");

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
            ('bank',      NULL,   'Bank Charges',  'EXPENSE', 'BOTH',     NULL,   'Fees',     1, 'c', 'orig'),
            ('fuel',      NULL,   'Fuel',          'EXPENSE', 'PERSONAL', NULL,   NULL,       1, 'c', 'orig'),
            ('groceries', NULL,   'Groceries',     'EXPENSE', 'PERSONAL', NULL,   'Food',     1, 'c', 'orig'),
            ('sales',     NULL,   'Sales Revenue', 'INCOME',  'BUSINESS', 'be-1', 'Invoices', 1, 'c', 'orig'),
            ('rent-in',   NULL,   'Rental Income', 'INCOME',  'PERSONAL', NULL,   NULL,       1, 'c', 'orig'),
            ('child',     'bank', 'ATM Fees',      'EXPENSE', 'BOTH',     NULL,   NULL,       1, 'c', 'orig'),
            ('inactive',  NULL,   'Old Hobby',     'EXPENSE', 'PERSONAL', NULL,   NULL,       0, 'c', 'orig');

        INSERT INTO categories (id, name, category_type, finance_scope, deleted_at, updated_at)
            VALUES ('deleted', 'Gone', 'EXPENSE', 'BUSINESS', '2026-09-01', 'orig');

        INSERT INTO transactions (id, category_id, amount) VALUES
            ('t1', 'fuel', 60), ('t2', 'sales', 5000), ('t3', 'deleted', 5);
    `);

    sqlite.db = db;
    vi.restoreAllMocks();
});

function rows(sql: string): Row[] {
    return sqlite.db!.prepare(sql).all() as Row[];
}

function byId(): Map<string, Row> {
    return new Map(
        rows("SELECT * FROM categories").map(row => [row.id as string, row])
    );
}

function notifier() {
    return { success: vi.fn(), error: vi.fn() };
}

// Loads what the page has (CategoryService.getAll) and opens the screen.
async function openScreen() {
    const categories = await new CategoryService().getAll();
    const managed = scopeManagedCategories(categories);

    return { categories, managed, drafts: initialScopeDrafts(managed) };
}

function render(
    managed: readonly Category[],
    drafts: ScopeDrafts,
    changedIds: string[] = [],
    zeroIds: string[] = []
): string {
    return renderToStaticMarkup(
        createElement(CategoryScopesTable, {
            categories: managed,
            drafts,
            changedIds: new Set(changedIds),
            zeroIds: new Set(zeroIds),
            onToggle: () => {},
        })
    );
}

function checkbox(html: string, label: string): string | undefined {
    return html
        .match(/<span[^>]*role="checkbox"[^>]*>/g)
        ?.find(tag => tag.includes(`aria-label="${label}"`))
        ?.match(/aria-checked="([^"]+)"/)?.[1];
}

async function save(
    managed: readonly Category[],
    drafts: ScopeDrafts,
    notify = notifier()
) {
    const changes = scopeChanges(managed, drafts);
    const outcome = await runSaveCategoryScopes(
        new CategoryService(),
        changes,
        notify
    );

    return { changes, outcome, notify };
}

describe("opening the Scopes screen", () => {
    const page = readFileSync(
        path.resolve(__dirname, "../pages/CategoriesPage.tsx"),
        "utf8"
    );

    it("the Categories page has a Scopes button that opens Scope Management", () => {
        expect(page).toMatch(/onClick=\{\(\) => setScopesOpen\(true\)\}[\s\S]{0,400}Scopes\s*<\/button>/);
        expect(page).toMatch(
            /<CategoryScopesDialog\s+categories=\{categories\}\s+open=\{scopesOpen\}\s+onOpenChange=\{setScopesOpen\}\s+onSuccess=\{refresh\}/
        );
    });

    it("the old bulk Change Scope action is gone", () => {
        expect(page).not.toContain("Change Scope");
        expect(page).not.toContain("BulkChangeCategoryScopeDialog");
    });
});

describe("the table", () => {
    it("shows every active category exactly once; deleted and inactive ones are excluded", async () => {
        const { managed, drafts } = await openScreen();

        expect(managed.map(c => c.name)).toEqual([
            "ATM Fees",
            "Bank Charges",
            "Fuel",
            "Groceries",
            "Rental Income",
            "Sales Revenue",
        ]);

        const html = render(managed, drafts);

        expect(html.match(/<tr[^>]*data-category-id=/g)).toHaveLength(6);
        expect(html).not.toContain("Old Hobby");
        expect(html).not.toContain("Gone");
        expect(scopeManagedCategories([...managed, ...managed])).toHaveLength(6);
    });

    it("has Category Name, Personal and Business columns", async () => {
        const { managed, drafts } = await openScreen();
        const html = render(managed, drafts);
        const head = html.slice(html.indexOf("<thead"), html.indexOf("</thead>"));

        expect(head).toMatch(/Category Name[\s\S]*Personal[\s\S]*Business/);
    });

    it("ticks Personal / Business from each category's saved scope", async () => {
        const { managed, drafts } = await openScreen();
        const html = render(managed, drafts);

        // Personal only
        expect(checkbox(html, "Personal - Groceries")).toBe("true");
        expect(checkbox(html, "Business - Groceries")).toBe("false");
        // Business only
        expect(checkbox(html, "Personal - Sales Revenue")).toBe("false");
        expect(checkbox(html, "Business - Sales Revenue")).toBe("true");
        // Both
        expect(checkbox(html, "Personal - Bank Charges")).toBe("true");
        expect(checkbox(html, "Business - Bank Charges")).toBe("true");
    });

    it("each checkbox sits inside its label, so clicking the label toggles it", async () => {
        const { managed, drafts } = await openScreen();
        const html = render(managed, drafts);

        const labels = html.match(/<label[^>]*>[\s\S]*?<\/label>/g) ?? [];

        expect(labels).toHaveLength(managed.length * 2);

        for (const label of labels) {
            expect(label).toMatch(/role="checkbox"/);
            expect(label).toMatch(/(Personal|Business)<\/label>$/);
        }
    });

    it("marks changed rows and shows the zero-scope message on a category with no scope", async () => {
        const { managed, drafts } = await openScreen();
        const html = render(managed, drafts, ["fuel"], ["groceries"]);

        const fuelRow = html.slice(html.indexOf('data-category-id="fuel"'));
        const groceriesRow = html.slice(html.indexOf('data-category-id="groceries"'));

        expect(fuelRow.slice(0, fuelRow.indexOf("</tr>"))).toContain("Changed");
        expect(groceriesRow.slice(0, groceriesRow.indexOf("</tr>"))).toContain(
            `role="alert" class="mt-0.5 text-xs text-red-600">${ZERO_SCOPE_MESSAGE}`
        );
    });
});

describe("editing drafts", () => {
    it("toggling changes only that checkbox of that category", async () => {
        const { managed, drafts } = await openScreen();

        const next = toggleScopeDraft(drafts, "fuel", "business");

        expect(next.fuel).toEqual({ personal: true, business: true });
        expect(next.groceries).toEqual(drafts.groceries);
        expect(drafts.fuel).toEqual({ personal: true, business: false }); // immutable
        expect(scopeChanges(managed, next)).toEqual([
            { id: "fuel", financeScope: "BOTH" },
        ]);
    });

    it("unticking the last scope is flagged - the other box is never ticked for the user", async () => {
        const { managed, drafts } = await openScreen();

        const next = toggleScopeDraft(drafts, "groceries", "personal");

        expect(next.groceries).toEqual({ personal: false, business: false });
        expect(zeroScopeIds(next)).toEqual(["groceries"]);
        // Not a savable change.
        expect(scopeChanges(managed, next)).toEqual([]);

        // Ticking Business resolves it.
        const fixed = toggleScopeDraft(next, "groceries", "business");
        expect(zeroScopeIds(fixed)).toEqual([]);
        expect(scopeChanges(managed, fixed)).toEqual([
            { id: "groceries", financeScope: "BUSINESS" },
        ]);
    });

    it("toggling back to the saved scope is no change", async () => {
        const { managed, drafts } = await openScreen();

        const there = toggleScopeDraft(drafts, "sales", "personal");
        const back = toggleScopeDraft(there, "sales", "personal");

        expect(scopeChanges(managed, there)).toHaveLength(1);
        expect(scopeChanges(managed, back)).toEqual([]);
    });

    it("search and filters narrow the rows", async () => {
        const { managed } = await openScreen();
        const names = (search: string, typeFilter = "ALL", scopeFilter = "ALL") =>
            filterScopeCategories(managed, { search, typeFilter, scopeFilter }).map(c => c.name);

        expect(names("fee")).toEqual(["ATM Fees", "Bank Charges"]); // name or description
        expect(names("", "INCOME")).toEqual(["Rental Income", "Sales Revenue"]);
        expect(names("", "ALL", "BUSINESS")).toEqual(["ATM Fees", "Bank Charges", "Sales Revenue"]);
        expect(names("", "ALL", "PERSONAL")).toEqual([
            "ATM Fees", "Bank Charges", "Fuel", "Groceries", "Rental Income",
        ]);
        expect(names("zzz")).toEqual([]);
    });
});

describe("Save Changes", () => {
    it("saves several categories at once - one success toast with the count", async () => {
        const { managed, drafts } = await openScreen();
        const before = byId();

        let next = toggleScopeDraft(drafts, "fuel", "business");            // -> BOTH
        next = toggleScopeDraft(next, "rent-in", "business");               // -> BOTH
        next = toggleScopeDraft(next, "bank", "personal");                  // -> BUSINESS

        const { changes, outcome, notify } = await save(managed, next);

        expect(changes).toHaveLength(3);
        expect(outcome).toEqual({ saved: true });
        expect(notify.success).toHaveBeenCalledOnce();
        expect(notify.success).toHaveBeenCalledWith("Scopes updated for 3 categories.");
        expect(notify.error).not.toHaveBeenCalled();

        const after = byId();

        expect(after.get("fuel")?.finance_scope).toBe("BOTH");
        expect(after.get("rent-in")?.finance_scope).toBe("BOTH");
        expect(after.get("bank")?.finance_scope).toBe("BUSINESS");

        // All other fields preserved.
        for (const id of ["fuel", "rent-in", "bank"]) {
            const { finance_scope: _a, updated_at: _b, ...rest } = after.get(id)!;
            const { finance_scope: _c, updated_at: _d, ...restBefore } = before.get(id)!;
            expect(rest).toEqual(restBefore);
        }
    });

    it("saves a single category", async () => {
        const { managed, drafts } = await openScreen();

        const { notify } = await save(
            managed,
            toggleScopeDraft(drafts, "sales", "personal")
        );

        expect(notify.success).toHaveBeenCalledWith("Scopes updated for 1 category.");
        expect(byId().get("sales")?.finance_scope).toBe("BOTH");
    });

    it("writes only the changed categories", async () => {
        const { managed, drafts } = await openScreen();
        const before = byId();

        await save(managed, toggleScopeDraft(drafts, "groceries", "business"));

        const after = byId();

        for (const [id, row] of before) {
            if (id === "groceries") {
                expect(after.get(id)?.updated_at).not.toBe("orig");
            } else {
                // Untouched - not even updated_at.
                expect(after.get(id)).toEqual(row);
            }
        }
    });

    it("persists - a fresh load (as after reopening) shows the saved scopes", async () => {
        const first = await openScreen();

        await save(first.managed, toggleScopeDraft(first.drafts, "fuel", "business"));

        const reopened = await openScreen();

        expect(reopened.drafts.fuel).toEqual({ personal: true, business: true });
        expect(checkbox(render(reopened.managed, reopened.drafts), "Business - Fuel")).toBe("true");
    });

    it("a database failure part-way leaves every category unchanged, with one error toast", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});

        sqlite.db!.exec(`
            CREATE TRIGGER fail_on_sales
            BEFORE UPDATE OF finance_scope ON categories
            WHEN OLD.id = 'sales'
            BEGIN
                SELECT RAISE(ABORT, 'simulated failure');
            END;
        `);

        const { managed, drafts } = await openScreen();
        const before = rows("SELECT * FROM categories ORDER BY id");

        // 'fuel' and 'groceries' are updated before 'sales' in the statement.
        let next = toggleScopeDraft(drafts, "fuel", "business");
        next = toggleScopeDraft(next, "groceries", "business");
        next = toggleScopeDraft(next, "sales", "personal");

        const { outcome, notify } = await save(managed, next);

        expect(outcome).toEqual({ saved: false });
        expect(notify.success).not.toHaveBeenCalled();
        expect(notify.error).toHaveBeenCalledOnce();
        expect(notify.error.mock.calls[0][0]).toMatch(
            /^Failed to save scopes - no categories were changed\. .*simulated failure/
        );
        expect(rows("SELECT * FROM categories ORDER BY id")).toEqual(before);
    });

    it("an invalid (zero) scope in a save writes nothing at all", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});

        const before = rows("SELECT * FROM categories ORDER BY id");

        const outcome = await runSaveCategoryScopes(
            new CategoryService(),
            [
                { id: "fuel", financeScope: "BOTH" },
                { id: "groceries", financeScope: "" as never },
            ],
            notifier()
        );

        expect(outcome).toEqual({ saved: false });
        expect(rows("SELECT * FROM categories ORDER BY id")).toEqual(before);
    });

    it("never touches deleted categories or transactions", async () => {
        const transactions = rows("SELECT * FROM transactions ORDER BY id");

        await new CategoryService().updateScopes([
            { id: "deleted", financeScope: "PERSONAL" },
            { id: "fuel", financeScope: "BOTH" },
        ]);

        expect(byId().get("deleted")?.finance_scope).toBe("BUSINESS");
        expect(byId().get("fuel")?.finance_scope).toBe("BOTH");
        expect(rows("SELECT * FROM transactions ORDER BY id")).toEqual(transactions);
    });
});

describe("dialog behaviour", () => {
    const source = readFileSync(
        path.resolve(__dirname, "CategoryScopesDialog.tsx"),
        "utf8"
    );

    it("Cancel (and closing) discards the drafts without writing anything", () => {
        // Cancel only closes; the next open rebuilds drafts from saved data.
        expect(source).toMatch(/onClick=\{close\}\s+disabled=\{saving\}[\s\S]{0,300}Cancel/);
        expect(source).toMatch(
            /function close\(\) \{\s+if \(!saving\) \{\s+onOpenChange\(false\);\s+\}\s+\}/
        );
        expect(source).toMatch(
            /if \(open\) \{\s+setDrafts\(initialScopeDrafts\(managed\)\);/
        );
        // The one write is in handleSave.
        expect(source.match(/runSaveCategoryScopes\(/g)).toHaveLength(1);
    });

    it("Save is blocked with no changes, with a zero-scope category, and while saving", () => {
        expect(source).toMatch(
            /disabled=\{\s*saving \|\|\s*changes\.length === 0 \|\|\s*zeroIds\.size > 0\s*\}/
        );
        expect(source).toMatch(
            /changes\.length === 0 \|\|\s*zeroIds\.size > 0 \|\|\s*inFlight\.current/
        );
    });

    it("after a successful save: refresh (via onSuccess) then close", () => {
        expect(source).toMatch(
            /if \(outcome\.saved\) \{\s+await onSuccess\?\.\(\);\s+onOpenChange\(false\);/
        );
    });
});

describe("existing behaviour", () => {
    it("bulk Delete still soft-deletes the selected categories", async () => {
        const categories = await new CategoryService().getAll();

        const outcome = await runBulkCategoryDelete(
            new CategoryService(),
            selectedCategories(categories, new Set(["fuel", "groceries"])),
            notifier()
        );

        expect(outcome).toEqual({ deletedIds: ["fuel", "groceries"], failed: false });
        expect(
            rows("SELECT id FROM categories WHERE deleted_at IS NOT NULL ORDER BY id")
        ).toEqual([{ id: "deleted" }, { id: "fuel" }, { id: "groceries" }]);
        expect(rows("SELECT COUNT(*) AS n FROM transactions")).toEqual([{ n: 3 }]);
    });
});
