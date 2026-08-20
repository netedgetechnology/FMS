import type { FinancialGoalStatus } from "./FinancialGoal";

export interface UpdateFinancialGoalRequest {
    id: string;
    name: string;
    goalType: string;
    goalCategory: string;
    goalSubcategory: string;
    targetAmount: number;
    currentAmount: number;
    currencyId: string;
    targetDate?: string | null;
    priority: number;
    status: FinancialGoalStatus;
    notes?: string;
}
