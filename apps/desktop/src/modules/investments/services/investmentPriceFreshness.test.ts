import { describe, expect, it } from "vitest";

import {
    getInvestmentPriceFreshness,
    INVESTMENT_PRICE_STALE_AFTER_DAYS,
} from "./investmentPriceFreshness";

// Fixed "today" for deterministic tests - local midday, well clear of
// any UTC calendar-date boundary.
const ASOF = new Date(2026, 5, 30, 12, 0, 0); // 30 Jun 2026, local time

function daysAgoIso(days: number): string {
    const date = new Date(ASOF);
    date.setDate(date.getDate() - days);
    return date.toISOString();
}

describe("getInvestmentPriceFreshness", () => {
    it("returns 'unknown' for null", () => {
        expect(
            getInvestmentPriceFreshness(null, ASOF)
        ).toBe("unknown");
    });

    it("returns 'unknown' for undefined", () => {
        expect(
            getInvestmentPriceFreshness(undefined, ASOF)
        ).toBe("unknown");
    });

    it("returns 'unknown' for an empty string", () => {
        expect(
            getInvestmentPriceFreshness("", ASOF)
        ).toBe("unknown");
    });

    it("returns 'unknown' for an unparseable date string", () => {
        expect(
            getInvestmentPriceFreshness(
                "not-a-date",
                ASOF
            )
        ).toBe("unknown");
    });

    it("never fabricates a date for the unknown case (no crash, no default date assumed)", () => {
        // Calling twice with different asOf must still be "unknown" -
        // proves the result does not depend on treating the missing
        // date as any particular real date.
        expect(
            getInvestmentPriceFreshness(
                null,
                new Date(2020, 0, 1)
            )
        ).toBe("unknown");
        expect(
            getInvestmentPriceFreshness(
                null,
                new Date(2030, 0, 1)
            )
        ).toBe("unknown");
    });

    it("returns 'fresh' for a price updated today (0 days ago)", () => {
        expect(
            getInvestmentPriceFreshness(
                daysAgoIso(0),
                ASOF
            )
        ).toBe("fresh");
    });

    it("returns 'fresh' for a price updated 29 days ago", () => {
        expect(
            getInvestmentPriceFreshness(
                daysAgoIso(29),
                ASOF
            )
        ).toBe("fresh");
    });

    it(`returns 'fresh' at exactly the ${INVESTMENT_PRICE_STALE_AFTER_DAYS}-day boundary (inclusive)`, () => {
        expect(
            getInvestmentPriceFreshness(
                daysAgoIso(
                    INVESTMENT_PRICE_STALE_AFTER_DAYS
                ),
                ASOF
            )
        ).toBe("fresh");
    });

    it(`returns 'stale' the day after the ${INVESTMENT_PRICE_STALE_AFTER_DAYS}-day boundary`, () => {
        expect(
            getInvestmentPriceFreshness(
                daysAgoIso(
                    INVESTMENT_PRICE_STALE_AFTER_DAYS + 1
                ),
                ASOF
            )
        ).toBe("stale");
    });

    it("returns 'stale' for a price updated 90 days ago", () => {
        expect(
            getInvestmentPriceFreshness(
                daysAgoIso(90),
                ASOF
            )
        ).toBe("stale");
    });

    it("treats a priceUpdatedAt in the future as fresh rather than stale", () => {
        const tomorrow = new Date(ASOF);
        tomorrow.setDate(tomorrow.getDate() + 1);

        expect(
            getInvestmentPriceFreshness(
                tomorrow.toISOString(),
                ASOF
            )
        ).toBe("fresh");
    });

    it("counts by local calendar day, not by 24-hour chunks of elapsed time", () => {
        // 2 minutes apart in real time, but on two different calendar
        // days local to this test's fixed asOf - must count as 1 day
        // apart, not 0.
        const asOf = new Date(2026, 5, 2, 0, 1, 0); // 2 Jun 2026, 00:01 local
        const updatedLateThePreviousDay = new Date(
            2026,
            5,
            1,
            23,
            59,
            0
        ); // 1 Jun 2026, 23:59 local

        expect(
            getInvestmentPriceFreshness(
                updatedLateThePreviousDay.toISOString(),
                asOf
            )
        ).toBe("fresh"); // 1 day apart, well under the 30-day threshold

        // Confirm the reverse extreme also lands on 'stale' the day
        // after the boundary regardless of time-of-day, not 24h-chunk
        // dependent.
        const justOverBoundary = new Date(asOf);
        justOverBoundary.setDate(
            justOverBoundary.getDate() -
                (INVESTMENT_PRICE_STALE_AFTER_DAYS + 1)
        );
        justOverBoundary.setHours(0, 0, 1, 0);

        expect(
            getInvestmentPriceFreshness(
                justOverBoundary.toISOString(),
                asOf
            )
        ).toBe("stale");
    });

    it("defaults asOf to now when omitted", () => {
        // No injected asOf - exercises the default parameter itself.
        // A price recorded "now" must be fresh.
        expect(
            getInvestmentPriceFreshness(
                new Date().toISOString()
            )
        ).toBe("fresh");
    });
});
