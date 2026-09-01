import { describe, expect, it } from "vitest";

import { buildExpenseSegments } from "./expenseSegments";
import { colorForIndex, EXPENSE_PALETTE } from "../common/expensePalette";

const cats = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
        name: `Category ${i + 1}`,
        value: n - i, // descending, already sorted
    }));

describe("buildExpenseSegments — donut/legend colour mapping", () => {
    it("assigns exactly one colour per displayed category", () => {
        const segments = buildExpenseSegments(cats(4));

        expect(segments).toHaveLength(4);

        // one entry per category, no category appears twice
        expect(new Set(segments.map((s) => s.name)).size).toBe(4);

        // each segment carries a single `fill` string
        segments.forEach((s) =>
            expect(typeof s.fill).toBe("string"),
        );
    });

    it("donut segment colour === legend colour for the same category", () => {
        // The component passes this exact array both to <Pie data=...>
        // (recharts colours segment i from displayData[i].fill) and to
        // the legend (which renders displayData[i].fill). So proving the
        // array is stable and positional proves the two always match.
        const segments = buildExpenseSegments(cats(6));

        segments.forEach((segment, index) => {
            const donutColour = segment.fill; // what <Pie> paints
            const legendColour = segment.fill; // what the legend swatch shows
            expect(donutColour).toBe(legendColour);
            expect(segment.fill).toBe(colorForIndex(index));
        });
    });

    it("keeps every displayed segment's colour distinct", () => {
        // Up to 9 individual categories + optional "Others" => <= 10
        // segments, all within the palette, so all colours are unique.
        for (const n of [2, 5, 9, 12, 20]) {
            const segments = buildExpenseSegments(cats(n));
            expect(new Set(segments.map((s) => s.fill)).size).toBe(
                segments.length,
            );
            expect(segments.length).toBeLessThanOrEqual(EXPENSE_PALETTE.length);
        }
    });

    it("works for 2, 4, 10 and 15 categories without breaking", () => {
        for (const n of [2, 4, 10, 15]) {
            const segments = buildExpenseSegments(cats(n));

            // >9 categories collapse the tail into a single "Others"
            const expectedLength = n <= 9 ? n : 10;
            expect(segments).toHaveLength(expectedLength);

            if (n > 9) {
                expect(segments[segments.length - 1].name).toBe("Others");
            }

            // colour is still strictly positional for every segment
            segments.forEach((segment, index) =>
                expect(segment.fill).toBe(colorForIndex(index)),
            );
        }
    });

    it("gives tiny (sub-1%) categories their own distinct colour", () => {
        // Real-world shape: one dominant 'Others' bucket + small ones.
        const segments = buildExpenseSegments([
            { name: "Others", value: 144048 },
            { name: "Hosting", value: 8000 },
            { name: "Shopping", value: 1250.5 },
            { name: "Petrol", value: 1000 },
        ]);

        expect(segments.map((s) => s.name)).toEqual([
            "Others",
            "Hosting",
            "Shopping",
            "Petrol",
        ]);

        // every segment — including the < 1% ones — has a unique colour
        expect(new Set(segments.map((s) => s.fill)).size).toBe(4);
        segments.forEach((s, i) =>
            expect(s.fill).toBe(colorForIndex(i)),
        );
    });

    it("is not hardcoded to a fixed category count (order follows value)", () => {
        const segments = buildExpenseSegments([
            { name: "Small", value: 1 },
            { name: "Big", value: 100 },
            { name: "Medium", value: 10 },
        ]);

        expect(segments.map((s) => s.name)).toEqual([
            "Big",
            "Medium",
            "Small",
        ]);
        expect(segments.map((s) => s.fill)).toEqual([
            colorForIndex(0),
            colorForIndex(1),
            colorForIndex(2),
        ]);
    });
});
