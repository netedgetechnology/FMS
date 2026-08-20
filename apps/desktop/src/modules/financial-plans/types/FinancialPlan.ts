export type FinancialPlanStatus =
    | "ACTIVE"
    | "COMPLETED"
    | "ARCHIVED";

export interface FinancialPlan {
    id: string;
    name: string;
    planType: string;
    planCategory: string;
    planSubcategory: string;
    startDate: string;
    endDate: string | null;
    currencyId: string;
    targetAmount: number | null;
    notes?: string;
    status: FinancialPlanStatus;
    createdAt: string;
    updatedAt: string;
}
