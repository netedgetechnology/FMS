import type {
    FinancialGoalMode,
    FinancialGoalStatus,
} from "./FinancialGoal";

export interface CreateFinancialGoalRequest {
    name: string;
    goalType: string;
    goalCategory: string;
    goalSubcategory: string;
    /** Defaults to "MANUAL" when omitted. */
    goalMode?: FinancialGoalMode;
    targetAmount: number;
    currentAmount?: number;
    currencyId: string;
    targetDate?: string | null;
    priority: number;
    status: FinancialGoalStatus;
    notes?: string;
    /** ACCOUNT_LINKED / DEBT_PAYOFF_LINKED only: accounts to link on creation. */
    accountIds?: string[];
    /** CATEGORY_CONTRIBUTION_LINKED only: income categories to link on creation. */
    categoryIds?: string[];
    /** LOAN_PAYOFF_LINKED only: loans to link on creation. */
    loanIds?: string[];
    /** INVESTMENT_LINKED only: investments to link on creation. */
    investmentIds?: string[];
}
