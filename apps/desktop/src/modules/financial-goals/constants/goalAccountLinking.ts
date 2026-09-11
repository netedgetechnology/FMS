import type { FinancialGoalMode } from "../types/FinancialGoal";

// ---------------------------------------------------------------------
// Financial Goals - Automatic Phase 1 (savings) + Phase 2 (debt payoff).
// isLinkedGoalMode below also covers Phase 3 (category), Phase 4 (loan)
// and Phase 5 (investment) - see those goalXLinking.ts files for their
// own eligibility rules; this file only owns the ACCOUNT-shaped rules.
//
// Deliberately a local, small duplicate of the equivalent lists in
// financial-plans/constants/financialPlanComponents.ts rather than a
// cross-module import - Financial Goals does not depend on Financial
// Plans internals.
// ---------------------------------------------------------------------

/** Which side of a goal's target a linked account contributes to. */
export type GoalAccountRole = "ASSET" | "LIABILITY";

/** Account types eligible to back an account-linked savings goal. */
export const GOAL_SAVINGS_ACCOUNT_TYPES: readonly string[] = [
    "CASH",
    "SAVINGS",
    "CURRENT",
    "WALLET",
];

/** Account types eligible to back a debt-payoff goal. */
export const GOAL_DEBT_ACCOUNT_TYPES: readonly string[] = [
    "CREDIT_CARD",
];

/**
 * MANUAL has no linked-account role. ACCOUNT_LINKED (Phase 1, savings)
 * is ASSET. DEBT_PAYOFF_LINKED (Phase 2) is LIABILITY.
 */
export function roleForGoalMode(
    goalMode: FinancialGoalMode
): GoalAccountRole | null {
    if (goalMode === "ACCOUNT_LINKED") {
        return "ASSET";
    }
    if (goalMode === "DEBT_PAYOFF_LINKED") {
        return "LIABILITY";
    }
    return null;
}

/**
 * True for any goal mode whose current amount is computed
 * automatically - from linked accounts (ASSET/LIABILITY, see
 * roleForGoalMode), from linked income categories
 * (CATEGORY_CONTRIBUTION_LINKED, see goalCategoryLinking.ts), from
 * linked loans (LOAN_PAYOFF_LINKED, see goalLoanLinking.ts), or from
 * linked investments (INVESTMENT_LINKED, see
 * goalInvestmentLinking.ts). Kept as its own direct check rather than
 * derived only from roleForGoalMode, since a category-, loan- or
 * investment-linked goal has no ASSET/LIABILITY role.
 */
export function isLinkedGoalMode(
    goalMode: FinancialGoalMode
): boolean {
    return (
        roleForGoalMode(goalMode) !== null ||
        goalMode === "CATEGORY_CONTRIBUTION_LINKED" ||
        goalMode === "LOAN_PAYOFF_LINKED" ||
        goalMode === "INVESTMENT_LINKED"
    );
}

export function eligibleAccountTypesForRole(
    role: GoalAccountRole
): readonly string[] {
    return role === "ASSET"
        ? GOAL_SAVINGS_ACCOUNT_TYPES
        : GOAL_DEBT_ACCOUNT_TYPES;
}

export function isGoalEligibleAccountType(
    accountType: string,
    role: GoalAccountRole
): boolean {
    return eligibleAccountTypesForRole(role).includes(
        accountType
    );
}
