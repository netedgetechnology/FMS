import { describe, expect, it } from "vitest";

import { matchesAmount, parseAmountQuery } from "./amountSearch";

// Synthetic amounts only.

describe("parseAmountQuery: every accepted format is the same amount", () => {
    it.each(["10004", "10,004", "10004.00", "10,004.00", "₹10,004", "₹10,004.00", "₹ 10,004", " 10,004 ", "Rs 10,004", "Rs. 10,004.00", "INR 10004", "10,004 INR", "1,0004"])(
        "%s -> 10004.00",
        query => {
            expect(parseAmountQuery(query)).toBe(1_000_400);
        }
    );

    it("reads Indian grouping and decimals to the paisa", () => {
        expect(parseAmountQuery("1,00,004")).toBe(10_000_400);
        expect(parseAmountQuery("₹1,00,004.50")).toBe(10_000_450);
        expect(parseAmountQuery("10004.5")).toBe(1_000_450);
        expect(parseAmountQuery("0.75")).toBe(75);
    });

    it("accepts a sign, before or after the currency marker", () => {
        expect(parseAmountQuery("-10,004")).toBe(1_000_400);
        expect(parseAmountQuery("-₹10,004.00")).toBe(1_000_400);
        expect(parseAmountQuery("₹-10,004")).toBe(1_000_400);
        expect(parseAmountQuery("+10004")).toBe(1_000_400);
    });

    it("is null for anything that is not an amount, so only text search applies", () => {
        for (const query of ["", "  ", "swiggy", "10004abc", "UPI/10004", "10,004.123", ",10004", "10004,", "10,,004", "10.004.00", "₹", "-", "2026-08-01", "10 004"]) {
            expect(parseAmountQuery(query), query).toBeNull();
        }
    });
});

describe("matchesAmount: exact amount only", () => {
    const q = parseAmountQuery("10,004")!;

    it("matches 10004.00 whether stored as a positive or a negative amount", () => {
        expect(matchesAmount(10004, q)).toBe(true);
        expect(matchesAmount(10004.0, q)).toBe(true);
        expect(matchesAmount(-10004, q)).toBe(true);
    });

    it("never matches a longer or nearby amount (no substring matches)", () => {
        for (const amount of [110004, 100040, 1000.4, 10004.01, 10003.99, 10005, 10040, 1004, 210004, -110004]) {
            expect(matchesAmount(amount, q), String(amount)).toBe(false);
        }
    });

    it("compares to the paisa, tolerating floating-point noise", () => {
        expect(matchesAmount(10004.000000001, q)).toBe(true);
        expect(matchesAmount(0.1 + 0.2, parseAmountQuery("0.30")!)).toBe(true);
    });

    it("ignores a missing amount", () => {
        expect(matchesAmount(null, q)).toBe(false);
        expect(matchesAmount(undefined, q)).toBe(false);
        expect(matchesAmount(Number.NaN, q)).toBe(false);
    });
});
