import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import type { NormalizedTransactionCandidate } from "@financeos/import-engine";

import {
    applyCategoryToMatchingRows,
    applyNotesToMatchingRows,
    applyPayeeToMatchingRows,
    applyPreviewOverrides,
    applySelfLearningToMatchingRows,
    applyTransactionTypeToMatchingRows,
    countImportProgress,
    createEmptyPreviewOverrides,
    deriveSessionLearnedRowNumbers,
    reuseUnchangedCandidates,
    type ImportProgressCounts,
    type PreviewOverrides,
} from "./ImportsPage";
import { ImportProgressCounters } from "./ImportProgressCounters";
import { toggleBalanceSkip } from "./importBalanceReview";

// ---------------------------------------------------------------------
// Import Preview progress counters (GREEN learned / BLUE manual of
// remaining / BLACK total processed). Driven through the page's real
// derivation - the same override/propagation functions ImportsPage uses -
// so these reflect exactly what the counters show.
// ---------------------------------------------------------------------

// Letter-only merchant names: the learning pattern ignores digits.
function merchant(i: number): string {
    return (
        String.fromCharCode(65 + Math.floor(i / 676) % 26) +
        String.fromCharCode(65 + Math.floor(i / 26) % 26) +
        String.fromCharCode(65 + (i % 26))
    );
}

function row(
    rowNumber: number,
    merchantIndex: number,
    type: "income" | "expense" = "expense"
): NormalizedTransactionCandidate {
    return {
        rowNumber,
        transactionDate: "2026-08-01",
        payee: `SHOP${merchant(merchantIndex)}`,
        description: `UPI/DR/${4100000 + rowNumber}/SHOP${merchant(merchantIndex)}/YBL`,
        amount: 100 + rowNumber,
        type,
        referenceNumber: null,
        externalTransactionId: null,
        transactionType: null,
        balance: null,
        branch: null,
        counterparty: null,
        notes: null,
        categoryId: null,
        rawData: {},
    };
}

interface State {
    base: NormalizedTransactionCandidate[];
    matched: ReadonlySet<number>;
    overrides: PreviewOverrides;
    disabled: Map<number, boolean>;
}

// ImportsPage's derivation, in the same order.
function counts(state: State): ImportProgressCounts {
    const candidates = applyPreviewOverrides(state.base, state.overrides);
    const session = deriveSessionLearnedRowNumbers(
        candidates,
        state.overrides,
        state.matched
    );

    return countImportProgress(
        state.base,
        state.matched,
        session,
        state.disabled,
        state.overrides
    );
}

function state(
    base: NormalizedTransactionCandidate[],
    matched: Iterable<number> = []
): State {
    return {
        base,
        matched: new Set(matched),
        overrides: createEmptyPreviewOverrides(),
        disabled: new Map(),
    };
}

// The requested example: 520 rows, 300 learned, 220 each unique.
function example(): State {
    const base = Array.from({ length: 520 }, (_, i) => row(i + 1, i));

    return state(
        base,
        base.slice(0, 300).map(candidate => candidate.rowNumber)
    );
}

describe("progress counters - basic states", () => {
    it("all learned rows", () => {
        const base = Array.from({ length: 5 }, (_, i) => row(i + 1, i));

        expect(counts(state(base, [1, 2, 3, 4, 5]))).toEqual({
            learned: 5,
            manual: 0,
            remaining: 0,
            processed: 5,
            total: 5,
        });
    });

    it("no learned rows", () => {
        const base = Array.from({ length: 5 }, (_, i) => row(i + 1, i));

        expect(counts(state(base))).toEqual({
            learned: 0,
            manual: 0,
            remaining: 5,
            processed: 0,
            total: 5,
        });
    });

    it("mixture of learned and unprocessed rows (the 520-row example, initially)", () => {
        expect(counts(example())).toEqual({
            learned: 300,
            manual: 0,
            remaining: 220,
            processed: 300,
            total: 520,
        });
    });

    it("an empty preview", () => {
        expect(counts(state([]))).toEqual({
            learned: 0,
            manual: 0,
            remaining: 0,
            processed: 0,
            total: 0,
        });
    });
});

