import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import type { NormalizedTransactionCandidate } from "@financeos/import-engine";

import type { Category } from "@/modules/categories/types";

import { learningKeyForCandidate } from "../services/learningKey";

import {
    applyCategoryToMatchingRows,
    applyNotesToMatchingRows,
    applyPayeeToMatchingRows,
    applyPreviewOverrides,
    applySelfLearningToMatchingRows,
    applyTransactionTypeToMatchingRows,
    createEmptyPreviewOverrides,
    deriveSessionLearnedRowNumbers,
    resolveSelfLearningIndicator,
    reuseUnchangedCandidates,
    type PreviewOverrides,
} from "./ImportsPage";
import { resolveImportCategoryOptions } from "./importCategoryOptions";
import { ImportPreviewRow, type ImportPreviewRowProps } from "./ImportPreviewRow";

// ---------------------------------------------------------------------
// Import Preview scalability (5,000+ rows).
//
// Root cause this guards against: every keystroke re-rendered every
// preview row - each with a ~110-option Category <select> - so 5,000
// rows meant ~600,000 elements rebuilt per character typed (plus a new
// Intl.NumberFormat per row).
//
// No DOM test setup exists (vitest environment: "node"), so React's
// re-render decision is reproduced exactly: ImportPreviewRow is
// React.memo with the default shallow prop comparison, so a row
// re-renders iff one of its props changed identity/value. These tests run
// the page's real derivation (the same exported functions, in the same
// order ImportsPage uses them) and count rows whose props change after
// each kind of edit - it must be the rows the edit actually changed,
// never all N.
// ---------------------------------------------------------------------

const MERCHANTS = 200;

// Letter-only merchant names ("SHOPAA", "SHOPAB", ...): the learning
// pattern ignores digits, so numbered names would all collapse into one.
function merchant(i: number): string {
    const n = i % MERCHANTS;
    return `SHOP${String.fromCharCode(65 + Math.floor(n / 26))}${String.fromCharCode(65 + (n % 26))}`;
}

function makeCandidates(n: number): NormalizedTransactionCandidate[] {
    return Array.from({ length: n }, (_, i) => ({
        rowNumber: i + 2,
        transactionDate: "2026-08-01",
        payee: `Payee ${i % MERCHANTS}`,
        description: `UPI/DR/${4100000 + i}/${merchant(i)}/YBL/ORDER ${i}`,
        amount: 100 + i,
        type: i % 3 === 0 ? "income" : "expense",
        referenceNumber: null,
        externalTransactionId: null,
        transactionType: null,
        balance: null,
        branch: null,
        counterparty: null,
        notes: null,
        categoryId: null,
        rawData: {},
    }));
}

const categories: Category[] = Array.from({ length: 108 }, (_, i) => ({
    id: `cat-${i}`,
    parentId: null,
    name: `Category ${i}`,
    categoryType: i % 2 ? "EXPENSE" : "INCOME",
    financeScope: "PERSONAL",
    businessEntityId: null,
    description: null,
    isActive: true,
    createdAt: "",
    updatedAt: "",
}));

const optionsByDirection = {
    income: resolveImportCategoryOptions({ categories, mappings: [], account: null, direction: "income", scope: "PERSONAL" }),
    expense: resolveImportCategoryOptions({ categories, mappings: [], account: null, direction: "expense", scope: "PERSONAL" }),
    transfer: resolveImportCategoryOptions({ categories, mappings: [], account: null, direction: "transfer", scope: "PERSONAL" }),
    none: resolveImportCategoryOptions({ categories, mappings: [], account: null, direction: null, scope: "PERSONAL" }),
};

const noop = () => {};

// Stable, like ImportsPage's useCallback([]) handlers.
const handlers = {
    onToggleSelfLearning: noop,
    onPayeeCommit: noop,
    onTransactionTypeChange: noop,
    onCategoryChange: noop,
    onNotesCommit: noop,
    onViewDescription: noop,
};

interface PageState {
    base: NormalizedTransactionCandidate[];
    overrides: PreviewOverrides;
    disabled: Map<number, boolean>;
    matched: ReadonlySet<number>;
    previous: NormalizedTransactionCandidate[] | null;
}

// ImportsPage's render: previewCandidates (memoized + reused), session
// learning, and each ImportPreviewRow's props.
function renderProps(state: PageState): {
    candidates: NormalizedTransactionCandidate[];
    rows: ImportPreviewRowProps[];
} {
    const candidates = reuseUnchangedCandidates(
        applyPreviewOverrides(state.base, state.overrides),
        state.previous
    );
    const session = deriveSessionLearnedRowNumbers(
        candidates,
        state.overrides,
        state.matched
    );

    const rows = candidates.map((candidate, index) => {
        const indicator = resolveSelfLearningIndicator(
            candidate.rowNumber,
            state.matched,
            session,
            state.disabled
        );

        return {
            candidate,
            displayNumber: index + 1,
            hasErrors: false,
            isDuplicate: false,
            isTransfer: false,
            indicatorState: indicator.state,
            indicatorClickable: indicator.clickable,
            hasMatchedLearnedRule: indicator.hasMatchedLearnedRule,
            importing: false,
            directionCategoryOptions: optionsByDirection[candidate.type ?? "none"],
            categories,
            categoriesLoading: false,
           
            ...handlers,
        } satisfies ImportPreviewRowProps;
    });

    return { candidates, rows };
}

