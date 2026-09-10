import { describe, expect, it } from "vitest";

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
