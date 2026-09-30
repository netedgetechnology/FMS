import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NormalizedTransactionCandidate } from "@financeos/import-engine";

import { CounterpartyRulesMigration } from "@/core/database/migrations/026_counterparty_rules";
import { CounterpartyRulesAccountScopeMigration } from "@/core/database/migrations/027_counterparty_rules_account_scope";
import { CounterpartyRulesTypeNotesMigration } from "@/core/database/migrations/028_counterparty_rules_type_notes";
import { CounterpartyRulesCategoryMigration } from "@/core/database/migrations/039_counterparty_rules_category";
import type {
    Category,
    CategoryContextMapping,
} from "@/modules/categories/types";

import type { ImportBatch, ImportRow } from "../types";
import { CounterpartyRuleRepository } from "../repositories/CounterpartyRuleRepository";
import { learningKeyForCandidate } from "../services/learningKey";
import {
    enrichCandidatesWithLearnedRulesDetailed,
    ImportService,
    learnRuleFromCandidate,
    type TransactionPatternRuleStore,
} from "../services/ImportService";

import {
    applyCategoryToMatchingRows,
    applyPayeeToMatchingRows,
    applyPreviewOverrides,
    createEmptyPreviewOverrides,
    deriveSessionLearnedRowNumbers,
    resolveImportBlockingError,
} from "./ImportsPage";
import {
    resolveImportCategoryOptions,
    rowsWithCategoryOutsideScope,
    UNAVAILABLE_CATEGORY_LABEL,
    UNCATEGORIZED_OPTION_LABEL,
    UNCATEGORIZED_OPTION_VALUE,
    withRowCategory,
} from "./importCategoryOptions";

// ---------------------------------------------------------------------
// Import Preview - Category column
//
// No component-render test setup exists in this repo (vitest runs with
// environment: "node"), so the column is exercised through the exact
// functions ImportsPage calls (resolveImportCategoryOptions /
// withRowCategory for the dropdown, applyCategoryToMatchingRows /
// applyPreviewOverrides for preview state, ImportService for the actual
// import) plus a check of the page source for the rendered column.
//
// Every database access goes through SQLiteProvider, which is mocked
// here: preview-only operations must never reach it, and the one
// repository test runs the real SQL against an in-memory database.
// ---------------------------------------------------------------------

const dbCalls: string[] = [];
const sqlite = { db: null as DatabaseSync | null };

vi.mock("@/core/database/engine/SQLiteProvider", () => ({
    SQLiteProvider: {
        getInstance: () => ({
            async select(sql: string, binds: unknown[] = []) {
                dbCalls.push(`select: ${sql.trim().split("\n")[0]}`);
                return sqlite.db
                    ? sqlite.db.prepare(sql).all(...(binds as never[]))
                    : [];
            },
            async execute(sql: string, binds: unknown[] = []) {
                dbCalls.push(`execute: ${sql.trim().split("\n")[0]}`);
                sqlite.db?.prepare(sql).run(...(binds as never[]));
            },
        }),
    },
}));

beforeEach(() => {
    dbCalls.length = 0;
});

function category(overrides: Partial<Category> = {}): Category {
    return {
        id: "cat-sales",
        parentId: null,
        name: "Sales",
        categoryType: "INCOME",
        financeScope: "BUSINESS",
        businessEntityId: null,
        description: null,
        isActive: true,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        ...overrides,
    };
}

function mapping(
    overrides: Partial<CategoryContextMapping>
): CategoryContextMapping {
    return {
        id: "map-1",
        categoryId: "cat-sales",
        accountId: null,
        businessEntityId: null,
        categoryType: "INCOME",
        isActive: true,
        createdAt: "",
        updatedAt: "",
        ...overrides,
    };
}

