import type { ExpenseBreakdownItem } from "../../services";
import { colorForIndex } from "../common/expensePalette";

export interface ExpenseSegment {
    name: string;
    value: number;
    /** The one and only colour for this category. */
    fill: string;
}

/** Top expense categories shown; fewer are shown if fewer exist. */
export const MAX_EXPENSE_SEGMENTS = 10;

/**
 * Turn raw category totals into donut/legend segments: the "Others"
 * category (uncategorized transactions, see computeExpensesByCategory)
 * is excluded entirely, and the remaining categories are shown top-N by
 * value with no overflow bucket for the rest.
 *
 * Colour is assigned exactly once here, by final position. The donut
 * reads `fill` straight off this array and the legend renders the same
 * array, so a segment's colour and its legend swatch can never diverge
 * — for 2, 4, 10 or any number of categories.
 */
export function buildExpenseSegments(
    items: readonly ExpenseBreakdownItem[],
): ExpenseSegment[] {
    const top = items
        .filter((item) => item.name !== "Others")
        .slice()
        .sort((a, b) => b.value - a.value)
        .slice(0, MAX_EXPENSE_SEGMENTS);

    return top.map((item, index) => ({
        name: item.name,
        value: item.value,
        fill: colorForIndex(index),
    }));
}
