export type FinancialGoalStatus =
    | "ACTIVE"
    | "COMPLETED"
    | "PAUSED"
    | "CANCELLED";

/**
 * MANUAL: currentAmount is a plain user-typed field (the original,
 * still-supported behavior).
 * ACCOUNT_LINKED (Phase 1): currentAmount is computed from linked
 * savings/asset accounts.
 * DEBT_PAYOFF_LINKED (Phase 2): currentAmount (amount paid off) and
 * progress are computed from linked liability accounts.
 * CATEGORY_CONTRIBUTION_LINKED (Phase 3): currentAmount is the sum of
 * `income`-type transactions in one or more linked income categories,
 * from the goal's createdAt through its targetDate (or today, if no
 * targetDate) - see services/goalActuals.ts's
 * calculateCategoryContributionGoalActuals.
 * LOAN_PAYOFF_LINKED (Phase 4): currentAmount (amount paid off) and
 * progress are computed from one or more linked ACTIVE loans'
 * outstandingPrincipal - see services/goalActuals.ts's
 * calculateLoanPayoffGoalActuals. No EMI/payment-schedule data is used.
 * INVESTMENT_LINKED (Phase 5): currentAmount is the sum of one or more
 * linked ACTIVE investments' currentValue - see services/goalActuals.ts's
 * calculateInvestmentGoalActuals. No cost basis, unrealized gain/loss,
 * transaction/contribution data, or investment_holdings snapshots are used.
 * For any linked mode (see constants/goalAccountLinking.ts's
 * isLinkedGoalMode/roleForGoalMode), the stored current_amount column
 * is never read as authoritative - see services/goalActuals.ts.
 */
export type FinancialGoalMode =
    | "MANUAL"
    | "ACCOUNT_LINKED"
    | "DEBT_PAYOFF_LINKED"
    | "CATEGORY_CONTRIBUTION_LINKED"
    | "LOAN_PAYOFF_LINKED"
    | "INVESTMENT_LINKED";

export interface FinancialGoal {
    id: string;
    name: string;
    goalType: string;
    goalCategory: string;
    goalSubcategory: string;
    goalMode: FinancialGoalMode;
    targetAmount: number;
    currentAmount: number;
    currencyId: string;
    targetDate: string | null;
    priority: number;
    status: FinancialGoalStatus;
    notes?: string;
    createdAt: string;
    updatedAt: string;
}
