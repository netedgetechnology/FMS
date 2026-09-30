import { describe, expect, it } from "vitest";

import type { NormalizedTransactionCandidate } from "@financeos/import-engine";

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
    reuseUnchangedCandidates,
    type PreviewOverrides,
} from "./ImportsPage";

// ---------------------------------------------------------------------
// Self-learning propagation: ANY matching row can be the learning source.
//
// Regression: after one row's edit had propagated, every matching row
// held that value as an override, and propagation never overwrote an
// existing override - so editing a second matching row changed only
// that row. Now the latest committed edit, from whichever matching row,
// updates every row with the same learning key (normalized pattern +
// Credit/Debit direction).
// ---------------------------------------------------------------------

function paypal(
    rowNumber: number,
    type: "income" | "expense",
    overrides: Partial<NormalizedTransactionCandidate> = {}
): NormalizedTransactionCandidate {
    return {
        rowNumber,
        transactionDate: "2026-08-01",
        payee: `PAYPAL ${rowNumber}`,
        description: `NEFT/${type === "income" ? "CR" : "DR"}/${900000 + rowNumber}/PAYPAL PAYMENTS PRIVATE LIMITED/`,
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
        ...overrides,
    };
}

// Rows 1-4: PayPal CREDIT. Rows 11-14: PayPal DEBIT (same narration
// pattern, other direction). Row 20: unrelated.
const credit = [1, 2, 3, 4].map(n => paypal(n, "income"));
const debit = [11, 12, 13, 14].map(n => paypal(n, "expense"));
const other = paypal(20, "expense", {
    payee: "Swiggy",
    description: "UPI/DR/123456/SWIGGY FOOD ORDER/",
});
const base = [...credit, ...debit, other];

function payees(overrides: PreviewOverrides, rows: number[]): Record<number, string> {
    const final = applyPreviewOverrides(base, overrides);
    return Object.fromEntries(
        rows.map(n => [n, final.find(c => c.rowNumber === n)!.payee])
    );
}

const CREDIT = [1, 2, 3, 4];
const DEBIT = [11, 12, 13, 14];

describe("fixture sanity", () => {
    it("credit rows share one learning key, debit rows another", () => {
        const creditKeys = new Set(credit.map(learningKeyForCandidate));
        const debitKeys = new Set(debit.map(learningKeyForCandidate));

        expect(creditKeys.size).toBe(1);
        expect(debitKeys.size).toBe(1);
        expect([...creditKeys][0]).not.toBe([...debitKeys][0]);
        expect([...creditKeys][0]).toMatch(/^CREDIT\|/);
        expect([...debitKeys][0]).toMatch(/^DEBIT\|/);
    });
});

describe.each([
    ["CREDIT", CREDIT, DEBIT],
    ["DEBIT", DEBIT, CREDIT],
] as const)("PayPal %s: any matching row can be the learning source", (_label, rows, otherDirection) => {
    it.each(rows.map((row, index) => [index + 1, row]))(
        "editing matching row #%i (row %i) first updates every other matching row",
        (_i, edited) => {
            const overrides = applyPayeeToMatchingRows(
                base,
                createEmptyPreviewOverrides(),
                edited,
                "PayPal"
            );

            expect(Object.values(payees(overrides, [...rows]))).toEqual(
                rows.map(() => "PayPal")
            );
        }
    );

    it("sequential edits from different rows: the latest edit always wins for the whole group", () => {
        const [r1, r2, r3, r4] = rows;
        let overrides = createEmptyPreviewOverrides();

        overrides = applyPayeeToMatchingRows(base, overrides, r1, "A");
        expect(payees(overrides, [r1, r2, r3, r4])).toEqual({ [r1]: "A", [r2]: "A", [r3]: "A", [r4]: "A" });

        overrides = applyPayeeToMatchingRows(base, overrides, r3, "B");
        expect(payees(overrides, [r1, r2, r3, r4])).toEqual({ [r1]: "B", [r2]: "B", [r3]: "B", [r4]: "B" });

        overrides = applyPayeeToMatchingRows(base, overrides, r4, "C");
        expect(payees(overrides, [r1, r2, r3, r4])).toEqual({ [r1]: "C", [r2]: "C", [r3]: "C", [r4]: "C" });

        // The other direction and unrelated rows are never touched.
        for (const row of [...otherDirection, 20]) {
            expect(overrides.payee.has(row)).toBe(false);
        }
    });

    it("the same holds for Category, Type and Notes", () => {
        const [r1, , r3, r4] = rows;
        let overrides = createEmptyPreviewOverrides();

        overrides = applyCategoryToMatchingRows(base, overrides, r1, "cat-a");
        overrides = applyCategoryToMatchingRows(base, overrides, r3, "cat-b");
        overrides = applyTransactionTypeToMatchingRows(base, overrides, r1, "UPI");
        overrides = applyTransactionTypeToMatchingRows(base, overrides, r4, "NEFT");
        overrides = applyNotesToMatchingRows(base, overrides, r3, "first");
        overrides = applyNotesToMatchingRows(base, overrides, r1, "second");

        const final = applyPreviewOverrides(base, overrides);

        for (const row of rows) {
            expect(final.find(c => c.rowNumber === row)).toMatchObject({
                categoryId: "cat-b",
                transactionType: "NEFT",
                notes: "second",
            });
        }
        for (const row of otherDirection) {
            expect(final.find(c => c.rowNumber === row)).toMatchObject({
                categoryId: null,
                transactionType: null,
                notes: null,
            });
        }
    });
});

