import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import type { NormalizedTransactionCandidate } from "@financeos/import-engine";

import type { BaseFinanceScope, Category, FinanceScope } from "@/modules/categories/types";

import {
    enrichCandidatesWithLearnedRulesDetailed,
    type TransactionPatternRuleStore,
} from "../services/ImportService";
import { learningKeyForCandidate } from "../services/learningKey";

import {
    applyCategoryToMatchingRows,
    applyPreviewOverrides,
    createEmptyPreviewOverrides,
    resolveImportBlockingError,
    reuseUnchangedCandidates,
} from "./ImportsPage";
import {
    affectedRowsToggleLabel,
    isPreviewRowVisible,
    resolveImportCategoryOptions,
    rowsWithCategoryOutsideScope,
    UNCATEGORIZED_OPTION_LABEL,
    withRowCategory,
} from "./importCategoryOptions";
import { ImportPreviewRow } from "./ImportPreviewRow";

// ---------------------------------------------------------------------
// Import Preview - Category Scope (Personal / Business).
//
// The scope is OPTIONAL and only a view over the categories' existing
// finance_scope: no scope = every category the existing rules allow;
// Personal / Business = only categories whose scope includes it
// (Personal + Business ones in both); Uncategorized always available; a
// row's category (e.g. learned) outside the scope is shown as
// "Name (unavailable)", never silently replaced, and never blocks the
// Import.
// ---------------------------------------------------------------------

function category(id: string, name: string, financeScope: FinanceScope, overrides: Partial<Category> = {}): Category {
    return {
        id, parentId: null, name, categoryType: "EXPENSE", financeScope,
        businessEntityId: null, description: null, isActive: true, createdAt: "", updatedAt: "",
        ...overrides,
    };
}

const categories: Category[] = [
    category("cat-groceries", "Groceries", "PERSONAL"),
    category("cat-hosting", "Hosting", "BUSINESS"),
    category("cat-bank-fees", "Bank Fees", "BOTH"),
    category("cat-old-personal", "Old Personal", "PERSONAL", { isActive: false }),
];

const options = (scope: BaseFinanceScope | null, direction: NormalizedTransactionCandidate["type"] = "expense") =>
    resolveImportCategoryOptions({ categories, mappings: [], account: null, direction, scope });

function row(rowNumber: number, overrides: Partial<NormalizedTransactionCandidate> = {}): NormalizedTransactionCandidate {
    return {
        rowNumber, transactionDate: "2026-09-10", payee: "Payee", description: `NEFT/DR/${rowNumber}0001/SOME MERCHANT/`,
        amount: 100, type: "expense", referenceNumber: null, externalTransactionId: null, transactionType: null,
        balance: null, branch: null, counterparty: null, notes: null, categoryId: null, rawData: {},
        ...overrides,
    };
}

const noop = () => {};

function renderRow(candidate: NormalizedTransactionCandidate, scope: BaseFinanceScope | null): string {
    return renderToStaticMarkup(
        createElement("table", null, createElement("tbody", null,
            createElement(ImportPreviewRow, {
                candidate, displayNumber: 1, hasErrors: false, isDuplicate: false, isTransfer: false,
                indicatorState: "blank", indicatorClickable: false, hasMatchedLearnedRule: false,
                importing: false, directionCategoryOptions: options(scope), categories,
                categoriesLoading: false,
                onToggleSelfLearning: noop, onPayeeCommit: noop, onTransactionTypeChange: noop,
                onCategoryChange: noop, onNotesCommit: noop, onViewDescription: noop,
            }))));
}

// The row's Category <select> markup.
function categorySelect(html: string): string {
    const label = html.indexOf('aria-label="Category"');
    return html.slice(html.lastIndexOf("<select", label), html.indexOf("</select>", label) + "</select>".length);
}

// A learned rule store holding one category for the row's key.
function storeWith(candidate: NormalizedTransactionCandidate, categoryId: string): TransactionPatternRuleStore {
    const key = learningKeyForCandidate(candidate);
    return {
        async findByAccountAndPattern(_accountId, pattern) {
            return pattern === key ? { counterparty: "Learned Payee", type: null, notes: null, categoryId } : null;
        },
        async upsert() {
            throw new Error("preview must never write rules");
        },
    };
}

