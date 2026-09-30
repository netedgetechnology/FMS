import {
    endOfMonth,
    startOfMonth,
    toISODateString,
} from "@/core/formatting";

import type { Budget } from "../types";

// Phase 1 monthly-budget contract: a budget applies to a calendar month
// when that month's [firstDay, lastDay] window overlaps the budget's
// own [startDate, endDate] range. A null/blank endDate means open-ended
// - so a MONTHLY budget recurs for its start month and every month
// after, which is exactly the "startDate in September applies to
// September and onward" rule. QUARTERLY/YEARLY/CUSTOM are deliberately
// NOT redesigned here; they fall through the same overlap check, which
// is the calendar-month generalization of the applicability test the
// Dashboard aggregate (DashboardService.getSummary) already uses.
//
// Lives in the service layer (not the page) so both BudgetsPage and the
// Phase 2 spending engine can share exactly one applicability rule.
export function budgetAppliesToMonth(
    budget: Pick<Budget, "startDate" | "endDate">,
    month: Date
): boolean {
    const monthStart = toISODateString(
        startOfMonth(month)
    );

    const monthEnd = toISODateString(
        endOfMonth(month)
    );

    // Budget starts after the selected month has ended.
    if (budget.startDate > monthEnd) {
        return false;
    }

    // Budget already ended before the selected month began.
    if (
        budget.endDate &&
        budget.endDate < monthStart
    ) {
        return false;
    }

    return true;
}

// The budgets applicable to a given calendar month, preserving the
// caller's existing ordering. Active/inactive is intentionally left
// alone here (the Budgets table's Status column still conveys it) - this
// only narrows the list by period. The spending engine layers its own
// isActive filter on top for the vs-actual calculation.
export function selectBudgetsForMonth(
    budgets: readonly Budget[],
    month: Date
): Budget[] {
    return budgets.filter(budget =>
        budgetAppliesToMonth(budget, month)
    );
}

// ---------------------------------------------------------------------
// Budgets page period filter
//
// Four views:
//  - "all" (the default): every non-deleted budget, whatever its dates.
//  - "year": budgets applicable to the selected year.
//  - "month": budgets applicable to one month of the selected year - the
//    selected year is the month's context, so "October" with 2026
//    selected is October 2026.
//  - "range": budgets applicable to any month of a start-month ->
//    end-month span, which may cross years.
// The page keeps the view mode, the selected month (whose year is the
// selected year) and the selected range as separate pieces of state, so
// switching views keeps each one's last selection.
// ---------------------------------------------------------------------

export type BudgetViewMode = "all" | "year" | "month" | "range";

export const DEFAULT_BUDGET_VIEW_MODE: BudgetViewMode = "all";

export const ALL_BUDGETS_LABEL = "All Budgets";

/** An inclusive span of whole calendar months. */
export interface BudgetMonthRange {
    /** Any date within the first month (normally its first day). */
    start: Date;
    /** Any date within the last month (normally its first day). */
    end: Date;
}

// Orders two picked months into a range and snaps both to the first day
// of their month, so picking March then January is January -> March.
export function normalizeMonthRange(
    first: Date,
    second: Date
): BudgetMonthRange {
    const a = startOfMonth(first);
    const b = startOfMonth(second);

    return a <= b
        ? { start: a, end: b }
        : { start: b, end: a };
}

/** Inclusive YYYY-MM-DD bounds of a month range. */
export function monthRangeBounds(range: BudgetMonthRange): {
    start: string;
    end: string;
} {
    return {
        start: toISODateString(startOfMonth(range.start)),
        end: toISODateString(endOfMonth(range.end)),
    };
}

/** The January - December range of a calendar year. */
export function yearMonthRange(year: number): BudgetMonthRange {
    return {
        start: new Date(year, 0, 1),
        end: new Date(year, 11, 1),
    };
}

/** Inclusive YYYY-MM-DD bounds of a calendar year. */
export function yearBounds(year: number): {
    start: string;
    end: string;
} {
    return monthRangeBounds(yearMonthRange(year));
}

// A budget applies to a month range when its [startDate, endDate] range
// overlaps the span - the same overlap test budgetAppliesToMonth uses,
// over a multi-month window. Equivalently: it applies to at least one
// month of the span.
export function budgetAppliesToMonthRange(
    budget: Pick<Budget, "startDate" | "endDate">,
    range: BudgetMonthRange
): boolean {
    const { start, end } = monthRangeBounds(range);

    if (budget.startDate > end) {
        return false;
    }

    if (budget.endDate && budget.endDate < start) {
        return false;
    }

    return true;
}

export function selectBudgetsForMonthRange(
    budgets: readonly Budget[],
    range: BudgetMonthRange
): Budget[] {
    return budgets.filter(budget =>
        budgetAppliesToMonthRange(budget, range)
    );
}

// Year view applicability: the January - December month range.
export function budgetAppliesToYear(
    budget: Pick<Budget, "startDate" | "endDate">,
    year: number
): boolean {
    return budgetAppliesToMonthRange(
        budget,
        yearMonthRange(year)
    );
}

export function selectBudgetsForYear(
    budgets: readonly Budget[],
    year: number
): Budget[] {
    return selectBudgetsForMonthRange(
        budgets,
        yearMonthRange(year)
    );
}

// The budgets listed for the current view. "all" returns the list
// untouched - soft-deleted budgets never reach it (BudgetRepository
// filters deleted_at); "year" uses the selected month's year; "month"
// is the existing Phase 1 rule; "range" uses `range` (falling back to
// the single selected month when none is given).
export function selectBudgetsForView(
    budgets: readonly Budget[],
    viewMode: BudgetViewMode,
    month: Date,
    range?: BudgetMonthRange | null
): Budget[] {
    switch (viewMode) {
        case "all":
            return [...budgets];
        case "year":
            return selectBudgetsForYear(
                budgets,
                month.getFullYear()
            );
        case "month":
            return selectBudgetsForMonth(budgets, month);
        case "range":
            return selectBudgetsForMonthRange(
                budgets,
                range ?? { start: month, end: month }
            );
    }
}