// Loaded from the Categories module in the app - arbitrary names here,
// nothing in the Import code knows any of them.
const categories: Category[] = [
    category({ id: "cat-sales", name: "Sales", categoryType: "INCOME" }),
    category({ id: "cat-supplies", name: "Office Supplies", categoryType: "EXPENSE" }),
    category({ id: "cat-rent", name: "Rent", categoryType: "EXPENSE" }),
    category({ id: "cat-old", name: "Old Category", isActive: false }),
];

const account = { id: "account-1", businessEntityId: "be-1" };

function row(
    rowNumber: number,
    overrides: Partial<NormalizedTransactionCandidate> = {}
): NormalizedTransactionCandidate {
    return {
        rowNumber,
        transactionDate: "2026-08-01",
        payee: "ABC Ltd",
        description: `NEFT/IN4262155${rowNumber}/ABC LTD`,
        amount: 100,
        type: "expense",
        referenceNumber: null,
        externalTransactionId: null,
        balance: null,
        branch: null,
        transactionType: null,
        counterparty: null,
        notes: null,
        rawData: {},
        ...overrides,
    };
}

// The spec's statement: rows 1, 2, 5 Credit; rows 3, 4 Debit.
const statement = [
    row(1, { type: "income", amount: 10000 }),
    row(2, { type: "income", amount: 5000 }),
    row(3, { type: "expense", amount: 2000 }),
    row(4, { type: "expense", amount: 3000 }),
    row(5, { type: "income", amount: 7000 }),
];

describe("Category column renders in the Import Preview table", () => {
    const source = readFileSync(
        path.resolve(__dirname, "ImportsPage.tsx"),
        "utf-8"
    );

    it("has a Category header between Amount and Notes, and a per-row select", () => {
        const amount = source.indexOf("                                                Amount\n");
        const categoryHeader = source.indexOf("                                                Category\n");
        const notes = source.indexOf("                                                Notes\n");

        expect(categoryHeader).toBeGreaterThan(amount);
        expect(notes).toBeGreaterThan(categoryHeader);

        // The row markup lives in ImportPreviewRow (a memoized row).
        const rowSource = readFileSync(
            path.resolve(__dirname, "ImportPreviewRow.tsx"),
            "utf-8"
        );

        expect(rowSource).toContain('aria-label="Category"');
        expect(rowSource).toContain("withRowCategory(");
        expect(rowSource).toContain("onCategoryChange(");
        expect(source).toContain("onCategoryChange={handleCategoryOverride}");
        expect(source).toContain("handleCategoryOverride = useCallback(");
    });

    it("loads options from the Categories module - no hard-coded names", () => {
        expect(source).toContain("useCategories()");
        expect(source).toContain("useCategoryContextMappings()");

        for (const name of ["Sales", "Office Supplies", "Rent", "Salary", "Groceries"]) {
            expect(source).not.toContain(`"${name}"`);
        }
    });

    it("Category is not added to Saved Import Mappings", () => {
        const saveCall = source.slice(
            source.indexOf("await service.saveMapping({"),
            source.indexOf("});", source.indexOf("await service.saveMapping({"))
        );

        expect(saveCall).not.toMatch(/categor/i);
        expect(
            readFileSync(
                path.resolve(__dirname, "../types/ImportMapping.ts"),
                "utf-8"
            )
        ).not.toMatch(/categor/i);
    });
});