// React.memo's default comparison: shallow Object.is on every prop.
function rowsThatRerender(
    before: ImportPreviewRowProps[],
    after: ImportPreviewRowProps[]
): number[] {
    return after
        .filter((props, i) => {
            const prior = before[i] as unknown as Record<string, unknown>;
            const next = props as unknown as Record<string, unknown>;

            return Object.keys(next).some(key => !Object.is(prior[key], next[key]));
        })
        .map(props => props.candidate.rowNumber);
}

function setup(n: number) {
    const base = makeCandidates(n);
    const state: PageState = {
        base,
        overrides: createEmptyPreviewOverrides(),
        disabled: new Map(),
        matched: new Set(base.filter((_, i) => i % 4 === 0).map(c => c.rowNumber)),
        previous: null,
    };
    const first = renderProps(state);
    state.previous = first.candidates;

    return { base, state, first };
}

// Rows sharing the edited row's learning key (same pattern + direction).
function samePattern(base: NormalizedTransactionCandidate[], rowNumber: number): number[] {
    const key = learningKeyForCandidate(base.find(c => c.rowNumber === rowNumber)!);
    return base.filter(c => learningKeyForCandidate(c) === key).map(c => c.rowNumber);
}

describe.each([5000, 10000])("Import Preview with %i rows", n => {
    it("a Payee edit re-renders only the edited row and the rows it propagates to", () => {
        const { base, state, first } = setup(n);
        const edited = base[7].rowNumber;

        const started = performance.now();
        state.overrides = applyPayeeToMatchingRows(base, state.overrides, edited, "Swiggy");
        const second = renderProps(state);
        const elapsed = performance.now() - started;

        const rerendered = rowsThatRerender(first.rows, second.rows);
        const expected = samePattern(base, edited);

        expect(rerendered.sort((a, b) => a - b)).toEqual(expected);
        expect(rerendered.length).toBeLessThan(n / 100);
        expect(second.candidates.find(c => c.rowNumber === edited)?.payee).toBe("Swiggy");
        // The whole per-edit derivation is a handful of ms; a wide bound
        // keeps this stable on slow CI while still catching O(N^2).
        expect(elapsed).toBeLessThan(500);
    });

    it("a second, unrelated edit does not re-render rows changed by the first", () => {
        const { base, state } = setup(n);

        state.overrides = applyPayeeToMatchingRows(base, state.overrides, base[7].rowNumber, "Swiggy");
        const afterFirst = renderProps(state);
        state.previous = afterFirst.candidates;

        state.overrides = applyNotesToMatchingRows(base, state.overrides, base[11].rowNumber, "office lunch");
        const afterSecond = renderProps(state);

        expect(rowsThatRerender(afterFirst.rows, afterSecond.rows).sort((a, b) => a - b)).toEqual(
            samePattern(base, base[11].rowNumber)
        );
    });

    it("a Category change propagates only within the same pattern AND direction", () => {
        const { base, state, first } = setup(n);
        const edited = base[8].rowNumber; // expense

        state.overrides = applyCategoryToMatchingRows(base, state.overrides, edited, "cat-3");
        const second = renderProps(state);

        const rerendered = rowsThatRerender(first.rows, second.rows);

        expect(rerendered.sort((a, b) => a - b)).toEqual(samePattern(base, edited));
        for (const rowNumber of rerendered) {
            const candidate = second.candidates.find(c => c.rowNumber === rowNumber)!;
            expect(candidate.categoryId).toBe("cat-3");
            expect(candidate.type).toBe("expense");
        }
        // Same merchant but the other direction is untouched.
        const creditSameMerchant = base.find(
            c => c.type === "income" && c.description.includes(`/${merchant(8)}/`)
        );
        if (creditSameMerchant) {
            expect(rerendered).not.toContain(creditSameMerchant.rowNumber);
        }
    });

    it("a Transaction Type change re-renders only the matching rows", () => {
        const { base, state, first } = setup(n);
        const edited = base[9].rowNumber;

        state.overrides = applyTransactionTypeToMatchingRows(base, state.overrides, edited, "UPI");

        expect(rowsThatRerender(first.rows, renderProps(state).rows).sort((a, b) => a - b)).toEqual(
            samePattern(base, edited)
        );
    });

    it("toggling Self-Learning off re-renders only the rows whose indicator changes", () => {
        const { base, state, first } = setup(n);
        const toggled = base[0].rowNumber; // a matched (green) row

        state.disabled = applySelfLearningToMatchingRows(first.candidates, state.disabled, toggled, true);
        const rerendered = rowsThatRerender(first.rows, renderProps(state).rows);

        expect(rerendered).toContain(toggled);
        expect(rerendered.length).toBeLessThanOrEqual(samePattern(base, toggled).length);
    });

    it("an edit that changes nothing re-renders nothing", () => {
        const { state, first } = setup(n);

        // e.g. blurring a Payee field without typing: same overrides object.
        expect(rowsThatRerender(first.rows, renderProps(state).rows)).toEqual([]);
    });
});

