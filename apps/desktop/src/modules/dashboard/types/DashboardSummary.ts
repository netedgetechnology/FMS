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
    cashBalance: number;
    income: number;
    expenses: number;
    netWorth: number;
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
        dueIn: number;
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
        monthlyChangePercentage: number;
        allocation: {
            name: string;
            value: number;
            amount: number;
        }[];
    };
}