describe("Category dropdown options (Categories module + existing Income/Expense rules)", () => {
    it("lists every active category by id - inactive ones are left out", () => {
        const options = resolveImportCategoryOptions({
            categories,
            mappings: [],
            account,
            direction: "expense",
            scope: "BUSINESS",
        });

        expect(options.map(o => o.id)).toEqual([
            "cat-sales",
            "cat-supplies",
            "cat-rent",
        ]);
        expect(options.map(o => o.name)).toEqual([
            "Sales",
            "Office Supplies",
            "Rent",
        ]);
    });

    it("has an Uncategorized option whose value is empty (stored as null)", () => {
        expect(UNCATEGORIZED_OPTION_LABEL).toBe("Uncategorized");
        expect(UNCATEGORIZED_OPTION_VALUE).toBe("");
    });

    it("a category's own default type is only a suggestion - never hides it (same as the manual form)", () => {
        const creditOptions = resolveImportCategoryOptions({
            categories,
            mappings: [],
            account,
            direction: "income",
            scope: "BUSINESS",
        });

        expect(creditOptions.map(o => o.id)).toContain("cat-rent");
    });

    it("hides a category locked to the opposite direction for this account or business entity", () => {
        const mappings = [
            mapping({ categoryId: "cat-sales", accountId: "account-1", categoryType: "INCOME" }),
            mapping({ id: "map-2", categoryId: "cat-rent", businessEntityId: "be-1", categoryType: "EXPENSE" }),
        ];

        const debit = resolveImportCategoryOptions({
            categories,
            mappings,
            account,
            direction: "expense",
            scope: "BUSINESS",
        }).map(o => o.id);
        const credit = resolveImportCategoryOptions({
            categories,
            mappings,
            account,
            direction: "income",
            scope: "BUSINESS",
        }).map(o => o.id);

        expect(debit).toEqual(["cat-supplies", "cat-rent"]);
        expect(credit).toEqual(["cat-sales", "cat-supplies"]);
    });

    it("mappings for a different account don't affect this import", () => {
        const options = resolveImportCategoryOptions({
            categories,
            mappings: [mapping({ categoryId: "cat-sales", accountId: "other-account" })],
            account,
            direction: "expense",
            scope: "BUSINESS",
        });

        expect(options.map(o => o.id)).toContain("cat-sales");
    });

    it("keeps a row's current unavailable category visible instead of silently showing Uncategorized", () => {
        const base = resolveImportCategoryOptions({
            categories,
            mappings: [],
            account,
            direction: "expense",
            scope: "BUSINESS",
        });

        expect(withRowCategory(base, "cat-old", categories, false)[0]).toEqual({
            id: "cat-old",
            name: "Old Category (unavailable)",
            unavailable: true,
        });
        expect(withRowCategory(base, "deleted-id", categories, false)[0].name).toBe(
            UNAVAILABLE_CATEGORY_LABEL
        );
        // Nothing fabricated while categories are loading, or for a normal value.
        expect(withRowCategory(base, "deleted-id", [], true)).toEqual(base);
        expect(withRowCategory(base, "cat-rent", categories, false)).toEqual(base);
        expect(withRowCategory(base, null, categories, false)).toEqual(base);
    });
});