describe("progress counters - manual processing", () => {
    it("manual processing increments blue: 50 rows -> 300 / 50/170 / 350", () => {
        const s = example();

        for (let rowNumber = 301; rowNumber <= 350; rowNumber += 1) {
            s.overrides = applyCategoryToMatchingRows(
                s.base,
                s.overrides,
                rowNumber,
                "cat-groceries"
            );
        }

        expect(counts(s)).toEqual({
            learned: 300,
            manual: 50,
            remaining: 170,
            processed: 350,
            total: 520,
        });
    });

    it("final processed total equals Rows once every row is done: 300 / 220/0 / 520", () => {
        const s = example();

        for (let rowNumber = 301; rowNumber <= 520; rowNumber += 1) {
            s.overrides = applyPayeeToMatchingRows(
                s.base,
                s.overrides,
                rowNumber,
                `Vendor ${rowNumber}`
            );
        }

        const result = counts(s);

        expect(result).toEqual({
            learned: 300,
            manual: 220,
            remaining: 0,
            processed: 520,
            total: 520,
        });
        expect(result.processed).toBe(s.base.length);
    });

    it("each kind of manual edit counts (Payee, Type, Notes, Category, balance skip)", () => {
        const base = Array.from({ length: 6 }, (_, i) => row(i + 1, i));
        const s = state(base);

        s.overrides = applyPayeeToMatchingRows(base, s.overrides, 1, "A");
        s.overrides = applyTransactionTypeToMatchingRows(base, s.overrides, 2, "UPI");
        s.overrides = applyNotesToMatchingRows(base, s.overrides, 3, "note");
        s.overrides = applyCategoryToMatchingRows(base, s.overrides, 4, "cat-1");
        s.overrides = toggleBalanceSkip(s.overrides, 5);

        expect(counts(s)).toMatchObject({
            manual: 5,
            remaining: 1,
            processed: 5,
        });
    });

    it("undoing an edit back to the original value un-counts the row", () => {
        const base = [row(1, 0), row(2, 1)];
        const s = state(base);

        s.overrides = applyPayeeToMatchingRows(base, s.overrides, 1, "Renamed");
        expect(counts(s).manual).toBe(1);

        s.overrides = applyPayeeToMatchingRows(
            base,
            s.overrides,
            1,
            base[0]!.payee
        );
        expect(counts(s)).toMatchObject({ manual: 0, remaining: 2 });
    });
});

describe("progress counters - learned rows are never blue", () => {
    it("editing a learned row keeps it green only (never counted twice)", () => {
        const base = [row(1, 0), row(2, 1), row(3, 2)];
        const s = state(base, [1]);

        s.overrides = applyPayeeToMatchingRows(base, s.overrides, 1, "Edited");
        s.overrides = applyCategoryToMatchingRows(base, s.overrides, 1, "cat-9");

        expect(counts(s)).toEqual({
            learned: 1,
            manual: 0,
            remaining: 2,
            processed: 1,
            total: 3,
        });
    });

    it("a manually selected category alone never makes a row green", () => {
        const base = [row(1, 0), row(2, 1)];
        const s = state(base);

        s.overrides = applyCategoryToMatchingRows(base, s.overrides, 2, "cat-3");

        expect(counts(s)).toMatchObject({ learned: 0, manual: 1 });
    });

    it("turning Self-Learning off for this import doesn't remove the applied learned values, so the row stays learned", () => {
        const base = [row(1, 0), row(2, 1)];
        const s = state(base, [1]);

        s.disabled = applySelfLearningToMatchingRows(base, s.disabled, 1, true);

        expect(counts(s)).toMatchObject({ learned: 1, manual: 0 });
    });
});

