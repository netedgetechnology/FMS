import { describe, expect, it } from "vitest";

import type { NormalizedTransactionCandidate } from "@financeos/import-engine";

import {
    applyNotesToMatchingRows,
    applyPayeeToMatchingRows,
    applySelfLearningToMatchingRows,
    applyTransactionTypeToMatchingRows,
    createEmptyPreviewOverrides,
    deriveSessionLearnedRowNumbers,
} from "../pages/ImportsPage";

import {
    enrichCandidatesWithLearnedRulesDetailed,
    learnRuleFromCandidate,
    type TransactionPatternRuleStore,
} from "./ImportService";
import {
    carriesLearnedValues,
    hasGenuineCorrection,
    isRawNarrationPayee,
    learningDirectionForType,
    learningKeyForCandidate,
    ruleAppliesLearnedValues,
} from "./learningKey";

// ---------------------------------------------------------------------
// Self-learning key: payee pattern + Credit/Debit
//
// Business rule: a correction learned on a Credit row applies only to
// matching Credit rows, and a Debit correction only to matching Debit
// rows - both in the current Import Preview (applyOverrideToMatchingRows
// via apply*ToMatchingRows) and in the persisted, account-scoped learned
// rules (enrichCandidatesWithLearnedRulesDetailed / learnRuleFromCandidate).
// Amount, date and reference number never affect the match.
// ---------------------------------------------------------------------

const ABC = "NEFT/IN#/ABC LTD";

