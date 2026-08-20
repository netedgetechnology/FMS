import type { FinancialPlanStatus } from "./FinancialPlan";

export interface CreateFinancialPlanRequest {
    name: string;
    planType: string;
    planCategory: string;
    planSubcategory: string;
    startDate: string;
    endDate?: string | null;
    currencyId: string;
    targetAmount?: number | null;
    notes?: string;
    status: FinancialPlanStatus;
}