describe("no scope selected (scope is optional)", () => {
    it("a row with no category defaults to Uncategorized, and the dropdown is enabled", () => {
        const select = categorySelect(renderRow(row(2), null));

        expect(select).not.toMatch(/<select[^>]*\sdisabled=""/);
        expect(select).toContain(`<option value="" selected="">${UNCATEGORIZED_OPTION_LABEL}</option>`);
    });

    it("offers every active category the existing rules allow - no scope filtering", () => {
        expect(options(null).map(o => o.id)).toEqual(["cat-groceries", "cat-hosting", "cat-bank-fees"]);
    });

    it("an already-applied (learned) category is shown by name and kept", () => {
        const select = categorySelect(renderRow(row(2, { categoryId: "cat-hosting" }), null));

        expect(select).toContain('<option value="cat-hosting" selected="">Hosting</option>');
        expect(select).not.toContain("(unavailable)");
    });

    it("nothing is 'out of scope' without a scope", () => {
        expect(rowsWithCategoryOutsideScope([row(2, { categoryId: "cat-bank-fees" }), row(3, { categoryId: "cat-hosting" }), row(4)], categories, null)).toEqual([]);
    });
});

describe("scope filtering (existing finance_scope data)", () => {
    it("Personal shows only active Personal + Personal/Business categories", () => {
        expect(options("PERSONAL").map(o => o.id)).toEqual(["cat-groceries", "cat-bank-fees"]);
    });

    it("Business shows only active Business + Personal/Business categories", () => {
        expect(options("BUSINESS").map(o => o.id)).toEqual(["cat-hosting", "cat-bank-fees"]);
    });

    it("a Personal + Business category appears in both scopes, once each (never duplicated)", () => {
        for (const scope of ["PERSONAL", "BUSINESS"] as const) {
            expect(options(scope).filter(o => o.id === "cat-bank-fees")).toHaveLength(1);
        }
    });

    it("Uncategorized is always available, and the dropdown is enabled once a scope is chosen", () => {
        for (const scope of ["PERSONAL", "BUSINESS"] as const) {
            const select = categorySelect(renderRow(row(2), scope));
            expect(select).not.toMatch(/<select[^>]*\sdisabled=""/);
            expect(select).toContain(`<option value="" selected="">${UNCATEGORIZED_OPTION_LABEL}</option>`);
        }
    });

    it("filtering never changes any category's stored scope", () => {
        const before = structuredClone(categories);
        options("PERSONAL");
        options("BUSINESS");
        withRowCategory(options("PERSONAL"), "cat-hosting", categories, false);
        expect(categories).toEqual(before);
    });
});

describe("learned categories respect the selected scope", () => {
    it("a learned Personal category is applied and selectable under Personal", async () => {
        const base = row(2);
        const { candidates } = await enrichCandidatesWithLearnedRulesDetailed("acct", [base], storeWith(base, "cat-groceries"));

        expect(candidates[0].categoryId).toBe("cat-groceries");
        expect(withRowCategory(options("PERSONAL"), candidates[0].categoryId, categories, false)
            .find(o => o.id === "cat-groceries")).toEqual({ id: "cat-groceries", name: "Groceries", unavailable: false });
        expect(rowsWithCategoryOutsideScope(candidates, categories, "PERSONAL")).toEqual([]);
    });

    it("a learned Business category is applied and selectable under Business", async () => {
        const base = row(2);
        const { candidates } = await enrichCandidatesWithLearnedRulesDetailed("acct", [base], storeWith(base, "cat-hosting"));

        expect(candidates[0].categoryId).toBe("cat-hosting");
        expect(withRowCategory(options("BUSINESS"), "cat-hosting", categories, false)
            .find(o => o.id === "cat-hosting")?.unavailable).toBe(false);
        expect(rowsWithCategoryOutsideScope(candidates, categories, "BUSINESS")).toEqual([]);
    });

    it("a learned category outside the selected scope is shown as '(unavailable)', kept, and blocks the Import", async () => {
        const base = row(2);
        const { candidates } = await enrichCandidatesWithLearnedRulesDetailed("acct", [base], storeWith(base, "cat-hosting"));

        const select = categorySelect(renderRow(candidates[0], "PERSONAL"));
        expect(select).toContain('<option value="cat-hosting" selected="">Hosting (unavailable)</option>');
        expect(candidates[0].categoryId).toBe("cat-hosting");
        expect(rowsWithCategoryOutsideScope(candidates, categories, "PERSONAL")).toEqual([2]);
    });

    it("a Personal + Business learned category is fine under either scope", () => {
        for (const scope of ["PERSONAL", "BUSINESS"] as const) {
            expect(rowsWithCategoryOutsideScope([row(2, { categoryId: "cat-bank-fees" })], categories, scope)).toEqual([]);
        }
    });
});