function row(
    rowNumber: number,
    overrides: Partial<NormalizedTransactionCandidate> = {}
): NormalizedTransactionCandidate {
    return {
        rowNumber,
        transactionDate: "2026-08-01",
        payee: "",
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

const credit = (
    rowNumber: number,
    overrides: Partial<NormalizedTransactionCandidate> = {}
) => row(rowNumber, { type: "income", ...overrides });

const debit = (
    rowNumber: number,
    overrides: Partial<NormalizedTransactionCandidate> = {}
) => row(rowNumber, { type: "expense", ...overrides });

// The spec's example statement.
const statement = [
    credit(1, { amount: 10000 }),
    credit(2, { amount: 5000 }),
    debit(3, { amount: 2000 }),
    debit(4, { amount: 3000 }),
    credit(5, { amount: 7000 }),
];

function createRuleStore(): TransactionPatternRuleStore & {
    rules: Map<string, { counterparty: string; type: string | null; notes: string | null }>;
} {
    const rules = new Map<
        string,
        { counterparty: string; type: string | null; notes: string | null }
    >();

    return {
        rules,
        async findByAccountAndPattern(accountId, pattern) {
            const rule = rules.get(`${accountId}::${pattern}`);

            return rule
                ? {
                      id: pattern,
                      accountId,
                      pattern,
                      counterparty: rule.counterparty,
                      type: rule.type,
                      notes: rule.notes,
                      matchCount: 1,
                      createdAt: "",
                      updatedAt: "",
                  }
                : null;
        },
        async upsert(accountId, pattern, payee, type, notes) {
            rules.set(`${accountId}::${pattern}`, {
                counterparty: payee,
                type,
                notes,
            });
        },
    };
}

describe("learningKeyForCandidate - the key itself", () => {
    it("maps income to CREDIT, expense to DEBIT; transfer/unknown stay separate", () => {
        expect(learningDirectionForType("income")).toBe("CREDIT");
        expect(learningDirectionForType("expense")).toBe("DEBIT");
        expect(learningDirectionForType("transfer")).toBe("TRANSFER");
        expect(learningDirectionForType(null)).toBe("UNKNOWN");
    });

    it("is the normalized description pattern plus direction", () => {
        expect(learningKeyForCandidate(credit(1))).toBe(`CREDIT|${ABC}`);
        expect(learningKeyForCandidate(debit(1))).toBe(`DEBIT|${ABC}`);
    });

    it("1-4. same payee: Credit matches Credit, Debit matches Debit, never across", () => {
        expect(learningKeyForCandidate(credit(1))).toBe(
            learningKeyForCandidate(credit(2))
        );
        expect(learningKeyForCandidate(debit(3))).toBe(
            learningKeyForCandidate(debit(4))
        );
        expect(learningKeyForCandidate(credit(1))).not.toBe(
            learningKeyForCandidate(debit(3))
        );
        expect(learningKeyForCandidate(debit(3))).not.toBe(
            learningKeyForCandidate(credit(1))
        );
    });

    it("5. different payees in the same direction do not match", () => {
        expect(
            learningKeyForCandidate(
                credit(1, { description: "NEFT/IN4262/XYZ TRADERS" })
            )
        ).not.toBe(learningKeyForCandidate(credit(2)));
    });

    it("6-8. amount, date and reference number never affect the key", () => {
        const base = credit(1, {
            amount: 10,
            transactionDate: "2026-01-01",
            referenceNumber: "REF-1",
        });
        const other = credit(2, {
            amount: 99999,
            transactionDate: "2027-12-31",
            referenceNumber: "UTR-XYZ-2",
        });

        expect(learningKeyForCandidate(base)).toBe(
            learningKeyForCandidate(other)
        );
    });

    it("9. existing normalization still collapses digit / whitespace / case variations", () => {
        const a = credit(1, {
            description: "2026-07-01 neft/IN42621556482010/ABC   LTD",
        });
        const b = credit(2, {
            description: "2026-08-01  NEFT/IN999/abc ltd",
        });

        expect(learningKeyForCandidate(a)).toBe(
            learningKeyForCandidate(b)
        );
        expect(learningKeyForCandidate(a)).toBe(
            "CREDIT|#-#-# NEFT/IN#/ABC LTD"
        );
    });

    it("a row with no usable description still has no key", () => {
        expect(learningKeyForCandidate(credit(1, { description: "" }))).toBeNull();
        expect(learningKeyForCandidate(credit(1, { description: "ATM" }))).toBeNull();
    });
});

describe("Import Preview propagation across rows respects Credit/Debit", () => {
    it("learning Row 1 (Credit) propagates only to Rows 2 and 5 (Credit), never 3 or 4 (Debit)", () => {
        const result = applyPayeeToMatchingRows(
            statement,
            createEmptyPreviewOverrides(),
            1,
            "ABC Ltd"
        );

        expect([...result.payee.keys()].sort()).toEqual([1, 2, 5]);
        expect(result.payee.has(3)).toBe(false);
        expect(result.payee.has(4)).toBe(false);
    });

    it("learning Row 3 (Debit) propagates only to Row 4 (Debit), never the Credit rows", () => {
        const result = applyPayeeToMatchingRows(
            statement,
            createEmptyPreviewOverrides(),
            3,
            "ABC Ltd (supplier)"
        );

        expect([...result.payee.keys()].sort()).toEqual([3, 4]);
    });

    it("Credit and Debit corrections for the same payee coexist independently", () => {
        let overrides = applyPayeeToMatchingRows(
            statement,
            createEmptyPreviewOverrides(),
            1,
            "ABC Ltd - receipts"
        );

        overrides = applyPayeeToMatchingRows(
            statement,
            overrides,
            3,
            "ABC Ltd - payments"
        );

        expect(overrides.payee.get(1)).toBe("ABC Ltd - receipts");
        expect(overrides.payee.get(2)).toBe("ABC Ltd - receipts");
        expect(overrides.payee.get(5)).toBe("ABC Ltd - receipts");
        expect(overrides.payee.get(3)).toBe("ABC Ltd - payments");
        expect(overrides.payee.get(4)).toBe("ABC Ltd - payments");
    });

    it("Type, Notes and the Self-Learning opt-out follow the same direction rule", () => {
        const empty = createEmptyPreviewOverrides();

        expect(
            [
                ...applyTransactionTypeToMatchingRows(statement, empty, 1, "NEFT")
                    .transactionType.keys(),
            ].sort()
        ).toEqual([1, 2, 5]);

        expect(
            [
                ...applyNotesToMatchingRows(statement, empty, 4, "Supplier payment")
                    .notes.keys(),
            ].sort()
        ).toEqual([3, 4]);

        expect(
            [
                ...applySelfLearningToMatchingRows(statement, new Map(), 2, true)
                    .keys(),
            ].sort()
        ).toEqual([1, 2, 5]);
    });

    it("undoing a Credit correction only reverts the Credit rows it spread to", () => {
        let overrides = applyPayeeToMatchingRows(
            statement,
            createEmptyPreviewOverrides(),
            1,
            "ABC Ltd - receipts"
        );

        overrides = applyPayeeToMatchingRows(
            statement,
            overrides,
            3,
            "ABC Ltd - payments"
        );

        // Row 1's baseline payee is "" - typing it back is an undo.
        overrides = applyPayeeToMatchingRows(statement, overrides, 1, "");

        expect([...overrides.payee.keys()].sort()).toEqual([3, 4]);
    });

    it("6-8. rows differing only in amount, date and reference still propagate within a direction", () => {
        const rows = [
            credit(1, { amount: 10, transactionDate: "2026-01-01", referenceNumber: "A" }),
            credit(2, { amount: 99999, transactionDate: "2026-12-31", referenceNumber: "B" }),
        ];

        expect(
            applyPayeeToMatchingRows(rows, createEmptyPreviewOverrides(), 1, "ABC Ltd")
                .payee.get(2)
        ).toBe("ABC Ltd");
    });

    it("10. the session-learned (BLUE) indicator still follows propagation", () => {
        const overrides = applyPayeeToMatchingRows(
            statement,
            createEmptyPreviewOverrides(),
            1,
            "ABC Ltd"
        );
        const finalRows = statement.map(r =>
            overrides.payee.has(r.rowNumber)
                ? { ...r, payee: overrides.payee.get(r.rowNumber)! }
                : r
        );

        expect(
            [...deriveSessionLearnedRowNumbers(finalRows, overrides, new Set())].sort()
        ).toEqual([1, 2, 5]);
    });
});

describe("Persisted learned rules respect Credit/Debit", () => {
    it("a rule learned from a Credit row applies to Credit rows on the next import, never Debit rows", async () => {
        const store = createRuleStore();

        await learnRuleFromCandidate(
            "account-1",
            credit(1, { payee: "ABC Ltd", transactionType: "NEFT" }),
            store
        );

        const result = await enrichCandidatesWithLearnedRulesDetailed(
            "account-1",
            statement,
            store
        );

        expect([...result.matchedRowNumbers].sort()).toEqual([1, 2, 5]);
        expect(result.candidates[1].payee).toBe("ABC Ltd");
        expect(result.candidates[2].payee).toBe("");
        expect(result.candidates[3].payee).toBe("");
    });

    it("a rule learned from a Debit row applies only to Debit rows", async () => {
        const store = createRuleStore();

        await learnRuleFromCandidate(
            "account-1",
            debit(3, { payee: "ABC Ltd (supplier)" }),
            store
        );

        const result = await enrichCandidatesWithLearnedRulesDetailed(
            "account-1",
            statement,
            store
        );

        expect([...result.matchedRowNumbers].sort()).toEqual([3, 4]);
    });

    it("Credit and Debit rules for the same payee are stored separately and never overwrite each other", async () => {
        const store = createRuleStore();

        await learnRuleFromCandidate(
            "account-1",
            credit(1, { payee: "ABC Ltd - receipts" }),
            store
        );
        await learnRuleFromCandidate(
            "account-1",
            debit(3, { payee: "ABC Ltd - payments" }),
            store
        );

        expect(store.rules.size).toBe(2);

        const result = await enrichCandidatesWithLearnedRulesDetailed(
            "account-1",
            statement,
            store
        );

        expect(result.candidates.map(c => c.payee)).toEqual([
            "ABC Ltd - receipts",
            "ABC Ltd - receipts",
            "ABC Ltd - payments",
            "ABC Ltd - payments",
            "ABC Ltd - receipts",
        ]);
    });

    it("rules stay scoped to their account", async () => {
        const store = createRuleStore();

        await learnRuleFromCandidate(
            "account-1",
            credit(1, { payee: "ABC Ltd" }),
            store
        );

        const result = await enrichCandidatesWithLearnedRulesDetailed(
            "account-2",
            statement,
            store
        );

        expect(result.matchedRowNumbers.size).toBe(0);
    });
});

describe("what counts as a learned value", () => {
    const OWN = "NEFT/MB/AXOMB09202074155/KELIKA SPORTS/ICICI BANK LIMITED/Others-Transfer";
    const SIBLING = "NEFT/MB/AXOMB25902135240/KELIKA SPORTS/ICICI BANK LIMITED/Others-Transfer";

    it("a sibling narration differing only by reference number is still a raw narration", () => {
        expect(isRawNarrationPayee(SIBLING, OWN)).toBe(true);
        expect(isRawNarrationPayee(OWN, OWN)).toBe(true);
        expect(isRawNarrationPayee("", OWN)).toBe(true);
        expect(isRawNarrationPayee("Kelika Sports", OWN)).toBe(false);
    });

    it("a raw-only rule is not learned; a real Payee, Notes or Category is", () => {
        expect(carriesLearnedValues({ payee: SIBLING, description: OWN })).toBe(false);
        expect(carriesLearnedValues({ payee: "Kelika Sports", description: OWN })).toBe(true);
        expect(carriesLearnedValues({ payee: SIBLING, description: OWN, notes: "Rent" })).toBe(true);
        expect(carriesLearnedValues({ payee: SIBLING, description: OWN, categoryId: "cat-1" })).toBe(true);
    });

    it("a rule Type counts as learned only when it differs from the row's detected Type", () => {
        const row = { description: OWN, transactionType: "NEFT" };
        expect(ruleAppliesLearnedValues({ payee: SIBLING, transactionType: "NEFT" }, row)).toBe(false);
        expect(ruleAppliesLearnedValues({ payee: SIBLING, transactionType: null }, row)).toBe(false);
        expect(ruleAppliesLearnedValues({ payee: SIBLING, transactionType: "IMPS" }, row)).toBe(true);
    });

    it("a genuine correction is a new real Payee, Type, Notes or Category - never an unchanged row or a narration Payee", () => {
        const baseline = { payee: OWN, transactionType: "NEFT", notes: null, categoryId: null };
        const row = { ...baseline, description: OWN };

        expect(hasGenuineCorrection(row, baseline)).toBe(false);
        expect(hasGenuineCorrection({ ...row, payee: SIBLING }, baseline)).toBe(false);
        expect(hasGenuineCorrection({ ...row, payee: "Kelika Sports" }, baseline)).toBe(true);
        expect(hasGenuineCorrection({ ...row, transactionType: "IMPS" }, baseline)).toBe(true);
        expect(hasGenuineCorrection({ ...row, notes: "Rent" }, baseline)).toBe(true);
        expect(hasGenuineCorrection({ ...row, categoryId: "cat-1" }, baseline)).toBe(true);
        // A learned value merely re-applied (baseline already holds it) is not a correction.
        expect(hasGenuineCorrection({ ...row, payee: "Kelika Sports" }, { ...baseline, payee: "Kelika Sports" })).toBe(false);
    });
});
