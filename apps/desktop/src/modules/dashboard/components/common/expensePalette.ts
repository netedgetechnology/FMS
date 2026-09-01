/**
 * Distinct, evenly-spread hues for expense-breakdown segments. The list
 * is intentionally long; `colorForIndex` cycles when a chart has more
 * categories than colors, so any number of categories still renders
 * with a stable, legend-matching colour.
 */
export const EXPENSE_PALETTE = [
    "#2563EB",
    "#22C55E",
    "#F59E0B",
    "#8B5CF6",
    "#EF4444",
    "#06B6D4",
    "#EC4899",
    "#14B8A6",
    "#F97316",
    "#6366F1",
    "#84CC16",
    "#DB2777",
] as const;

export function colorForIndex(index: number): string {
    return EXPENSE_PALETTE[index % EXPENSE_PALETTE.length];
}