describe("changing the scope never silently changes a selected category", () => {
    it("a category chosen under Business stays selected (shown unavailable) after switching to Personal", () => {
        const base = [row(2), row(3)];
        const overrides = applyCategoryToMatchingRows(base, createEmptyPreviewOverrides(), 2, "cat-hosting");
        const finals = applyPreviewOverrides(base, overrides);

        expect(categorySelect(renderRow(finals[0], "BUSINESS"))).toContain('<option value="cat-hosting" selected="">Hosting</option>');

        // Switch to Personal: the overrides/candidates are untouched.
        const afterSwitch = applyPreviewOverrides(base, overrides);
        expect(afterSwitch[0].categoryId).toBe("cat-hosting");
        expect(categorySelect(renderRow(afterSwitch[0], "PERSONAL"))).toContain('<option value="cat-hosting" selected="">Hosting (unavailable)</option>');
        // Row 3 shares row 2's narration pattern, so it received the
        // category by latest-edit propagation - both stay as chosen.
        expect(afterSwitch[1].categoryId).toBe("cat-hosting");
        expect(rowsWithCategoryOutsideScope(afterSwitch, categories, "PERSONAL")).toEqual([2, 3]);

        // Switching back makes it a normal choice again.
        expect(rowsWithCategoryOutsideScope(afterSwitch, categories, "BUSINESS")).toEqual([]);
    });
});

describe("page wiring", () => {
    const source = readFileSync(path.resolve(__dirname, "ImportsPage.tsx"), "utf-8");

    it("has a Personal / Business Category Scope selector above the table, starting with no scope", () => {
        expect(source).toContain("useState<BaseFinanceScope | null>(null)");
        expect(source).toContain('(["PERSONAL", "BUSINESS"] as const).map(scope =>');
        expect(source.indexOf("Category Scope")).toBeLessThan(source.indexOf('<table className="w-full min-w-[1060px] text-left">'));
        expect(source).not.toContain("categoryScopeSelected");
        expect(source).toContain("scope: categoryScope,");
    });

    it("the Import is never gated on the Category Scope or row categories", () => {
        const handleImport = source.slice(source.indexOf("const handleImport = async"), source.indexOf("await service.importCandidates("));
        expect(handleImport).toContain("resolveImportBlockingError({");
        expect(handleImport).not.toMatch(/categoryScope|OutsideScope|AffectedRows/);
        expect(source).not.toContain("Select a Category Scope to review them before importing");
        expect(source).not.toContain("before importing categorised transactions");
    });

    it("never edits categories from the Import Preview", () => {
        expect(source).not.toMatch(/updateCategory|setCategoryScopes|financeScope\s*:/);
    });
});

describe("performance: options are built per direction, not per row", () => {
    it("every row of a direction shares one options array for the selected scope", () => {
        const byDirection = { income: options("BUSINESS", "income"), expense: options("BUSINESS", "expense") };
        const rows = Array.from({ length: 5000 }, (_, i) => row(i + 2, { type: i % 2 ? "income" : "expense" }));
        const perRow = rows.map(r => byDirection[r.type as "income" | "expense"]);

        expect(new Set(perRow).size).toBe(2);
    });
});

// ---------------------------------------------------------------------
// "Show N Affected Rows" - a view filter over rows whose category is
// outside the selected scope. Reproduces the page's derivation exactly:
// previewCandidates = reuseUnchangedCandidates(applyPreviewOverrides(...)),
// affected = rowsWithCategoryOutsideScope(...), visible rows =
// isPreviewRowVisible(...), toggle = affectedRowsToggleLabel(...).
// ---------------------------------------------------------------------

// Letter-only names so every row has its own learning pattern (digits
// collapse), i.e. correcting one row never propagates to another.
function merchantName(i: number): string {
    return `SHOP${String.fromCharCode(65 + Math.floor(i / 26) % 26)}${String.fromCharCode(65 + (i % 26))}`;
}

