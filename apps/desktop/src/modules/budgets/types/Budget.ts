export type BudgetPeriodType =
    | "MONTHLY"
    | "QUARTERLY"
    | "YEARLY"
    | "CUSTOM";

export interface Budget {
    id: string;
    name: string;
    categoryId: string | null;
    businessEntityId: string | null;
    amount: number;
    periodType: BudgetPeriodType;
    startDate: string;
    endDate: string | null;
    currencyId: string;
    alertThreshold: number;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}
