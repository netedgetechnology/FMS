export type FinancialGoalStatus =
    | "ACTIVE"
    | "COMPLETED"
    | "PAUSED"
    | "CANCELLED";

export interface FinancialGoal {
    id: string;
    name: string;
    goalType: string;
    goalCategory: string;
    goalSubcategory: string;
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
