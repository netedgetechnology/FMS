import { describe, expect, it } from "vitest";

import type { InterestRateHistoryEntry } from "../types/InterestRateHistory";
import {
    currentLoanRate,
    currentRateEntry,
    currentRateLabel,
    directRateEditRefusal,
    groupByLoan,
    resolveRateBaseline,
    scheduleGenerationRateIssue,
    upcomingEntries,
    withEffectiveUntil,
} from "./interestRateHistory";

// ---------------------------------------------------------------------
// Interest Rate History, Stage 3.1 - the one rule for the current rate,
// upcoming rates, a loan's baseline and direct rate edits. Synthetic
// entries for synthetic loans only.
// ---------------------------------------------------------------------

type Stored = Omit<InterestRateHistoryEntry, "effectiveUntil">;

const entry = (id: string, effectiveFrom: string, rate: number, change: Partial<Stored> = {}): Stored => ({
    id,
    loanId: "loan-1",
    effectiveFrom,
    rate,
    previousRate: null,
    rateType: "FLOATING",
    source: "MANUAL",
    reference: null,
    documentId: null,
    notes: null,
    appliedFromInstalment: null,
    createdAt: `${effectiveFrom}T00:00:00.000Z`,
    supersededBy: null,
    supersededAt: null,
    correctionReason: null,
    ...change,
});

// The stored loans.interest_rate is deliberately stale (9%) in these
// fixtures: for a loan with history it must never be read as current.
const LOAN = { interestRate: 9, rateType: "FIXED" as const };

const HISTORY = [
    entry("initial", "2026-01-10", 12, { source: "INITIAL" }),
    entry("mar", "2026-03-01", 13, { previousRate: 12 }),
    entry("may", "2026-05-01", 14, { previousRate: 13 }),
];

describe("current versus upcoming rates", () => {
    it("an entry dated after today is upcoming: shown, but never the current rate", () => {
        const current = currentLoanRate(LOAN, HISTORY, "2026-02-01");

        expect(current).toMatchObject({ rate: 12, basis: "HISTORY", entry: { id: "initial" } });
        expect(current.upcoming.map(e => e.id)).toEqual(["mar", "may"]);
    });

    it("an entry becomes current on its own effective date (inclusive), not the day before", () => {
        expect(currentLoanRate(LOAN, HISTORY, "2026-02-28").rate).toBe(12);
        expect(currentLoanRate(LOAN, HISTORY, "2026-03-01")).toMatchObject({ rate: 13, entry: { id: "mar" } });
        expect(currentLoanRate(LOAN, HISTORY, "2026-03-01").upcoming.map(e => e.id)).toEqual(["may"]);
        expect(currentLoanRate(LOAN, HISTORY, "2026-05-01")).toMatchObject({ rate: 14, upcoming: [] });
    });

    it("multiple upcoming changes are listed in date order, whatever order they were stored in", () => {
        const shuffled = [HISTORY[2]!, HISTORY[0]!, HISTORY[1]!];
        expect(upcomingEntries(shuffled, "2026-01-31").map(e => e.id)).toEqual(["mar", "may"]);
        expect(currentRateLabel(currentLoanRate(LOAN, shuffled, "2026-01-31"))).toBe("12.00% (13.00% from 2026-03-01)");
    });

    it("the stored loans.interest_rate is never the current rate for a loan with history (it can lag)", () => {
        expect(currentLoanRate({ interestRate: 12 }, HISTORY, "2026-06-01").rate).toBe(14);
    });

    it("a loan with no live history shows its own terms, with nothing upcoming", () => {
        expect(currentLoanRate(LOAN, [], "2026-06-01")).toEqual({ rate: 9, rateType: "FIXED", basis: "LOAN_TERMS", entry: null, upcoming: [] });
    });

    it("superseded entries are never current or upcoming", () => {
        const history = [
            ...HISTORY,
            entry("wrong", "2026-04-01", 30, { supersededBy: "right", supersededAt: "2026-04-02", correctionReason: "Typo" }),
            entry("right", "2026-04-01", 13.25),
        ];
        expect(currentLoanRate(LOAN, history, "2026-04-15").rate).toBe(13.25);
        expect(upcomingEntries(history, "2026-03-15").map(e => e.id)).toEqual(["right", "may"]);
    });

    it("a loan that has not started yet shows its first recorded rate, labelled as such", () => {
        const current = currentLoanRate(LOAN, HISTORY, "2025-12-01");
        expect(current).toMatchObject({ rate: 12, basis: "NOT_STARTED", entry: { id: "initial" } });
        expect(current.upcoming.map(e => e.id)).toEqual(["mar", "may"]);
    });

    it("currentRateEntry follows the same rule (same date: the one recorded last)", () => {
        expect(currentRateEntry(HISTORY, "2026-04-30")?.id).toBe("mar");
        expect(currentRateEntry(HISTORY, "2025-01-01")).toBeNull();
    });

    it("groups a list-wide read by loan", () => {
        const grouped = groupByLoan([entry("a", "2026-01-01", 10), entry("b", "2026-01-01", 11, { loanId: "loan-2" }), entry("c", "2026-02-01", 10.5)]);
        expect([...grouped.keys()]).toEqual(["loan-1", "loan-2"]);
        expect(grouped.get("loan-1")!.map(e => e.id)).toEqual(["a", "c"]);
    });
});

