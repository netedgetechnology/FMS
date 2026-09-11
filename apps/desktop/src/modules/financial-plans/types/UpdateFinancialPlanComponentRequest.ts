import type { PlanComponentRole } from "./FinancialPlanComponent";

/**
 * componentType and the source FK are immutable after creation -
 * re-pointing a component = soft-delete + create a new one.
 */
export interface UpdateFinancialPlanComponentRequest {
    id: string;
    role: PlanComponentRole;
    label?: string | null;
    targetAmount?: number | null;
    sortOrder?: number;
    isActive?: boolean;
    notes?: string | null;
}

export interface ReorderFinancialPlanComponentsRequest {
    planId: string;
    /** Component ids in the desired order; sort_order becomes the index. */
    orderedIds: string[];
}
