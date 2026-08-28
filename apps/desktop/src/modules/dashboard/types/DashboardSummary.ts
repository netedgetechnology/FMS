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
        color: string;
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

    budgetOverview: {
        totalBudget: number;
        spent: number;
        remaining: number;
        percentage: number;
    };

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
