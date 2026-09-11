import type {
    PlanComponentRole,
    PlanComponentType,
} from "./FinancialPlanComponent";

export interface CreateFinancialPlanComponentRequest {
    planId: string;
    componentType: PlanComponentType;
    role: PlanComponentRole;
    /** The service routes this to the correct FK column by componentType. */
    sourceId: string;
    label?: string | null;
    targetAmount?: number | null;
    sortOrder?: number;
    isActive?: boolean;
    notes?: string | null;
}