describe("Category in preview state", () => {
    it("stores the chosen category id on the row; Uncategorized stores null", () => {
        const overrides = applyCategoryToMatchingRows(
            statement,
            createEmptyPreviewOverrides(),
            3,
            "cat-rent"
        );

        expect(applyPreviewOverrides(statement, overrides)[2].categoryId).toBe(
            "cat-rent"
        );

        // Uncategorized on a row that came in with a (learned) category.
        const learned = statement.map(r => ({ ...r, categoryId: "cat-supplies" }));
        const cleared = applyCategoryToMatchingRows(
            learned,
            createEmptyPreviewOverrides(),
            4,
            ""
        );
        const rows = applyPreviewOverrides(learned, cleared);

        expect(cleared.categoryId.get(4)).toBe("");
        expect(rows[3].categoryId).toBeNull();
        // "" never propagates.
        expect(rows[2].categoryId).toBe("cat-supplies");
        // Payee/Notes/Type untouched.
        expect(rows[3].payee).toBe("ABC Ltd");
        expect(rows[3].notes).toBeNull();
        expect(rows[3].transactionType).toBeNull();
    });

    it("a Credit choice propagates only to matching Credit rows; a Debit choice only to Debit rows", () => {
        const credit = applyCategoryToMatchingRows(
            statement,
            createEmptyPreviewOverrides(),
            1,
            "cat-sales"
        );

        expect([...credit.categoryId.keys()].sort()).toEqual([1, 2, 5]);

        const both = applyCategoryToMatchingRows(statement, credit, 3, "cat-rent");

        expect(
            applyPreviewOverrides(statement, both).map(r => r.categoryId)
        ).toEqual(["cat-sales", "cat-sales", "cat-rent", "cat-rent", "cat-sales"]);
    });

    it("Uncategorized never propagates, and re-choosing the original value is an undo", () => {
        expect(
            applyCategoryToMatchingRows(statement, createEmptyPreviewOverrides(), 1, "")
                .categoryId.size
        ).toBe(0);

        const withLearned = statement.map(r => ({ ...r, categoryId: "cat-sales" }));
        const changed = applyCategoryToMatchingRows(
            withLearned,
            createEmptyPreviewOverrides(),
            1,
            "cat-supplies"
        );
        const undone = applyCategoryToMatchingRows(withLearned, changed, 1, "cat-sales");

        expect(undone.categoryId.size).toBe(0);
    });

    it("a category edit marks the row (and its propagation) as learned this session", () => {
        const overrides = applyCategoryToMatchingRows(
            statement,
            createEmptyPreviewOverrides(),
            3,
            "cat-rent"
        );

        expect(
            [...deriveSessionLearnedRowNumbers(
                applyPreviewOverrides(statement, overrides),
                overrides,
                new Set()
            )].sort()
        ).toEqual([3, 4]);
    });

    it("does not change Payee propagation or other fields", () => {
        const payee = applyPayeeToMatchingRows(
            statement,
            createEmptyPreviewOverrides(),
            1,
            "ABC Ltd - receipts"
        );

        expect([...payee.payee.keys()].sort()).toEqual([1, 2, 5]);
        expect(payee.categoryId.size).toBe(0);
    });

    it("preview selection never touches the database", () => {
        const overrides = applyCategoryToMatchingRows(
            statement,
            createEmptyPreviewOverrides(),
            1,
            "cat-sales"
        );

        applyPreviewOverrides(statement, overrides);
        resolveImportCategoryOptions({ categories, mappings: [], account, direction: "income", scope: "BUSINESS" });

        expect(dbCalls).toEqual([]);
        // Inputs untouched.
        expect(statement.every(r => r.categoryId === undefined)).toBe(true);
    });
});

function createRuleStore(): TransactionPatternRuleStore & {
    saved: Map<string, { payee: string; categoryId: string | null }>;
} {
    const saved = new Map<string, { payee: string; categoryId: string | null }>();

    return {
        saved,
        async findByAccountAndPattern(accountId, pattern) {
            const rule = saved.get(`${accountId}::${pattern}`);

            return rule
                ? {
                      counterparty: rule.payee,
                      type: null,
                      notes: null,
                      categoryId: rule.categoryId,
                  }
                : null;
        },
        async upsert(accountId, pattern, payee, _type, _notes, categoryId) {
            const key = `${accountId}::${pattern}`;

            saved.set(key, {
                payee,
                categoryId: categoryId ?? saved.get(key)?.categoryId ?? null,
            });
        },
    };
}

