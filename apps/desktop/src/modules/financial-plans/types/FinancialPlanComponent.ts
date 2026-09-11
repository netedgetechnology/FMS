// ---------------------------------------------------------------------
// Financial Plans - Phase 2 (Components & Sources)
//
// A component is a typed, read-only pointer from a plan to ONE existing
// FinWea source. It never stores a money figure - the value is derived
// live from the source in Phase 3.
// ---------------------------------------------------------------------

export type PlanComponentType =
    | "ACCOUNT"
    | "CATEGORY"
    | "INVESTMENT"
    | "LOAN";

/**
 * How the source value relates to the plan objective:
 *  - ASSET        : a balance that counts toward the plan (stock, +)
 *  - LIABILITY    : a debt balance the plan aims to reduce (stock, -)
 *  - CONTRIBUTION : a periodic flow that advances the plan
 *  - SPENDING     : a periodic outflow the plan measures / limits
 */
export type PlanComponentRole =
    | "ASSET"
    | "LIABILITY"
    | "CONTRIBUTION"
    | "SPENDING";

/** Why a component cannot currently be resolved to a live source. */
export type PlanComponentUnavailableReason =
    | "SOURCE_MISSING"
    | "SOURCE_INACTIVE"
    | "CURRENCY_MISMATCH"
    | "INVALID_ACCOUNT_TYPE"
    | "INVALID_CATEGORY_TYPE";

export interface FinancialPlanComponent {
    id: string;
    planId: string;
    componentType: PlanComponentType;
    role: PlanComponentRole;
    /** Exactly one of the four source ids is non-null (matches componentType). */
    accountId: string | null;
    categoryId: string | null;
    investmentId: string | null;
    loanId: string | null;
    /** Optional user label. The UI falls back to the live source name. */
    label: string | null;
    /**
     * Optional per-component target, in the plan's currency, >= 0.
     * Disallowed (always null) when the parent plan is CASHFLOW_TARGET -
     * there the plan's per-period target is authoritative.
     */
    targetAmount: number | null;
    sortOrder: number;
    isActive: boolean;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
}

/**
 * Read model for the plan detail / manage-components UI. Carries the
 * live source name + currency and an availability verdict. It carries NO
 * derived money value - that is Phase 3.
 */
export interface FinancialPlanComponentView
    extends FinancialPlanComponent {
    sourceName: string | null;
    sourceCurrencyId: string | null;
    available: boolean;
    unavailableReason: PlanComponentUnavailableReason | null;
}
