import type {
    FinancialPlanStatus,
    PlanPeriodType,
    PlanType,
} from "./FinancialPlan";

export interface UpdateFinancialPlanRequest {
    id: string;
    name: string;
    planType: PlanType;
    planCategory: string;
    planSubcategory: string;
    periodType: PlanPeriodType;
    startDate: string;
    endDate?: string | null;
    currencyId: string;
    targetAmount?: number | null;
    goalId?: string | null;
    notes?: string | null;
    status: FinancialPlanStatus;
}
