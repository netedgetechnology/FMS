import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { FinanceFoundationMigration } from "@/core/database/migrations/004_finance_foundation";

import { CategoryService } from "../services";
import type { Category } from "../types";

import {
    getCategorySelectionState,
    runBulkCategoryDelete,
    selectedCategories,
    toggleAllCategoriesSelected,
    toggleCategorySelected,
    withoutIds,
} from "./categoryBulkSelection";

// ---------------------------------------------------------------------
// Categories bulk selection / delete. No component-render interaction
// setup exists (vitest runs with environment: "node"), so the page's
// behaviour is exercised through the exact functions CategoriesPage and
// BulkDeleteCategoriesDialog call, plus source checks for the wiring.
// Deletes run the real CategoryRepository SQL against an in-memory
// database built from the app's own categories migration.
// ---------------------------------------------------------------------

const sqlite = { db: null as DatabaseSync | null };

vi.mock("@/core/database/engine/SQLiteProvider", () => ({
    SQLiteProvider: {
        getInstance: () => ({
            async select(sql: string, binds: unknown[] = []) {
                return sqlite.db
                    ? sqlite.db.prepare(sql).all(...(binds as never[]))
                    : [];
            },
            async execute(sql: string, binds: unknown[] = []) {
                sqlite.db?.prepare(sql).run(...(binds as never[]));
            },
        }),
    },
}));

function category(id: string, overrides: Partial<Category> = {}): Category {
    return {
        id,
        parentId: null,
        name: id,
        categoryType: "EXPENSE",
        financeScope: "PERSONAL",
        businessEntityId: null,
        description: null,
        isActive: true,
        createdAt: "",
        updatedAt: "",
        ...overrides,
    };
}

const rent = category("rent", { name: "Rent" });
const salary = category("salary", { name: "Salary", categoryType: "INCOME" });
const fuel = category("fuel", { name: "Fuel" });
const all = [rent, salary, fuel];

function notifier() {
    return { success: vi.fn(), error: vi.fn() };
}

beforeEach(() => {
    sqlite.db = null;
    vi.restoreAllMocks();
});

describe("header checkbox state", () => {
    it("is unchecked when nothing is selected", () => {
        expect(getCategorySelectionState(all, new Set())).toEqual({
            allSelected: false,
            someSelected: false,
        });
    });

    it("is indeterminate when some displayed rows are selected", () => {
        expect(
            getCategorySelectionState(all, new Set(["rent"]))
        ).toEqual({ allSelected: false, someSelected: true });
    });

    it("is checked when every displayed row is selected", () => {
        expect(
            getCategorySelectionState(all, new Set(["rent", "salary", "fuel"]))
        ).toEqual({ allSelected: true, someSelected: false });
    });

    it("is unchecked for an empty list", () => {
        expect(getCategorySelectionState([], new Set(["rent"]))).toEqual({
            allSelected: false,
            someSelected: false,
        });
    });
});

describe("selection", () => {
    it("toggles individual rows on and off", () => {
        const one = toggleCategorySelected(new Set(), "rent");
        const two = toggleCategorySelected(one, "fuel");

        expect([...two].sort()).toEqual(["fuel", "rent"]);
        expect([...toggleCategorySelected(two, "rent")]).toEqual(["fuel"]);
        // Never mutates the previous state.
        expect([...one]).toEqual(["rent"]);
    });

    it("header selects all rows, then deselects all", () => {
        const selected = toggleAllCategoriesSelected(new Set(), all);

        expect([...selected].sort()).toEqual(["fuel", "rent", "salary"]);
        expect(toggleAllCategoriesSelected(selected, all).size).toBe(0);
    });

    it("header on an indeterminate state selects all", () => {
        expect(
            [...toggleAllCategoriesSelected(new Set(["rent"]), all)].sort()
        ).toEqual(["fuel", "rent", "salary"]);
    });

    it("with a filter, select-all means the displayed rows only (like Transactions)", () => {
        // e.g. Type filter = Expense
        const displayed = all.filter(c => c.categoryType === "EXPENSE");

        const selected = toggleAllCategoriesSelected(new Set(), displayed);

        expect([...selected].sort()).toEqual(["fuel", "rent"]);
        expect(getCategorySelectionState(displayed, selected)).toEqual({
            allSelected: true,
            someSelected: false,
        });
        // Clearing the filter: the full list is now only partly selected.
        expect(getCategorySelectionState(all, selected)).toEqual({
            allSelected: false,
            someSelected: true,
        });
    });

    it("with a filter, deselect-all clears the displayed rows and keeps hidden selections", () => {
        const displayed = [rent];
        const selected = new Set(["rent", "salary"]);

        expect([...toggleAllCategoriesSelected(selected, displayed)]).toEqual([
            "salary",
        ]);
    });

    it("the bulk target is the selected categories that still exist", () => {
        // "gone" was deleted via its own row Delete after being selected.
        expect(
            selectedCategories(all, new Set(["salary", "gone", "rent"])).map(
                c => c.id
            )
        ).toEqual(["rent", "salary"]);
    });

    it("drops deleted ids from the selection", () => {
        expect(
            withoutIds(new Set(["rent", "salary", "fuel"]), ["rent", "fuel"])
        ).toEqual(new Set(["salary"]));
        expect(withoutIds(new Set(["rent"]), ["rent"]).size).toBe(0);
    });
});