describe("progress counters - latest-edit propagation", () => {
    // 4 rows of one recurring merchant (debit), 1 credit row of the same
    // merchant, and 1 unrelated row.
    const base = [
        row(1, 7),
        row(2, 7),
        row(3, 7),
        row(4, 7),
        row(5, 7, "income"),
        row(6, 8),
    ];

    it("an edit propagated to matching rows counts every row it reached", () => {
        const s = state(base);

        s.overrides = applyPayeeToMatchingRows(base, s.overrides, 2, "Grocer");

        // Rows 1-4 (same pattern + direction); not the credit row 5, not 6.
        expect(counts(s)).toMatchObject({
            manual: 4,
            remaining: 2,
            processed: 4,
        });
    });

    it("a later edit from another matching row keeps the same group counted once", () => {
        const s = state(base);

        s.overrides = applyPayeeToMatchingRows(base, s.overrides, 2, "Grocer");
        s.overrides = applyPayeeToMatchingRows(base, s.overrides, 4, "Grocer Ltd");

        expect(counts(s)).toMatchObject({ manual: 4, processed: 4 });
        // Latest edit wins across the group (existing behaviour preserved).
        const final = applyPreviewOverrides(base, s.overrides);
        expect(final.slice(0, 4).map(c => c.payee)).toEqual([
            "Grocer Ltd",
            "Grocer Ltd",
            "Grocer Ltd",
            "Grocer Ltd",
        ]);
    });

    it("a learned row inside a propagated group stays green, not blue", () => {
        const s = state(base, [3]);

        s.overrides = applyCategoryToMatchingRows(base, s.overrides, 1, "cat-5");

        expect(counts(s)).toEqual({
            learned: 1,
            manual: 3,
            remaining: 2,
            processed: 4,
            total: 6,
        });
    });
});

describe("progress counters - rendering", () => {
    const render = (c: ImportProgressCounts) =>
        renderToStaticMarkup(
            createElement(ImportProgressCounters, { counts: c })
        );

    it("shows learned, manual/remaining and total processed of Rows", () => {
        const html = render({
            learned: 300,
            manual: 50,
            remaining: 170,
            processed: 350,
            total: 520,
        });

        expect(html).toContain('aria-label="300 rows learned"');
        expect(html).toContain(
            'aria-label="50 rows manually processed, 170 remaining"'
        );
        expect(html).toContain('aria-label="350 of 520 rows processed"');
        expect(html).toContain("Processed of 520");
        expect(html).toContain(">Learned<");
        expect(html).toContain(">Manual / Left<");
        // Same pill + outlined check-circle as the other two, in black.
        expect(html).toContain(
            'class="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-900"'
        );
        expect(html).toContain("lucide-circle-check text-slate-900");
        expect(html).not.toContain("border-slate-900");
        expect(html).not.toContain("fill-slate-900");
        // All three icons share size and shape.
        expect(html.match(/lucide-circle-check/g)).toHaveLength(3);
        expect(html.match(/width="15" height="15"/g)).toHaveLength(3);
    });

    it("keeps the same light pill once everything is processed (never solid black)", () => {
        const html = render({
            learned: 300,
            manual: 220,
            remaining: 0,
            processed: 520,
            total: 520,
        });

        expect(html).toContain("rounded-full bg-slate-100");
        expect(html).not.toContain("bg-slate-900");
        expect(html).toContain("Processed of 520");
    });
});

describe("progress counters - performance", () => {
    function large(n: number): State {
        const base = Array.from({ length: n }, (_, i) =>
            row(i + 1, i % 400, i % 3 === 0 ? "income" : "expense")
        );

        return state(
            base,
            base.filter((_, i) => i % 2 === 0).map(c => c.rowNumber)
        );
    }

    it.each([5000, 10000])(
        "%i rows: recomputing after a propagated edit is fast and never changes any row object",
        n => {
            const s = large(n);
            const before = counts(s);
            const previousCandidates = applyPreviewOverrides(
                s.base,
                s.overrides
            );

            s.overrides = applyPayeeToMatchingRows(
                s.base,
                s.overrides,
                2,
                "Renamed"
            );

            const started = performance.now();
            const after = counts(s);
            const elapsed = performance.now() - started;

            expect(after.manual).toBeGreaterThan(before.manual);
            expect(after.learned).toBe(before.learned);
            expect(after.processed).toBe(after.learned + after.manual);
            expect(after.learned + after.manual + after.remaining).toBe(n);
            expect(elapsed).toBeLessThan(250);

            // The counters are derived next to - not inside - the rows:
            // only the rows the edit actually changed get new objects.
            const reused = reuseUnchangedCandidates(
                applyPreviewOverrides(s.base, s.overrides),
                previousCandidates
            );
            const changed = reused.filter(
                (candidate, index) => candidate !== previousCandidates[index]
            ).length;

            expect(changed).toBeLessThan(n / 100);
        }
    );
});