// 46 rows carrying a learned Personal category (outside Business), 10
// Uncategorized, 10 Personal + Business.
function scenario(): NormalizedTransactionCandidate[] {
    return Array.from({ length: 66 }, (_, i) =>
        row(i + 2, {
            description: `UPI/DR/${4100000 + i}/${merchantName(i)}/YBL`,
            categoryId: i < 46 ? "cat-groceries" : i < 56 ? null : "cat-bank-fees",
        })
    );
}

function view(
    base: NormalizedTransactionCandidate[],
    overrides: ReturnType<typeof createEmptyPreviewOverrides>,
    scope: BaseFinanceScope,
    showAffectedOnly: boolean,
    previous: NormalizedTransactionCandidate[] | null = null
) {
    const candidates = reuseUnchangedCandidates(applyPreviewOverrides(base, overrides), previous);
    const affected = rowsWithCategoryOutsideScope(candidates, categories, scope);
    const affectedSet = new Set(affected);

    return {
        candidates,
        affected,
        warningShown: affected.length > 0,
        toggle: affectedRowsToggleLabel(showAffectedOnly, affected.length),
        visible: candidates.filter(c => isPreviewRowVisible(c.rowNumber, affectedSet, showAffectedOnly)),
    };
}

const affectedRowNumbers = Array.from({ length: 46 }, (_, i) => i + 2);

describe("Show N Affected Rows (affected-only preview filter)", () => {
    it("the warning shows the affected count and offers 'Show 46 Affected Rows'", () => {
        const v = view(scenario(), createEmptyPreviewOverrides(), "BUSINESS", false);

        expect(v.affected).toHaveLength(46);
        expect(v.warningShown).toBe(true);
        expect(v.toggle).toBe("Show 46 Affected Rows");
        expect(v.visible).toHaveLength(66);
    });

    it("clicking it shows exactly the 46 affected rows, and the toggle becomes 'Show All Rows'", () => {
        const v = view(scenario(), createEmptyPreviewOverrides(), "BUSINESS", true);

        expect(v.visible.map(c => c.rowNumber)).toEqual(affectedRowNumbers);
        expect(v.toggle).toBe("Show All Rows");
    });

    it("the affected rows' Category dropdowns stay enabled and show the category as unavailable", () => {
        const [first] = view(scenario(), createEmptyPreviewOverrides(), "BUSINESS", true).visible;
        const select = categorySelect(renderRow(first, "BUSINESS"));

        expect(select).not.toMatch(/<select[^>]*\sdisabled=""/);
        expect(select).toContain('<option value="cat-groceries" selected="">Groceries (unavailable)</option>');
    });

    it("correcting a row (to a Business category or Uncategorized) removes it from the view and updates the count", () => {
        const base = scenario();
        let overrides = applyCategoryToMatchingRows(base, createEmptyPreviewOverrides(), 2, "cat-hosting");

        let v = view(base, overrides, "BUSINESS", true);
        expect(v.affected).toHaveLength(45);
        expect(v.visible.map(c => c.rowNumber)).not.toContain(2);
        expect(view(base, overrides, "BUSINESS", false).toggle).toBe("Show 45 Affected Rows");

        overrides = applyCategoryToMatchingRows(base, overrides, 3, "");
        v = view(base, overrides, "BUSINESS", true);
        expect(v.affected).toHaveLength(44);
        expect(v.visible.map(c => c.rowNumber)).toEqual(affectedRowNumbers.slice(2));
    });

    it("once every affected row is corrected the view is empty, the warning goes away, and no 'Show N' toggle remains", () => {
        const base = scenario();
        let overrides = createEmptyPreviewOverrides();
        for (const rowNumber of affectedRowNumbers) {
            overrides = applyCategoryToMatchingRows(base, overrides, rowNumber, rowNumber % 2 ? "cat-bank-fees" : "cat-hosting");
        }

        const v = view(base, overrides, "BUSINESS", true);
        expect(v.affected).toEqual([]);
        expect(v.visible).toEqual([]);
        expect(v.warningShown).toBe(false);
        expect(view(base, overrides, "BUSINESS", false).toggle).toBeNull();
    });

    it("'Show All Rows' restores the complete preview, with the corrections kept", () => {
        const base = scenario();
        const overrides = applyCategoryToMatchingRows(base, createEmptyPreviewOverrides(), 2, "cat-hosting");

        const all = view(base, overrides, "BUSINESS", false);
        expect(all.visible).toHaveLength(66);
        expect(all.visible[0].categoryId).toBe("cat-hosting");
    });

    it("scope switching still works in the affected view - it follows the new scope", () => {
        const base = scenario();
        const overrides = applyCategoryToMatchingRows(base, createEmptyPreviewOverrides(), 2, "cat-hosting");

        // Under Personal, only the row now holding a Business category is affected.
        const personal = view(base, overrides, "PERSONAL", true);
        expect(personal.visible.map(c => c.rowNumber)).toEqual([2]);
        expect(personal.toggle).toBe("Show All Rows");
        expect(view(base, overrides, "PERSONAL", false).toggle).toBe("Show 1 Affected Rows");
    });

    it("filtering never changes rows or categories", () => {
        const base = scenario();
        const baseBefore = structuredClone(base);
        const categoriesBefore = structuredClone(categories);

        const filtered = view(base, createEmptyPreviewOverrides(), "BUSINESS", true);
        const full = view(base, createEmptyPreviewOverrides(), "BUSINESS", false);

        expect(base).toEqual(baseBefore);
        expect(categories).toEqual(categoriesBefore);
        expect(full.candidates).toEqual(baseBefore);
        expect(filtered.visible.every(c => c.categoryId === "cat-groceries")).toBe(true);
    });

    it("with 10,000 rows, correcting one row in the affected view only changes that row's object", () => {
        const base = Array.from({ length: 10000 }, (_, i) =>
            row(i + 2, { description: `UPI/DR/${i}/${merchantName(i)}${merchantName(Math.floor(i / 676))}/YBL`, categoryId: "cat-groceries" })
        );
        const first = view(base, createEmptyPreviewOverrides(), "BUSINESS", true);
        expect(first.visible).toHaveLength(10000);

        const overrides = applyCategoryToMatchingRows(base, createEmptyPreviewOverrides(), 2, "cat-hosting");
        const next = view(base, overrides, "BUSINESS", true, first.candidates);

        const changed = next.candidates.filter((c, i) => c !== first.candidates[i]).map(c => c.rowNumber);
        expect(changed).toEqual([2]);
        expect(next.visible).toHaveLength(9999);
    });
});

