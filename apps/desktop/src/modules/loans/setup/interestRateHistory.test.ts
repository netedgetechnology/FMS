import { describe, expect, it } from "vitest";

import type { InterestRateHistoryEntry } from "../types/InterestRateHistory";
import { dayBefore, rateOn, withEffectiveUntil } from "./interestRateHistory";

type Stored = Omit<InterestRateHistoryEntry, "effectiveUntil">;

// Synthetic entries for one synthetic loan.
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

describe("Interest Rate History - effective until", () => {
    it("the day before, across month, year and leap-day boundaries", () => {
        expect(dayBefore("2026-07-01")).toBe("2026-06-30");
        expect(dayBefore("2027-01-01")).toBe("2026-12-31");
        expect(dayBefore("2028-03-01")).toBe("2028-02-29");
        expect(dayBefore("2026-03-01")).toBe("2026-02-28");
    });

    it("the initial rate alone is the current rate, open-ended", () => {
        expect(withEffectiveUntil([entry("r1", "2026-01-31", 10.5, { source: "INITIAL" })])).toMatchObject([{ id: "r1", effectiveUntil: null }]);
    });

    it("each rate runs to the day before the next one starts, whatever order they are stored in", () => {
        const result = withEffectiveUntil([entry("r3", "2026-11-15", 11), entry("r1", "2026-01-31", 10.5), entry("r2", "2026-07-01", 10.75)]);

        expect(result.map(e => [e.id, e.effectiveFrom, e.effectiveUntil])).toEqual([
            ["r1", "2026-01-31", "2026-06-30"],
            ["r2", "2026-07-01", "2026-11-14"],
            ["r3", "2026-11-15", null],
        ]);
    });

    it("a superseded entry is kept for the audit trail but is never in effect", () => {
        const result = withEffectiveUntil([
            entry("r1", "2026-01-31", 10.5),
            entry("wrong", "2026-07-01", 17.5, { supersededBy: "right", supersededAt: "2026-07-02", correctionReason: "Typo" }),
            entry("right", "2026-07-01", 10.75),
        ]);

        expect(result.map(e => [e.id, e.effectiveUntil])).toEqual([
            ["r1", "2026-06-30"],
            ["right", null],
            ["wrong", null],
        ]);
    });

    it("two live entries on one date: the later-recorded one is in effect, and neither ends before it starts", () => {
        const result = withEffectiveUntil([entry("a", "2026-07-01", 10.75, { createdAt: "2026-07-01T09:00:00Z" }), entry("b", "2026-07-01", 11, { createdAt: "2026-07-01T10:00:00Z" })]);

        expect(result.map(e => [e.id, e.effectiveUntil])).toEqual([
            ["a", null],
            ["b", null],
        ]);
        expect(rateOn(result, "2026-07-01")?.id).toBe("b");
    });
});

describe("Interest Rate History - the rate on a date", () => {
    const history = [entry("r1", "2026-01-31", 10.5, { source: "INITIAL" }), entry("r2", "2026-07-01", 10.75), entry("r3", "2026-11-15", 11)];

    it("is the latest entry starting on or before the date", () => {
        expect(rateOn(history, "2026-01-31")?.rate).toBe(10.5);
        expect(rateOn(history, "2026-06-30")?.rate).toBe(10.5);
        expect(rateOn(history, "2026-07-01")?.rate).toBe(10.75);
        expect(rateOn(history, "2026-11-14T23:59:59")?.rate).toBe(10.75);
        expect(rateOn(history, "2030-01-01")?.rate).toBe(11);
    });

    it("is unknown before the first entry - never guessed", () => {
        expect(rateOn(history, "2026-01-30")).toBeNull();
        expect(rateOn([], "2026-07-01")).toBeNull();
    });

    it("ignores a superseded entry", () => {
        const corrected = [...history, entry("bad", "2026-09-01", 99, { supersededBy: "r2", supersededAt: "2026-09-02", correctionReason: "Wrong loan" })];
        expect(rateOn(corrected, "2026-10-01")?.rate).toBe(10.75);
    });
});