describe("Learned category is Credit/Debit specific", () => {
    it("a category learned from ABC LTD Credit applies only to ABC LTD Credit rows on the next import", async () => {
        const store = createRuleStore();

        await learnRuleFromCandidate(
            "account-1",
            row(1, { type: "income", categoryId: "cat-sales" }),
            store
        );

        const { candidates, matchedRowNumbers } =
            await enrichCandidatesWithLearnedRulesDetailed("account-1", statement, store);

        expect([...matchedRowNumbers].sort()).toEqual([1, 2, 5]);
        expect(candidates.map(c => c.categoryId ?? null)).toEqual([
            "cat-sales",
            "cat-sales",
            null,
            null,
            "cat-sales",
        ]);
    });

    it("Credit and Debit learn separate categories for the same payee", async () => {
        const store = createRuleStore();

        await learnRuleFromCandidate("account-1", row(1, { type: "income", categoryId: "cat-sales" }), store);
        await learnRuleFromCandidate("account-1", row(3, { type: "expense", categoryId: "cat-rent" }), store);

        expect(store.saved.size).toBe(2);

        const { candidates } = await enrichCandidatesWithLearnedRulesDetailed(
            "account-1",
            statement,
            store
        );

        expect(candidates.map(c => c.categoryId)).toEqual([
            "cat-sales",
            "cat-sales",
            "cat-rent",
            "cat-rent",
            "cat-sales",
        ]);
    });

    it("a rule with no learned category leaves the row's category as it was", async () => {
        const store = createRuleStore();

        await learnRuleFromCandidate("account-1", row(3), store);

        const { candidates } = await enrichCandidatesWithLearnedRulesDetailed(
            "account-1",
            [row(4, { categoryId: "cat-supplies" })],
            store
        );

        expect(candidates[0].categoryId).toBe("cat-supplies");
    });
});

describe("Category survives the actual Import", () => {
    function makeService(
        create: (request: Record<string, unknown>) => Promise<string>
    ) {
        let batch: ImportBatch = {
            id: "batch-1",
            accountId: "account-1",
            importType: "BANK_CSV",
            sourceFileName: "statement.csv",
            status: "PENDING",
            totalRows: 0,
            importedRows: 0,
            duplicateRows: 0,
            failedRows: 0,
            createdAt: "",
            updatedAt: "",
        };
        const rows = new Map<string, ImportRow>();
        const store = createRuleStore();
        const service = new ImportService();

        Object.defineProperty(service, "batchRepository", {
            value: {
                async getById() { return batch; },
                async create() {},
                async update(request: Partial<ImportBatch>) {
                    batch = { ...batch, ...request } as ImportBatch;
                },
            },
        });
        Object.defineProperty(service, "rowRepository", {
            value: {
                async getByBatchId() { return [...rows.values()]; },
                async create(r: ImportRow) { rows.set(r.id, r); return r; },
                async update(request: Partial<ImportRow> & { id: string }) {
                    const existing = rows.get(request.id);
                    if (existing) rows.set(request.id, { ...existing, ...request });
                },
            },
        });
        Object.defineProperty(service, "transactionRepository", {
            value: { async findDuplicate() { return null; } },
        });
        Object.defineProperty(service, "transactionService", {
            value: { create },
        });
        Object.defineProperty(service, "counterpartyRuleRepository", {
            value: store,
        });

        return { service, rows, store, getBatch: () => batch };
    }

    it("saves the previewed category id on each created transaction (null for Uncategorized)", async () => {
        const created: Array<Record<string, unknown>> = [];
        const { service, store } = makeService(async request => {
            created.push(request);
            return `txn-${created.length}`;
        });

        // Row 6: a different payee left Uncategorized.
        const rows = [
            ...statement,
            row(6, { description: "OTHER PAYEE NARRATION", amount: 40 }),
        ];

        let overrides = applyCategoryToMatchingRows(rows, createEmptyPreviewOverrides(), 1, "cat-sales");
        overrides = applyCategoryToMatchingRows(rows, overrides, 3, "cat-rent");

        await service.executeCandidates(
            "batch-1",
            applyPreviewOverrides(rows, overrides)
        );

        expect(created.map(c => c.categoryId)).toEqual([
            "cat-sales",
            "cat-sales",
            "cat-rent",
            "cat-rent",
            "cat-sales",
            null,
        ]);
        // Amount / type unchanged.
        expect(created.map(c => [c.type, c.amount])).toEqual([
            ["income", 10000],
            ["income", 5000],
            ["expense", 2000],
            ["expense", 3000],
            ["income", 7000],
            ["expense", 40],
        ]);

        // Learned per direction for the next import.
        const credit = await store.findByAccountAndPattern(
            "account-1",
            "CREDIT|NEFT/IN#/ABC LTD"
        );
        const debit = await store.findByAccountAndPattern(
            "account-1",
            "DEBIT|NEFT/IN#/ABC LTD"
        );

        expect(credit?.categoryId).toBe("cat-sales");
        expect(debit?.categoryId).toBe("cat-rent");
    });

    it("a category rejected by the existing Income/Expense mapping check fails only that row", async () => {
        const { service, getBatch } = makeService(async request => {
            if (request.categoryId === "cat-locked") {
                throw new Error(
                    "This category is mapped to Income for the selected account. Change the transaction type or choose a different category."
                );
            }

            return "txn";
        });

        await service.executeCandidates("batch-1", [
            row(1, { categoryId: "cat-locked" }),
            row(2, { description: "OTHER PAYEE NARRATION" }),
        ]);

        expect(getBatch().failedRows).toBe(1);
        expect(getBatch().importedRows).toBe(1);
    });

    it("with the preview baselines (as ImportsPage passes them), only the genuinely corrected row writes a rule", async () => {
        const { service, store } = makeService(async () => "txn");
        await store.upsert("account-1", "CREDIT|NEFT/IN#/ABC LTD", "ABC Limited", null, null, "cat-sales");
        const upsert = vi.spyOn(store, "upsert");

        // Rows 1-2 (Credit) arrive with the learned rule applied; row 3
        // (Debit) is then corrected by the user in the preview.
        const { candidates: previewed } = await enrichCandidatesWithLearnedRulesDetailed(
            "account-1",
            [statement[0], statement[1], statement[2]],
            store
        );
        const finals = applyPreviewOverrides(
            previewed,
            applyCategoryToMatchingRows(previewed, createEmptyPreviewOverrides(), 3, "cat-rent")
        );

        await service.executeCandidates(
            "batch-1",
            finals,
            null,
            undefined,
            new Map(previewed.map(candidate => [candidate.rowNumber, candidate]))
        );

        expect(upsert.mock.calls.map(call => [call[1], call[5]])).toEqual([
            ["DEBIT|NEFT/IN#/ABC LTD", "cat-rent"],
        ]);
        expect(store.saved.get("account-1::CREDIT|NEFT/IN#/ABC LTD")).toEqual({
            payee: "ABC Limited",
            categoryId: "cat-sales",
        });
    });
});