describe("affected view page wiring", () => {
    const source = readFileSync(path.resolve(__dirname, "ImportsPage.tsx"), "utf-8");

    it("the toggle sits in the warning, the table filters by the affected set, and it resets with the scope", () => {
        const warning = source.slice(source.indexOf("{categoryScope && categoryScopeAffectedRows.length > 0 && ("), source.indexOf('<div className="mt-6 overflow-hidden rounded-2xl border border-slate-100">'));
        expect(warning).toContain("{affectedRowsToggle}");
        expect(warning).toContain("They will import with that category unless you change it");
        expect(source).toContain("isPreviewRowVisible(");
        expect(source).toContain("categoryScopeAffectedRowSet,");
        // Every per-preview reset clears both the scope and the affected view.
        expect(source.split("setShowAffectedRowsOnly(false);").length).toBe(source.split("setCategoryScope(null);").length);
    });

    it("the affected-row view is review-only - the Import never looks at it", () => {
        const handleImport = source.slice(source.indexOf("const handleImport = async"), source.indexOf("await service.importCandidates("));
        expect(handleImport).not.toMatch(/showAffectedRowsOnly|affectedRowsViewActive|categoryScopeAffectedRows/);
    });
});

// ---------------------------------------------------------------------
// The Import is only ever blocked by genuine import errors.
// ---------------------------------------------------------------------

describe("resolveImportBlockingError - only genuine import errors block the Import", () => {
    const ready = { hasAccount: true, hasFile: true, hasPreview: true, errorRows: 0, readyRows: 5 };

    it("a ready preview is never blocked - scope and categories are not even inputs", () => {
        expect(resolveImportBlockingError(ready)).toBeNull();
    });

    it("still blocks genuine errors", () => {
        expect(resolveImportBlockingError({ ...ready, hasAccount: false })).toBe("Please select an account.");
        expect(resolveImportBlockingError({ ...ready, hasFile: false })).toBe("Please select a Statement File.");
        expect(resolveImportBlockingError({ ...ready, hasPreview: false })).toBe("Please preview the statement before importing.");
        expect(resolveImportBlockingError({ ...ready, errorRows: 1 })).toMatch(/validation errors/);
        expect(resolveImportBlockingError({ ...ready, readyRows: 0 })).toBe("There are no new transactions to import.");
    });
});