describe("runBulkCategoryDelete", () => {
    it("deletes every selected category with the existing delete and shows one success toast", async () => {
        const service = { delete: vi.fn().mockResolvedValue(undefined) };
        const notify = notifier();

        const outcome = await runBulkCategoryDelete(service, all, notify);

        expect(service.delete.mock.calls).toEqual([
            ["rent"],
            ["salary"],
            ["fuel"],
        ]);
        expect(outcome).toEqual({
            deletedIds: ["rent", "salary", "fuel"],
            failed: false,
        });
        expect(notify.success).toHaveBeenCalledOnce();
        expect(notify.success).toHaveBeenCalledWith(
            "3 categories deleted successfully."
        );
        expect(notify.error).not.toHaveBeenCalled();
    });

    it("uses the single-delete success message for one category", async () => {
        const notify = notifier();

        await runBulkCategoryDelete(
            { delete: vi.fn().mockResolvedValue(undefined) },
            [rent],
            notify
        );

        expect(notify.success).toHaveBeenCalledWith(
            "Category deleted successfully."
        );
    });

    it("stops at a failure, reports what was deleted, and shows only the error toast", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});

        const service = {
            delete: vi
                .fn()
                .mockResolvedValueOnce(undefined)
                .mockRejectedValueOnce(
                    "error returned from database: (code: 5) database is locked"
                ),
        };
        const notify = notifier();

        const outcome = await runBulkCategoryDelete(service, all, notify);

        expect(service.delete).toHaveBeenCalledTimes(2);
        expect(outcome).toEqual({ deletedIds: ["rent"], failed: true });
        expect(notify.success).not.toHaveBeenCalled();
        expect(notify.error).toHaveBeenCalledWith(
            'Deleted 1 of 3 categories, then could not delete "Salary": The database is busy right now - another window of this app may already have it open. Close any other open copies and try again.'
        );

        // What the page then does: keep only the not-deleted ones selected.
        expect(
            withoutIds(new Set(["rent", "salary", "fuel"]), outcome.deletedIds)
        ).toEqual(new Set(["salary", "fuel"]));
    });

    it("a failure on the first category shows the plain error", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});

        const notify = notifier();

        const outcome = await runBulkCategoryDelete(
            { delete: vi.fn().mockRejectedValue(new Error("Disk full")) },
            all,
            notify
        );

        expect(outcome).toEqual({ deletedIds: [], failed: true });
        expect(notify.error).toHaveBeenCalledWith("Disk full");
    });

    it("soft-deletes multiple categories in the real database and the list refreshes without them", async () => {
        const db = new DatabaseSync(":memory:");

        db.exec(FinanceFoundationMigration.sql);
        db.exec(`
            INSERT INTO categories (id, name, category_type) VALUES ('rent', 'Rent', 'EXPENSE');
            INSERT INTO categories (id, name, category_type) VALUES ('salary', 'Salary', 'INCOME');
            INSERT INTO categories (id, name, category_type) VALUES ('fuel', 'Fuel', 'EXPENSE');
        `);
        sqlite.db = db;

        const service = new CategoryService();
        const loaded = await service.getAll();
        const notify = notifier();

        const outcome = await runBulkCategoryDelete(
            service,
            selectedCategories(loaded, new Set(["rent", "fuel"])),
            notify
        );

        expect(outcome.failed).toBe(false);
        expect((await service.getAll()).map(c => c.name)).toEqual(["Salary"]);

        // Soft delete: rows are kept with deleted_at set, never removed.
        const rows = db
            .prepare("SELECT id, deleted_at FROM categories ORDER BY id")
            .all() as { id: string; deleted_at: string | null }[];

        expect(rows.map(row => row.id)).toEqual(["fuel", "rent", "salary"]);
        expect(rows.find(row => row.id === "rent")?.deleted_at).not.toBeNull();
        expect(rows.find(row => row.id === "fuel")?.deleted_at).not.toBeNull();
        expect(rows.find(row => row.id === "salary")?.deleted_at).toBeNull();
    });

    it("existing single-category delete still soft-deletes just that category", async () => {
        const db = new DatabaseSync(":memory:");

        db.exec(FinanceFoundationMigration.sql);
        db.exec(`
            INSERT INTO categories (id, name, category_type) VALUES ('rent', 'Rent', 'EXPENSE');
            INSERT INTO categories (id, name, category_type) VALUES ('fuel', 'Fuel', 'EXPENSE');
        `);
        sqlite.db = db;

        await new CategoryService().delete("rent");

        expect(
            (await new CategoryService().getAll()).map(c => c.id)
        ).toEqual(["fuel"]);
        expect(
            db.prepare("SELECT COUNT(*) AS n FROM categories").get()
        ).toEqual({ n: 2 });
    });
});