describe("Category Scope is optional - the Import succeeds in every category/scope combination", () => {
    // Personal / Business / Personal + Business categories (existing
    // finance_scope data); the scope only ever narrows the dropdown.
    const scoped: Category[] = [
        category({ id: "cat-home", name: "Home", categoryType: "EXPENSE", financeScope: "PERSONAL" }),
        category({ id: "cat-hosting", name: "Hosting", categoryType: "EXPENSE", financeScope: "BUSINESS" }),
        category({ id: "cat-fees", name: "Fees", categoryType: "EXPENSE", financeScope: "BOTH" }),
    ];

    function makeImport() {
        const created: Array<Record<string, unknown>> = [];
        let batch: ImportBatch = {
            id: "batch-1", accountId: "account-1", importType: "BANK_CSV", sourceFileName: "s.csv", status: "PENDING",
            totalRows: 0, importedRows: 0, duplicateRows: 0, failedRows: 0, createdAt: "", updatedAt: "",
        };
        const rows = new Map<string, ImportRow>();
        const service = new ImportService();
        Object.defineProperty(service, "batchRepository", {
            value: {
                async getById() { return batch; },
                async update(request: Partial<ImportBatch>) { batch = { ...batch, ...request }; },
            },
        });
        Object.defineProperty(service, "rowRepository", {
            value: {
                async getByBatchId() { return [...rows.values()]; },
                async create(r: ImportRow) { rows.set(r.id, r); return r; },
                async update(request: Partial<ImportRow> & { id: string }) {
                    const existing = rows.get(request.id);
                    if (existing) rows.set(request.id, { ...existing, ...request });
                },
            },
        });
        Object.defineProperty(service, "transactionRepository", { value: { async findDuplicate() { return null; } } });
        Object.defineProperty(service, "transactionService", {
            value: { async create(request: Record<string, unknown>) { created.push(request); return `txn-${created.length}`; } },
        });
        Object.defineProperty(service, "counterpartyRuleRepository", { value: createRuleStore() });

        return { service, created, getBatch: () => batch };
    }

    // The page's pre-import check for a ready, error-free preview - it has
    // no scope/category input, so every scenario below passes it.
    const pageAllowsImport = () =>
        resolveImportBlockingError({ hasAccount: true, hasFile: true, hasPreview: true, errorRows: 0, readyRows: 4 }) === null;

    async function importRows(rows: NormalizedTransactionCandidate[], scope: "PERSONAL" | "BUSINESS" | null) {
        const before = structuredClone(scoped);
        const affected = rowsWithCategoryOutsideScope(rows, scoped, scope);
        expect(pageAllowsImport()).toBe(true);

        const { service, created, getBatch } = makeImport();
        await service.executeCandidates("batch-1", rows);

        expect(getBatch()).toMatchObject({ importedRows: rows.length, failedRows: 0 });
        expect(scoped).toEqual(before); // category definitions untouched
        return { categoryIds: created.map(c => c.categoryId), affected };
    }

    const r = (n: number, categoryId: string | null = null) =>
        row(n, { description: `NEFT/OUT/${n}/PAYEE ${String.fromCharCode(64 + n)} LTD`, categoryId });

    it("no scope + all Uncategorized -> imports, all Uncategorized", async () => {
        const { categoryIds } = await importRows([r(1), r(2), r(3), r(4)], null);
        expect(categoryIds).toEqual([null, null, null, null]);
    });

    it("no scope + manually selected categories -> imports with them", async () => {
        const base = [r(1), r(2), r(3), r(4)];
        let overrides = applyCategoryToMatchingRows(base, createEmptyPreviewOverrides(), 1, "cat-home");
        overrides = applyCategoryToMatchingRows(base, overrides, 2, "cat-hosting");
        const { categoryIds } = await importRows(applyPreviewOverrides(base, overrides), null);
        expect(categoryIds).toEqual(["cat-home", "cat-hosting", null, null]);
    });

    it("no scope + learned categories -> imports with the learned categories", async () => {
        const store = createRuleStore();
        const base = [r(1), r(2)];
        await store.upsert("account-1", learningKeyForCandidate(base[0])!, "Home Payee", null, null, "cat-home");
        await store.upsert("account-1", learningKeyForCandidate(base[1])!, "Host Payee", null, null, "cat-hosting");
        const { candidates } = await enrichCandidatesWithLearnedRulesDetailed("account-1", base, store);

        const { categoryIds } = await importRows(candidates, null);
        expect(categoryIds).toEqual(["cat-home", "cat-hosting"]);
    });

    it("no scope + mixed Uncategorized / selected / learned -> imports each as shown", async () => {
        const store = createRuleStore();
        const base = [r(1), r(2), r(3)];
        await store.upsert("account-1", learningKeyForCandidate(base[0])!, "Home Payee", null, null, "cat-home");
        const { candidates } = await enrichCandidatesWithLearnedRulesDetailed("account-1", base, store);
        const finals = applyPreviewOverrides(candidates, applyCategoryToMatchingRows(candidates, createEmptyPreviewOverrides(), 2, "cat-fees"));

        const { categoryIds } = await importRows(finals, null);
        expect(categoryIds).toEqual(["cat-home", "cat-fees", null]);
    });

    it("Personal scope + valid categories -> imports", async () => {
        const { categoryIds, affected } = await importRows([r(1, "cat-home"), r(2, "cat-fees"), r(3)], "PERSONAL");
        expect(affected).toEqual([]);
        expect(categoryIds).toEqual(["cat-home", "cat-fees", null]);
    });

    it("Business scope + valid categories -> imports", async () => {
        const { categoryIds, affected } = await importRows([r(1, "cat-hosting"), r(2, "cat-fees"), r(3)], "BUSINESS");
        expect(affected).toEqual([]);
        expect(categoryIds).toEqual(["cat-hosting", "cat-fees", null]);
    });

    it("Personal / Business scope + out-of-scope existing categories -> still imports, categories unchanged", async () => {
        const business = await importRows([r(1, "cat-home"), r(2, "cat-hosting")], "BUSINESS");
        expect(business.affected).toEqual([1]); // listed for review only
        expect(business.categoryIds).toEqual(["cat-home", "cat-hosting"]);

        const personal = await importRows([r(1, "cat-home"), r(2, "cat-hosting")], "PERSONAL");
        expect(personal.affected).toEqual([2]);
        expect(personal.categoryIds).toEqual(["cat-home", "cat-hosting"]);
    });

    it("an out-of-scope category is shown as unavailable - not silently replaced", () => {
        const options = resolveImportCategoryOptions({ categories: scoped, mappings: [], account, direction: "expense", scope: "PERSONAL" });
        expect(withRowCategory(options, "cat-hosting", scoped, false)[0]).toEqual({ id: "cat-hosting", name: "Hosting (unavailable)", unavailable: true });
    });
});

