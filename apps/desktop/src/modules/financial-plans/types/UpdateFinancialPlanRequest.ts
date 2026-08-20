import type { FinancialPlanStatus } from "./FinancialPlan";

export interface UpdateFinancialPlanRequest {
    id: string;
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
