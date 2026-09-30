import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

import {
    DEFAULT_DASHBOARD_RANGE_SELECTION,
    rangeFromDays,
    resolveDashboardRangeSelection,
    validateCustomDateRange,
    type DashboardRangeSelection,
} from "./DashboardService";

describe("DEFAULT_DASHBOARD_RANGE_SELECTION", () => {
    it("defaults to the days mode at 30 days - the same default as before Custom Date Range existed", () => {
        expect(DEFAULT_DASHBOARD_RANGE_SELECTION).toEqual({
            mode: "days",
            days: 30,
        });
    });
});

describe("resolveDashboardRangeSelection", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("resolves every days-mode selection exactly like rangeFromDays - presets and Custom (previous days) are both unaffected by Custom Date Range", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-09-15T12:00:00"));

        for (const days of [1, 7, 30, 60, 90, 180, 365, 45]) {
            const selection: DashboardRangeSelection = {
                mode: "days",
                days,
            };

            expect(resolveDashboardRangeSelection(selection)).toEqual(
                rangeFromDays(days),
            );
        }
    });

    it("passes a Custom Date Range's start/end straight through, unchanged", () => {
        const selection: DashboardRangeSelection = {
            mode: "customRange",
            start: "2026-09-01",
            end: "2026-09-13",
        };

        expect(resolveDashboardRangeSelection(selection)).toEqual({
            start: "2026-09-01",
            end: "2026-09-13",
        });
    });

    it("supports a single-day Custom Date Range (start === end)", () => {
        const selection: DashboardRangeSelection = {
            mode: "customRange",
            start: "2026-09-01",
            end: "2026-09-01",
        };

        expect(resolveDashboardRangeSelection(selection)).toEqual({
            start: "2026-09-01",
            end: "2026-09-01",
        });
    });

    it("crosses a year boundary without any timezone-driven shift (no Date object is built for a custom range)", () => {
        const selection: DashboardRangeSelection = {
            mode: "customRange",
            start: "2025-12-31",
            end: "2026-01-01",
        };

        expect(resolveDashboardRangeSelection(selection)).toEqual({
            start: "2025-12-31",
            end: "2026-01-01",
        });
    });
});

describe("validateCustomDateRange", () => {
    it("accepts a valid ascending range", () => {
        expect(
            validateCustomDateRange("2026-09-01", "2026-09-13"),
        ).toEqual({ valid: true, error: null });
    });

    it("accepts a single-day range (start === end)", () => {
        expect(
            validateCustomDateRange("2026-09-01", "2026-09-01"),
        ).toEqual({ valid: true, error: null });
    });

    it("rejects a missing start date", () => {
        const result = validateCustomDateRange("", "2026-09-13");

        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/required/i);
    });

    it("rejects a missing end date", () => {
        const result = validateCustomDateRange("2026-09-01", "");

        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/required/i);
    });

    it("rejects both dates missing", () => {
        const result = validateCustomDateRange("", "");

        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/required/i);
    });

    it("rejects start date after end date", () => {
        const result = validateCustomDateRange(
            "2026-09-13",
            "2026-09-01",
        );

        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/cannot be later/i);
    });

    it("rejects a malformed date string", () => {
        const result = validateCustomDateRange(
            "2026/09/01",
            "2026-09-13",
        );

        expect(result.valid).toBe(false);
    });

    it("rejects a calendar date that does not exist", () => {
        const result = validateCustomDateRange(
            "2026-02-30",
            "2026-03-01",
        );

        expect(result.valid).toBe(false);
    });

    it("accepts 29 Feb in a leap year", () => {
        expect(
            validateCustomDateRange("2028-02-29", "2028-03-01"),
        ).toEqual({ valid: true, error: null });
    });

    it("rejects 29 Feb in a non-leap year", () => {
        const result = validateCustomDateRange(
            "2026-02-29",
            "2026-03-01",
        );

        expect(result.valid).toBe(false);
    });

    it("accepts a range crossing a year boundary", () => {
        expect(
            validateCustomDateRange("2025-12-25", "2026-01-05"),
        ).toEqual({ valid: true, error: null });
    });
});