describe("a Credit edit never propagates to Debit rows (and vice versa)", () => {
    it("interleaved edits keep the two directions independent", () => {
        let overrides = createEmptyPreviewOverrides();

        overrides = applyPayeeToMatchingRows(base, overrides, 2, "PayPal Payout");
        overrides = applyPayeeToMatchingRows(base, overrides, 13, "PayPal Purchase");
        overrides = applyPayeeToMatchingRows(base, overrides, 4, "PayPal Refund");

        expect(payees(overrides, CREDIT)).toEqual({ 1: "PayPal Refund", 2: "PayPal Refund", 3: "PayPal Refund", 4: "PayPal Refund" });
        expect(payees(overrides, DEBIT)).toEqual({ 11: "PayPal Purchase", 12: "PayPal Purchase", 13: "PayPal Purchase", 14: "PayPal Purchase" });
        expect(payees(overrides, [20])).toEqual({ 20: "Swiggy" });
    });
});

describe("undo / revert still works", () => {
    it("reverting the edited row to its original value undoes the whole group", () => {
        let overrides = applyPayeeToMatchingRows(base, createEmptyPreviewOverrides(), 2, "PayPal");

        overrides = applyPayeeToMatchingRows(base, overrides, 2, "PAYPAL 2"); // row 2's original

        expect(overrides.payee.size).toBe(0);
        expect(payees(overrides, CREDIT)).toEqual({ 1: "PAYPAL 1", 2: "PAYPAL 2", 3: "PAYPAL 3", 4: "PAYPAL 4" });
    });

    it("after a later edit from another row, reverting THAT row undoes the group", () => {
        let overrides = createEmptyPreviewOverrides();

        overrides = applyPayeeToMatchingRows(base, overrides, 1, "A");
        overrides = applyPayeeToMatchingRows(base, overrides, 3, "B");
        overrides = applyPayeeToMatchingRows(base, overrides, 3, "PAYPAL 3"); // row 3's original

        expect(overrides.payee.size).toBe(0);
        expect(payees(overrides, CREDIT)).toEqual({ 1: "PAYPAL 1", 2: "PAYPAL 2", 3: "PAYPAL 3", 4: "PAYPAL 4" });
        expect(payees(overrides, DEBIT)).toEqual({ 11: "PAYPAL 11", 12: "PAYPAL 12", 13: "PAYPAL 13", 14: "PAYPAL 14" });
    });

    it("reverting a Category to the row's original category undoes the group", () => {
        let overrides = applyCategoryToMatchingRows(base, createEmptyPreviewOverrides(), 12, "cat-a");
        overrides = applyCategoryToMatchingRows(base, overrides, 12, ""); // original: none

        expect(overrides.categoryId.size).toBe(0);
    });
});

describe("the preview reflects every source row's edit", () => {
    it("every matching row gets a new row object (so the memoized row re-renders) and shows as session-learned", () => {
        let overrides = applyPayeeToMatchingRows(base, createEmptyPreviewOverrides(), 1, "A");
        const afterFirst = reuseUnchangedCandidates(applyPreviewOverrides(base, overrides), null);

        overrides = applyPayeeToMatchingRows(base, overrides, 3, "B");
        const afterSecond = reuseUnchangedCandidates(applyPreviewOverrides(base, overrides), afterFirst);

        const changed = afterSecond
            .filter((candidate, i) => candidate !== afterFirst[i])
            .map(candidate => candidate.rowNumber);

        expect(changed).toEqual(CREDIT);
        expect(
            [...deriveSessionLearnedRowNumbers(afterSecond, overrides, new Set())].sort((a, b) => a - b)
        ).toEqual(CREDIT);
        // What the actual Import receives (and learns from): value B.
        expect(afterSecond.filter(c => CREDIT.includes(c.rowNumber)).map(c => c.payee)).toEqual(["B", "B", "B", "B"]);
    });
});

describe("Self-Learning toggle keeps its own rule", () => {
    it("turning learning off never overrides a row the user explicitly re-enabled", () => {
        const result = applySelfLearningToMatchingRows(base, new Map([[2, false]]), 1, true);

        expect(result.get(1)).toBe(true);
        expect(result.get(2)).toBe(false);
        expect(result.get(3)).toBe(true);
    });
});
