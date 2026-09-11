import { describe, expect, it } from "vitest";

import {
    endOfQuarter,
    endOfYear,
    formatQuarterLabel,
    quarterIndex,
    startOfQuarter,
    startOfYear,
} from "./quarter";
import { toISODateString } from "./month";

describe("quarter helpers", () => {
    it("maps months to civil quarters (Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec)", () => {
        expect(quarterIndex(0)).toBe(0);
        expect(quarterIndex(2)).toBe(0);
        expect(quarterIndex(3)).toBe(1);
        expect(quarterIndex(5)).toBe(1);
        expect(quarterIndex(6)).toBe(2);
        expect(quarterIndex(8)).toBe(2);
        expect(quarterIndex(9)).toBe(3);
        expect(quarterIndex(11)).toBe(3);
    });

    it("startOfQuarter / endOfQuarter for each quarter of 2026", () => {
        const cases: Array<[string, string, string]> = [
            ["2026-02-14", "2026-01-01", "2026-03-31"],
            ["2026-05-30", "2026-04-01", "2026-06-30"],
            ["2026-09-15", "2026-07-01", "2026-09-30"],
            ["2026-11-01", "2026-10-01", "2026-12-31"],
        ];

        for (const [
            input,
            start,
            end,
        ] of cases) {
            const d = new Date(input + "T12:00:00");

            expect(
                toISODateString(startOfQuarter(d))
            ).toBe(start);
            expect(
                toISODateString(endOfQuarter(d))
            ).toBe(end);
        }
    });

    it("Q4 end rolls the year correctly", () => {
        const d = new Date(2026, 11, 15);

        expect(
            toISODateString(endOfQuarter(d))
        ).toBe("2026-12-31");
    });

    it("startOfYear / endOfYear", () => {
        const d = new Date(2026, 6, 4);

        expect(toISODateString(startOfYear(d))).toBe(
            "2026-01-01"
        );
        expect(toISODateString(endOfYear(d))).toBe(
            "2026-12-31"
        );
    });

    it("does not mutate the input date", () => {
        const d = new Date(2026, 8, 15);
        const before = d.getTime();

        startOfQuarter(d);
        endOfQuarter(d);
        startOfYear(d);
        endOfYear(d);

        expect(d.getTime()).toBe(before);
    });

    it("formatQuarterLabel", () => {
        expect(
            formatQuarterLabel(new Date(2026, 8, 15))
        ).toBe("Q3 2026");
        expect(
            formatQuarterLabel(new Date(2027, 0, 1))
        ).toBe("Q1 2027");
    });
});