describe("history display: previous rate from the live timeline", () => {
    it("a change recorded later, between upcoming ones, never leaves a stale previous rate on display", () => {
        // "may" was saved when "mar" was the rate before it (stored 13); then
        // 13.5% from April was recorded. Shown: May's previous is 13.5%.
        const shown = withEffectiveUntil([...HISTORY, entry("apr", "2026-04-01", 13.5, { previousRate: 13 })]);
        expect(shown.map(e => [e.id, e.previousRate, e.effectiveUntil])).toEqual([
            ["initial", null, "2026-02-28"],
            ["mar", 12, "2026-03-31"],
            ["apr", 13, "2026-04-30"],
            ["may", 13.5, null],
        ]);
    });
});

describe("baseline for a loan with no history", () => {
    const loan = { interestRate: 12, startDate: "2026-01-10T00:00:00", rateType: "FLOATING" as const };

    it("is the loan's own stored rate from its start date - nothing earlier is inferred", () => {
        expect(resolveRateBaseline(loan, [])).toEqual({ kind: "LOAN_TERMS", rate: 12, effectiveFrom: "2026-01-10", rateType: "FLOATING" });
    });

    it("is not needed once the loan has live history", () => {
        expect(resolveRateBaseline(loan, HISTORY)).toEqual({ kind: "HISTORY" });
    });

    it("is unsafe when the history holds only superseded rows (ambiguous)", () => {
        const result = resolveRateBaseline(loan, [entry("old", "2026-01-10", 12, { supersededBy: "x", supersededAt: "2026-01-11", correctionReason: "r" })]);
        expect(result.kind === "UNSAFE" && result.reason).toMatch(/ambiguous/);
    });

    it.each([
        ["no start date", { ...loan, startDate: "" }, /start date/],
        ["an invalid start date", { ...loan, startDate: "2026-02-30" }, /start date/],
        ["no stored rate", { ...loan, interestRate: null }, /missing or invalid/],
        ["a NaN rate", { ...loan, interestRate: Number.NaN }, /missing or invalid/],
        ["a negative rate", { ...loan, interestRate: -1 }, /missing or invalid/],
        ["a rate above 100", { ...loan, interestRate: 101 }, /missing or invalid/],
    ])("is unsafe with %s - nothing is fabricated in its place", (_label, broken, message) => {
        const result = resolveRateBaseline(broken, []);
        expect(result.kind).toBe("UNSAFE");
        expect(result.kind === "UNSAFE" && result.reason).toMatch(message);
    });

    it("a 0% stored rate is a real rate, kept as it is", () => {
        expect(resolveRateBaseline({ ...loan, interestRate: 0 }, [])).toMatchObject({ kind: "LOAN_TERMS", rate: 0 });
    });

    it("reading the baseline never changes the loan or its history", () => {
        const frozenLoan = Object.freeze({ ...loan });
        const frozenHistory = Object.freeze([] as Stored[]);
        resolveRateBaseline(frozenLoan, frozenHistory);
        currentLoanRate(frozenLoan, frozenHistory, "2026-06-01");
        expect(frozenLoan).toEqual(loan);
    });
});

describe("direct rate edits", () => {
    it("an unchanged rate passes; any change is refused with where to record it", () => {
        expect(directRateEditRefusal(10.5, 10.5, false)).toBeNull();
        expect(directRateEditRefusal(10.5, 10.75, false)).toMatch(/Use Record rate change/);
        expect(directRateEditRefusal(10.5, Number.NaN, false)).toMatch(/Use Record rate change/);
    });

    it("an Overdraft's blank rate means 0 (as its form saves it): unchanged only when the stored rate is 0", () => {
        expect(directRateEditRefusal(0, null, true)).toBeNull();
        expect(directRateEditRefusal(10.5, undefined, true)).toMatch(/Use Record rate change/);
    });

    it("a Term Loan request without a rate is refused, never treated as unchanged", () => {
        expect(directRateEditRefusal(10.5, undefined, false)).toMatch(/Use Record rate change/);
    });
});

describe("generating a schedule later follows the rate history", () => {
    it("one rate (no history, or only the original rate) generates as before", () => {
        expect(scheduleGenerationRateIssue(12, [])).toBeNull();
        expect(scheduleGenerationRateIssue(12, [entry("initial", "2026-01-10", 12, { source: "INITIAL" })])).toBeNull();
    });

    it("a recorded change - current or upcoming - is refused rather than ignored", () => {
        expect(scheduleGenerationRateIssue(12, HISTORY)).toMatch(/recorded interest rate changes/);
        expect(scheduleGenerationRateIssue(12, [entry("initial", "2026-01-10", 12, { source: "INITIAL" }), entry("next", "2099-01-01", 12.5)])).toMatch(/one rate only/);
    });

    it("a superseded row does not count", () => {
        expect(scheduleGenerationRateIssue(12, [entry("initial", "2026-01-10", 12, { source: "INITIAL" }), entry("x", "2026-03-01", 30, { supersededBy: "initial", supersededAt: "2026-03-02", correctionReason: "r" })])).toBeNull();
    });
});