describe("counterparty_rules.category_id (migration 039) with the real repository SQL", () => {
    function openDb(): DatabaseSync {
        const db = new DatabaseSync(":memory:");

        db.exec("CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL)");
        db.exec("INSERT INTO accounts (id, name) VALUES ('account-1', 'Current')");

        for (const migration of [
            CounterpartyRulesMigration,
            CounterpartyRulesAccountScopeMigration,
            CounterpartyRulesTypeNotesMigration,
        ]) {
            for (const statement of migration.sql.split(";").map(s => s.trim()).filter(Boolean)) {
                db.exec(statement);
            }
        }

        return db;
    }

    it("is migration 39, adds one nullable column, and leaves existing rules intact", () => {
        const db = openDb();

        db.exec(
            "INSERT INTO counterparty_rules (id, account_id, pattern, counterparty) VALUES ('r1', 'account-1', 'DEBIT|X', 'Old Payee')"
        );
        db.exec(CounterpartyRulesCategoryMigration.sql);

        expect(CounterpartyRulesCategoryMigration.version).toBe(39);
        expect(
            db.prepare("SELECT counterparty, category_id FROM counterparty_rules WHERE id = 'r1'").get()
        ).toEqual({ counterparty: "Old Payee", category_id: null });
    });

    it("upsert saves the category id, and a later null never erases it", async () => {
        const db = openDb();

        db.exec(CounterpartyRulesCategoryMigration.sql);
        sqlite.db = db;

        try {
            const repository = new CounterpartyRuleRepository();

            await repository.upsert("account-1", "CREDIT|ABC", "ABC Ltd", null, null, "cat-sales");
            await repository.upsert("account-1", "CREDIT|ABC", "ABC Ltd", null, null, null);
            await repository.upsert("account-1", "DEBIT|ABC", "ABC Ltd", null, null, "cat-rent");

            expect((await repository.findByAccountAndPattern("account-1", "CREDIT|ABC"))?.categoryId).toBe("cat-sales");
            expect((await repository.findByAccountAndPattern("account-1", "DEBIT|ABC"))?.categoryId).toBe("cat-rent");
        } finally {
            sqlite.db = null;
            db.close();
        }
    });
});
