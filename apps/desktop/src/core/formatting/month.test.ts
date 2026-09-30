import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

import {
    addMonths,
    currentMonth,
    endOfMonth,
    formatMonthLabel,
    isSameMonth,
    startOfMonth,
    toISODateString,
} from "./month";

describe("month helpers", () => {
    describe("startOfMonth / endOfMonth", () => {
        it("snaps to the first and last day of the month", () => {
            const mid = new Date(2026, 8, 17); // 17 Sep 2026

            expect(
                toISODateString(startOfMonth(mid)),
            ).toBe("2026-09-01");

            expect(
                toISODateString(endOfMonth(mid)),
            ).toBe("2026-09-30");
        });

        it("handles February in a non-leap year", () => {
            const feb = new Date(2026, 1, 10);

            expect(
                toISODateString(endOfMonth(feb)),
            ).toBe("2026-02-28");
        });

        it("handles February in a leap year", () => {
            const feb = new Date(2028, 1, 10);

            expect(
                toISODateString(endOfMonth(feb)),
            ).toBe("2028-02-29");
        });
    });

    describe("currentMonth", () => {
        it("returns the first day of the reference month", () => {
            const reference = new Date(2026, 8, 17);

            expect(
                toISODateString(currentMonth(reference)),
            ).toBe("2026-09-01");
        });

        it("defaults to the real current month", () => {
            const now = new Date();

            expect(
                isSameMonth(currentMonth(), now),
            ).toBe(true);

            expect(
                currentMonth().getDate(),
            ).toBe(1);
        });
    });

    describe("addMonths (previous / next navigation)", () => {
        it("moves to the previous month", () => {
            const september = new Date(2026, 8, 1);

            expect(
                toISODateString(
                    addMonths(september, -1),
                ),
            ).toBe("2026-08-01");
        });

        it("moves to the next month", () => {
            const september = new Date(2026, 8, 1);

            expect(
                toISODateString(
                    addMonths(september, 1),
                ),
            ).toBe("2026-10-01");
        });

        it("rolls over the year backwards", () => {
            const january = new Date(2026, 0, 1);

            expect(
                toISODateString(
                    addMonths(january, -1),
                ),
            ).toBe("2025-12-01");
        });

        it("rolls over the year forwards", () => {
            const december = new Date(2026, 11, 1);

            expect(
                toISODateString(
                    addMonths(december, 1),
                ),
            ).toBe("2027-01-01");
        });

        it("prev then next returns to the same month", () => {
            const start = currentMonth(
                new Date(2026, 8, 1),
            );

            const roundTrip = addMonths(
                addMonths(start, -1),
                1,
            );

            expect(
                isSameMonth(roundTrip, start),
            ).toBe(true);
        });
    });

    describe("isSameMonth", () => {
        it("is true within the same calendar month", () => {
            expect(
                isSameMonth(
                    new Date(2026, 8, 1),
                    new Date(2026, 8, 30),
                ),
            ).toBe(true);
        });

        it("is false across month or year boundaries", () => {
            expect(
                isSameMonth(
                    new Date(2026, 8, 30),
                    new Date(2026, 9, 1),
                ),
            ).toBe(false);

            expect(
                isSameMonth(
                    new Date(2025, 8, 1),
                    new Date(2026, 8, 1),
                ),
            ).toBe(false);
        });
    });

    // Regression coverage for the Financial Plan form's Start Date
    // default (reported: form showed 19-09-2026 while the app's current
    // date was 20-09-2026). The form was built with
    // `new Date().toISOString().slice(0, 10)`, which reads the UTC
    // calendar date - a day behind local midnight for any positive UTC
    // offset. The fix routes the default through `toISODateString(new
    // Date())` instead, the same local-field technique TransactionForm's
    // `todayLocalDate` already uses. These tests exercise that exact
    // call shape (`toISODateString(new Date())`) under fake system
    // clocks / timezones.
    describe("toISODateString(new Date()) - local calendar date, not UTC", () => {
        const originalTz = process.env.TZ;

        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
            process.env.TZ = originalTz;
        });

        it("Asia/Kolkata: reads the local date, not the UTC date it has already passed (the reported boundary bug)", () => {
            process.env.TZ = "Asia/Kolkata";

            // 2026-09-19 20:00 UTC is already 2026-09-20 01:30 IST
            // (UTC+5:30) - the old `toISOString().slice(0, 10)`
            // implementation would read this as "2026-09-19".
            vi.setSystemTime(
                new Date("2026-09-19T20:00:00.000Z"),
            );

            expect(toISODateString(new Date())).toBe(
                "2026-09-20",
            );
        });

        it("UTC: matches when local and UTC calendar days agree", () => {
            process.env.TZ = "UTC";

            vi.setSystemTime(
                new Date("2026-09-20T12:00:00.000Z"),
            );

            expect(toISODateString(new Date())).toBe(
                "2026-09-20",
            );
        });

        it("America/Los_Angeles: a negative UTC offset doesn't roll the date forward either", () => {
            process.env.TZ = "America/Los_Angeles";

            // 2026-09-20 02:00 UTC is still 2026-09-19 19:00 PDT
            // (UTC-7).
            vi.setSystemTime(
                new Date("2026-09-20T02:00:00.000Z"),
            );

            expect(toISODateString(new Date())).toBe(
                "2026-09-19",
            );
        });

        it("timezone boundary: local date differs from UTC date on both sides of midnight UTC", () => {
            process.env.TZ = "Asia/Kolkata";

            // Just before UTC midnight, already past local midnight in
            // IST - UTC and local calendar dates disagree.
            vi.setSystemTime(
                new Date("2026-09-19T23:00:00.000Z"),
            );

            expect(toISODateString(new Date())).toBe(
                "2026-09-20",
            );
        });

        it("always returns YYYY-MM-DD, zero-padded", () => {
            process.env.TZ = "UTC";

            vi.setSystemTime(
                new Date("2026-01-05T00:00:00.000Z"),
            );

            expect(toISODateString(new Date())).toBe(
                "2026-01-05",
            );
        });
    });

    describe("formatMonthLabel", () => {
        it("renders a readable month + year", () => {
            expect(
                formatMonthLabel(new Date(2026, 8, 1)),
            ).toBe("September 2026");

            expect(
                formatMonthLabel(new Date(2026, 0, 15)),
            ).toBe("January 2026");
        });
    });
});
