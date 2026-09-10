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
