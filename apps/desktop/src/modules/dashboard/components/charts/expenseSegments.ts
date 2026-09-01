import type { ExpenseBreakdownItem } from "../../services";
import { colorForIndex } from "../common/expensePalette";

export interface ExpenseSegment {
    name: string;
    value: number;
    /** The one and only colour for this category. */
    fill: string;
}

/** Categories shown individually before the rest collapse into "Others". */
export const MAX_EXPENSE_SEGMENTS = 9;

/**
 * Turn raw category totals into donut/legend segments.
 *
 * Colour is assigned exactly once here, by final position. The donut
 * reads `fill` straight off this array and the legend renders the same
 * array, so a segment's colour and its legend swatch can never diverge
 * — for 2, 4, 10 or any number of categories.
 */
export function buildExpenseSegments(
    items: readonly ExpenseBreakdownItem[],
): ExpenseSegment[] {
    const sorted = items
        .slice()
        .sort((a, b) => b.value - a.value);

    const top = sorted.slice(0, MAX_EXPENSE_SEGMENTS);

    const othersValue = sorted
        .slice(MAX_EXPENSE_SEGMENTS)
        .reduce((sum, item) => sum + item.value, 0);

    const base =
        othersValue > 0
            ? [...top, { name: "Others", value: othersValue }]
            : top;

    return base.map((item, index) => ({
        name: item.name,
        value: item.value,
        fill: colorForIndex(index),
    }));
}
