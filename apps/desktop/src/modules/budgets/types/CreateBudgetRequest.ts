import type { BudgetPeriodType } from "./Budget";

export interface CreateBudgetRequest {
    name: string;
    categoryId?: string | null;
    businessEntityId?: string | null;
    amount: number;
    periodType: BudgetPeriodType;
    startDate: string;
    endDate?: string | null;
    currencyId: string;
    alertThreshold?: number;
    isActive?: boolean;
}