describe("progress counters - preview header layout", () => {
    const page = readFileSync(
        path.resolve(__dirname, "ImportsPage.tsx"),
        "utf8"
    );

    const header = page.slice(
        page.indexOf('data-testid="import-preview-header"'),
        page.indexOf("categoryScope && categoryScopeAffectedRows.length > 0")
    );

    it("puts the counters (left) and Category Scope (right) on one wrapping header row", () => {
        expect(header).toContain(
            'className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3"'
        );
        expect(header.indexOf("<ImportProgressCounters")).toBeGreaterThan(-1);
        expect(header.indexOf("<ImportProgressCounters")).toBeLessThan(
            header.indexOf('data-testid="import-category-scope"')
        );
        expect(header).toContain(
            'className="ml-auto flex flex-row flex-nowrap items-center gap-2 whitespace-nowrap"'
        );
    });

    describe("Category Scope group is one horizontal line", () => {
        const groupStart = header.indexOf(
            'data-testid="import-category-scope"'
        );
        // The group's opening tag, and everything inside it.
        const groupTag = header.slice(
            groupStart,
            header.indexOf(">", groupStart)
        );
        const group = header.slice(groupStart);
        const groupClass =
            groupTag.match(/className="([^"]+)"/)?.[1] ?? "";

        it("1. the Category Scope label and the Personal button are in the same group container", () => {
            expect(groupStart).toBeGreaterThan(-1);
            expect(group).toContain('id="import-category-scope-label"');
            expect(group).toContain("Category Scope");
            expect(group).not.toContain("(Optional)");
            expect(group).toContain('role="radiogroup"');
            expect(group).toContain('"PERSONAL"');
            // Label first, then the buttons.
            expect(group.indexOf('id="import-category-scope-label"')).toBeLessThan(
                group.indexOf('role="radiogroup"')
            );
        });

        it("2. the Business button is in the same group", () => {
            expect(group).toContain('(["PERSONAL", "BUSINESS"] as const).map(scope => (');
            expect(
                group.indexOf('"BUSINESS"')
            ).toBeGreaterThan(group.indexOf('role="radiogroup"'));
        });

        it("3. the group lays out horizontally, vertically centred, and never wraps internally", () => {
            const classes = groupClass.split(/\s+/);

            expect(classes).toEqual(
                expect.arrayContaining([
                    "flex",
                    "flex-row",
                    "flex-nowrap",
                    "items-center",
                    "whitespace-nowrap",
                    // Still right-aligned in the header row.
                    "ml-auto",
                ])
            );

            const radiogroupClass =
                group
                    .slice(group.indexOf('role="radiogroup"'))
                    .match(/className="([^"]+)"/)?.[1] ?? "";

            expect(radiogroupClass.split(/\s+/)).toContain("inline-flex");
        });

        it("4. nothing stacks the label and buttons vertically", () => {
            expect(groupClass).not.toMatch(/flex-col|flex-wrap(?!-)|\bblock\b|\bgrid\b/);
            expect(group).not.toContain("flex-col");
        });

        it("keeps the compact 28px buttons and their active-state styling", () => {
            expect(group).toContain(
                '"rounded-full bg-white px-3 py-px text-sm font-semibold text-slate-900 shadow-sm"'
            );
            expect(group).toContain(
                '"rounded-full px-3 py-px text-sm font-medium text-slate-500 hover:text-slate-800 disabled:cursor-not-allowed"'
            );
            expect(group).toContain(
                'className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-0.5"'
            );
        });
    });

    it("keeps a compact Category Scope label and the Personal/Business selector in the right-hand block, with no helper text", () => {
        const scope = header.slice(
            header.indexOf('data-testid="import-category-scope"')
        );

        expect(scope).toContain("Category Scope");
        expect(scope).not.toContain("(Optional)");
        expect(scope).toContain('role="radiogroup"');
        expect(scope).toContain("onClick={() => setCategoryScope(scope)}");
        // Buttons sized like the counter pills (28px: py-px + p-0.5 + border).
        expect(scope).toContain("rounded-full bg-white px-3 py-px text-sm");
        expect(page).not.toContain("Optional - showing all categories");
        expect(page).not.toContain("categories (including Personal + Business)");
    });

    it("renders the counters only once, in the header", () => {
        expect(page.split("<ImportProgressCounters").length - 1).toBe(1);
    });
});
