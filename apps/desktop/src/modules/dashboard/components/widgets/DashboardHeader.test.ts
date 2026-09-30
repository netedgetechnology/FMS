import { describe, expect, it } from "vitest";

import {
    customRangeLabel,
    formatDay,
    parseIsoDateAsLocal,
} from "./DashboardHeader";

describe("parseIsoDateAsLocal", () => {
    it("parses a plain calendar date into the matching local year/month/day", () => {
        const date = parseIsoDateAsLocal("2026-09-13");

        expect(date.getFullYear()).toBe(2026);
        expect(date.getMonth()).toBe(8); // 0-indexed: September
        expect(date.getDate()).toBe(13);
    });

    it("never shifts the day backward the way `new Date(isoString)` can in timezones behind UTC", () => {
        // `new Date("2026-01-01")` parses as UTC midnight; formatting that
        // in a timezone behind UTC (e.g. US timezones) renders 31 Dec
        // 2025 instead of 1 Jan 2026. parseIsoDateAsLocal must not do
        // this - it should always report exactly the date it was given,
        // regardless of the host's timezone.
        const date = parseIsoDateAsLocal("2026-01-01");

        expect(date.getFullYear()).toBe(2026);
        expect(date.getMonth()).toBe(0);
        expect(date.getDate()).toBe(1);
    });

    it("handles a year boundary at the end of December correctly", () => {
        const date = parseIsoDateAsLocal("2025-12-31");

        expect(date.getFullYear()).toBe(2025);
        expect(date.getMonth()).toBe(11);
        expect(date.getDate()).toBe(31);
    });

    it("handles a leap-day date correctly", () => {
        const date = parseIsoDateAsLocal("2028-02-29");

        expect(date.getFullYear()).toBe(2028);
        expect(date.getMonth()).toBe(1);
        expect(date.getDate()).toBe(29);
    });
});

describe("formatDay", () => {
    it("formats as two-digit day, short month, full year (matching the required '01 Sep 2026' style)", () => {
        // The ICU short-month spelling of September varies by platform
        // ("Sep" vs "Sept") - assert the structure the task requires
        // (2-digit day, short month, full year) rather than pin an exact
        // spelling this test doesn't control.
        expect(formatDay(new Date(2026, 8, 1))).toMatch(
            /^01 Sept?\s2026$/,
        );
    });

    it("pads a single-digit day", () => {
        expect(formatDay(new Date(2026, 0, 3))).toBe("03 Jan 2026");
    });

    it("uses an unambiguous three-letter month for a non-September month", () => {
        expect(formatDay(new Date(2026, 7, 13))).toBe("13 Aug 2026");
    });
});

describe("customRangeLabel", () => {
    it("formats the applied Custom Date Range exactly as required, e.g. '01 Sep 2026 - 13 Sep 2026'", () => {
        expect(customRangeLabel("2026-09-01", "2026-09-13")).toMatch(
            /^01 Sept?\s2026 - 13 Sept?\s2026$/,
        );
    });

    it("formats a single-day range with the same start and end date", () => {
        expect(customRangeLabel("2026-01-01", "2026-01-01")).toBe(
            "01 Jan 2026 - 01 Jan 2026",
        );
    });

    it("formats a range crossing a year boundary without any timezone shift", () => {
        expect(customRangeLabel("2025-12-31", "2026-01-01")).toBe(
            "31 Dec 2025 - 01 Jan 2026",
        );
    });
});