describe("reuseUnchangedCandidates keeps values exactly", () => {
    it("returns the same values as applyPreviewOverrides, reusing unchanged objects", () => {
        const base = makeCandidates(500);
        let overrides = applyPayeeToMatchingRows(base, createEmptyPreviewOverrides(), base[3].rowNumber, "A");
        const first = applyPreviewOverrides(base, overrides);

        overrides = applyCategoryToMatchingRows(base, overrides, base[4].rowNumber, "cat-1");
        const fresh = applyPreviewOverrides(base, overrides);
        const reused = reuseUnchangedCandidates(fresh, first);

        expect(reused).toEqual(fresh);
        expect(reused.filter((c, i) => c !== first[i]).length).toBe(
            samePattern(base, base[4].rowNumber).length
        );
        expect(reuseUnchangedCandidates(applyPreviewOverrides(base, overrides), reused)).toBe(reused);
    });
});

describe("typing never touches the page (row-local drafts)", () => {
    const page = readFileSync(path.resolve(__dirname, "ImportsPage.tsx"), "utf8");
    const row = readFileSync(path.resolve(__dirname, "ImportPreviewRow.tsx"), "utf8");

    it("Payee/Notes keystrokes update only the row's own state; the page gets the value on blur", () => {
        expect(row).toContain("onChange={event => setPayeeDraft(event.target.value)}");
        expect(row).toContain("onChange={event => setNotesDraft(event.target.value)}");
        expect(row).toMatch(/onBlur=\{event => \{\s+onPayeeCommit\(\s+candidate\.rowNumber,\s+event\.target\.value\s+\);\s+setPayeeDraft\(null\);/);
        expect(row).toMatch(/onBlur=\{event => \{\s+onNotesCommit\(\s+candidate\.rowNumber,\s+event\.target\.value\s+\);\s+setNotesDraft\(null\);/);
        expect(row).toContain("export const ImportPreviewRow = memo(");
        expect(page).not.toMatch(/payeeDrafts|notesDrafts|setPayeeDrafts|setNotesDrafts/);
    });

    it("row handlers keep one identity (useCallback with no deps)", () => {
        for (const name of [
            "handleToggleSelfLearning",
            "handleTransactionTypeOverride",
            "handleCategoryOverride",
            "handlePayeeOverrideCommit",
            "handleNotesOverrideCommit",
        ]) {
            const start = page.indexOf(`const ${name} = useCallback(`);
            expect(start).toBeGreaterThan(-1);
            const body = page.slice(start, page.indexOf("}, []);", start));
            expect(body).not.toContain("previewCandidates,");
        }
        expect(page).toContain("const handleViewDescription = useCallback(");
    });

    it("no validation, duplicate detection, parsing or database call happens on an edit", () => {
        // Every edit handler only updates in-memory preview state.
        for (const name of [
            "handleTransactionTypeOverride",
            "handleCategoryOverride",
            "handlePayeeOverrideCommit",
            "handleNotesOverrideCommit",
            "handleToggleSelfLearning",
        ]) {
            const start = page.indexOf(`const ${name} = useCallback(`);
            const body = page.slice(start, page.indexOf("}, []);", start));

            expect(body).not.toMatch(/service\.|await |invoke|preview[A-Z]\w*\(|setPreview\(/);
        }
        // Validation errors / duplicates are read from the preview result,
        // per row, via O(1) lookups.
        expect(page).toContain("hasErrors={errorRowNumbers.has(");
        expect(page).toMatch(/preview\?\.duplicates\.has\(/);
        expect(page).not.toMatch(/previewErrors\.filter\(/);
    });

    it("rendering one row is independent of the dataset size", () => {
        const base = makeCandidates(5000);
        const one = (candidate: NormalizedTransactionCandidate) =>
            renderToStaticMarkup(
                createElement(
                    "table",
                    null,
                    createElement(
                        "tbody",
                        null,
                        createElement(ImportPreviewRow, {
                            candidate,
                            displayNumber: 1,
                            hasErrors: false,
                            isDuplicate: false,
                            isTransfer: false,
                            indicatorState: "blank",
                            indicatorClickable: false,
                            hasMatchedLearnedRule: false,
                            importing: false,
                            directionCategoryOptions: optionsByDirection.expense,
                            categories,
                            categoriesLoading: false,
                           
                            ...handlers,
                        })
                    )
                )
            );

        const html = one(base[4999]);

        // One row = one Category select's options + the Type select's.
        expect(html.match(/<option/g)?.length).toBeLessThan(200);
        expect(html).toContain('aria-label="Category"');
        expect(html).toContain("-₹5,099.00");
    });
});
