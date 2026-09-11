// ---------------------------------------------------------------------
// Financial Goals - Automatic Phase 3 (category-linked contribution
// goals)
//
// Deliberately a local, small duplicate of the categories module's own
// CategoryType values (plain strings, not an imported enum) rather than
// a cross-module type import - Financial Goals does not depend on the
// Categories module's internals, matching goalAccountLinking.ts's
// existing convention for account types.
//
// Phase 3 scope is income contributions only (per the approved design):
// a contribution goal counts `income`-type transactions recorded
// against one or more linked categories whose own categoryType is
// INCOME. Expense/spending-category goals are explicitly out of scope -
// that use case is the Budgets module's job.
// ---------------------------------------------------------------------

/** Category types eligible to fund a contribution goal. */
export const GOAL_CONTRIBUTION_CATEGORY_TYPES: readonly string[] = [
    "INCOME",
];

export function isGoalEligibleCategoryType(
    categoryType: string
): boolean {
    return GOAL_CONTRIBUTION_CATEGORY_TYPES.includes(
        categoryType
    );
}