describe("page and dialog wiring", () => {
    const page = readFileSync(
        path.resolve(__dirname, "../pages/CategoriesPage.tsx"),
        "utf8"
    );
    const dialog = readFileSync(
        path.resolve(__dirname, "../components/BulkDeleteCategoriesDialog.tsx"),
        "utf8"
    );

    it("select-all works on the displayed (filtered) rows", () => {
        expect(page).toMatch(
            /getCategorySelectionState\(\s*filteredCategories,\s*selectedIds\s*\)/
        );
        expect(page).toMatch(
            /toggleAllCategoriesSelected\(\s*previous,\s*filteredCategories\s*\)/
        );
    });

    it("the bulk Delete button is disabled until something is selected and shows the count", () => {
        expect(page).toMatch(
            /disabled=\{bulkDeleteCategories\.length === 0\}\s+onClick=\{\(\) => setIsBulkDeleteOpen\(true\)\}/
        );
        expect(page).toContain('aria-label="Delete selected categories"');
        expect(page).toContain("Delete ${bulkDeleteCategories.length} selected");
    });

    it("after deleting, clears the deleted ids from the selection and refreshes the list", () => {
        expect(page).toMatch(
            /onDeleted=\{async deletedIds => \{\s+setSelectedIds\(previous =>\s+withoutIds\(previous, deletedIds\)\s+\);\s+await refresh\(\);/
        );
    });

    it("the existing single-row Delete is still wired to DeleteCategoryDialog", () => {
        expect(page).toMatch(/onDelete=\{setDeleteCategory\}/);
        expect(page).toMatch(
            /<DeleteCategoryDialog\s+category=\{deleteCategory\}[\s\S]*?onSuccess=\{refresh\}/
        );
    });

    it("the dialog blocks duplicate submissions and closing while deleting", () => {
        expect(dialog).toMatch(
            /if \(count === 0 \|\| inFlight\.current\) \{\s+return;\s+\}\s+inFlight\.current = true;/
        );
        expect(dialog).toMatch(/disabled=\{loading\}\s+onClick=\{handleDelete\}/);
        expect(dialog).toMatch(/if \(!loading\) \{\s+onOpenChange\(open\);/);
        expect(dialog).toMatch(/showCloseButton=\{!loading\}/);
    });

    it("the dialog reuses the existing delete via runBulkCategoryDelete and the app's toast", () => {
        expect(dialog).toMatch(
            /runBulkCategoryDelete\(\s*new CategoryService\(\),\s*categories,\s*toast\s*\)/
        );
        // Stays open on failure so the rest can be retried or cancelled.
        expect(dialog).toMatch(/if \(!outcome\.failed\) \{\s+onOpenChange\(false\);/);
    });
});
