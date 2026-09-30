// Per-budget row for the dashboard's current-month Budget Overview.
// Mirrors budgets/services BudgetReportRow - every number and the status
// come straight from calculateBudgetSpending(); nothing is recomputed
// here. `statusKey` is the budgets module's BudgetStatusKey union.
export interface DashboardBudgetCategory {
    budgetId: string;
    label: string;
    isOverallBudget: boolean;
    budgetAmount: number;
    actualAmount: number;
    remainingAmount: number;
    percentageUsed: number;
    overBudget: boolean;
    statusKey:
        | "no-spending"
        | "on-track"
        | "approaching"
        | "over";
    statusLabel: string;
}

// Current-month budget-vs-actual for the dashboard, scoped to a single
// currency (see DashboardService.computeDashboardBudgetOverview). Amounts
// are never summed across currencies.
export interface DashboardBudgetOverview {
    /** The currency this overview is scoped to; null when none resolved. */
    currencyId: string | null;
    /** ISO code of that currency, for display formatting; null when none. */
    currencyCode: string | null;
    /**
     * True when more than one currency has an applicable budget this
     * month - the others are only shown on the Budgets page.
     */
    hasOtherCurrencies: boolean;
    totalBudget: number;
    /** In-month spend that landed in a budgeted category. */
    actualSpending: number;
    /** totalBudget - actualSpending. NOT clamped; may be negative. */
    remaining: number;
    /** actualSpending / totalBudget * 100. NOT clamped; may exceed 100. */
    percentageUsed: number;
    overBudget: boolean;
    /** In-month expense not covered by any category budget. */
    unbudgetedSpending: number;
    /** In-month expense with no category (subset of unbudgetedSpending). */
    uncategorizedSpending: number;
    categories: DashboardBudgetCategory[];
}

export interface DashboardSummary {
    /** Sum of CURRENT + SAVINGS account balances (see DashboardService's BANK_ACCOUNT_TYPES). */
    bankBalance: number;
    /** Sum of CASH + WALLET account balances - "Cash on Hand" (see DashboardService's CASH_ON_HAND_ACCOUNT_TYPES). */
    cashOnHand: number;
    income: number;
    expenses: number;
    netWorth: number;
    /**
     * `YYYY-MM-DD` when bankBalance / cashOnHand / netWorth are a
     * historical snapshot as of the selected period's end date (a period
     * ending in the past); null when they are the current figures.
     */
    balanceAsOf: string | null;
    savingsRate: number;

    cashFlow: {
        day: string;
        income: number;
        expense: number;
    }[];

    expenseBreakdown: {
        name: string;
        value: number;
    }[];

    recentTransactions: {
        id: string;
        title: string;
        category: string;
        amount: number;
        type: "income" | "expense";
        date: string;
    }[];

    accounts: {
        id: string;
        name: string;
        type: string;
        amount: number;
        isCreditCard: boolean;
    }[];

    topSpendingCategories: {
        name: string;
        amount: number;
        percentage: number;
    }[];

    upcomingEMIs: {
        id: string;
        title: string;
        lender: string;
        amount: number;
        dueDate: string;
        /** Days until due - unchanged meaning; 0 for an overdue row (see daysOverdue instead). */
        dueIn: number;
        /** Derived at read time, never persisted (Loans Phase 5) - a PAID row is never overdue. */
        isOverdue: boolean;
        /** Whole calendar days past due; 0 when not overdue. */
        daysOverdue: number;
        progress: number;
        type: "home" | "car" | "card" | "other";
    }[];

    budgetOverview: DashboardBudgetOverview;

    goalsProgress: {
        id: string;
        name: string;
        current: number;
        target: number;
        percentage: number;
    }[];

    investmentSummary: {
        totalValue: number;
        /**
         * null when there is no historical value to compare against -
         * no price/value history is stored (Investments Phase 5
         * review), so a month-over-month change cannot be calculated
         * accurately and must never be shown as a fabricated 0%.
         */
        monthlyChangePercentage: number | null;
        allocation: {
            name: string;
            value: number;
            amount: number;
        }[];
        /** The single currency totalValue/allocation are aggregated over. */
        currencyCode: string | null;
        /**
         * True when investments exist in more than one currency -
         * totalValue/allocation only cover currencyCode's investments,
         * never summed across currencies (mirrors the Budgets
         * module's currency-scope pattern).
         */
        hasOtherCurrencies: boolean;
    };
}
