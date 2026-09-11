import type {
    PlanComponentRole,
    PlanComponentType,
} from "../types/FinancialPlanComponent";
import type { PlanType } from "../types/FinancialPlan";

// ---------------------------------------------------------------------
// Financial Plans - Phase 2 (Components & Sources)
//
// The approved model: 4 component types x 4 roles, restricted to 9
// valid (type, role) combinations, further restricted per plan_type by
// PLAN_COMPONENT_MATRIX. No GOAL component. No FX. No stored values.
// ---------------------------------------------------------------------

export const PLAN_COMPONENT_TYPES = [
    "ACCOUNT",
    "CATEGORY",
    "INVESTMENT",
    "LOAN",
] as const satisfies readonly PlanComponentType[];

export const PLAN_COMPONENT_ROLES = [
    "ASSET",
    "LIABILITY",
    "CONTRIBUTION",
    "SPENDING",
] as const satisfies readonly PlanComponentRole[];

export const PLAN_COMPONENT_TYPE_LABELS: Record<
    PlanComponentType,
    string
> = {
    ACCOUNT: "Account",
    CATEGORY: "Category",
    INVESTMENT: "Investment",
    LOAN: "Loan",
};

export const PLAN_COMPONENT_ROLE_LABELS: Record<
    PlanComponentRole,
    string
> = {
    ASSET: "Asset balance",
    LIABILITY: "Liability balance",
    CONTRIBUTION: "Contribution",
    SPENDING: "Spending",
};

/** Hard cap on components per plan (active + inactive, non-deleted). */
export const MAX_COMPONENTS_PER_PLAN = 20;

/** Account types that can back an ACCOUNT + ASSET component. */
export const ACCOUNT_ASSET_TYPES: readonly string[] = [
    "CASH",
    "SAVINGS",
    "CURRENT",
    "WALLET",
];

/** Account types that can back an ACCOUNT + LIABILITY component. */
export const ACCOUNT_LIABILITY_TYPES: readonly string[] = [
    "CREDIT_CARD",
];

/** Account types never allowed for any ACCOUNT component (double-count guard). */
export const ACCOUNT_EXCLUDED_TYPES: readonly string[] = [
    "INVESTMENT",
    "LOAN",
];

export interface PlanComponentComboMeta {
    componentType: PlanComponentType;
    role: PlanComponentRole;
    /** STOCK = point-in-time balance, FLOW = movement over a period. */
    kind: "STOCK" | "FLOW";
    label: string;
    description: string;
}

/**
 * The 9 approved (type, role) combinations and what each one points at.
 * These are source -> meaning mappings only; the aggregation is Phase 3.
 */
export const PLAN_COMPONENT_CATALOG: readonly PlanComponentComboMeta[] =
    [
        {
            componentType: "ACCOUNT",
            role: "ASSET",
            kind: "STOCK",
            label: "Account balance",
            description:
                "Current balance of a cash / bank / wallet account.",
        },
        {
            componentType: "ACCOUNT",
            role: "LIABILITY",
            kind: "STOCK",
            label: "Credit-card balance",
            description:
                "Current outstanding balance on a credit-card account.",
        },
        {
            componentType: "ACCOUNT",
            role: "CONTRIBUTION",
            kind: "FLOW",
            label: "Account net cash flow",
            description:
                "Net operating cash flow (income - expense, transfers excluded) on an account.",
        },
        {
            componentType: "CATEGORY",
            role: "CONTRIBUTION",
            kind: "FLOW",
            label: "Income category",
            description:
                "Income recorded against an income category.",
        },
        {
            componentType: "CATEGORY",
            role: "SPENDING",
            kind: "FLOW",
            label: "Expense category",
            description:
                "Spending recorded against an expense category.",
        },
        {
            componentType: "INVESTMENT",
            role: "ASSET",
            kind: "STOCK",
            label: "Investment value",
            description:
                "Maintained market value of an investment holding.",
        },
        {
            componentType: "INVESTMENT",
            role: "CONTRIBUTION",
            kind: "FLOW",
            label: "Amount invested",
            description:
                "Net amount invested (buys minus sells) into an investment.",
        },
        {
            componentType: "LOAN",
            role: "LIABILITY",
            kind: "STOCK",
            label: "Loan outstanding",
            description:
                "Outstanding principal of a loan (interest excluded).",
        },
        {
            componentType: "LOAN",
            role: "CONTRIBUTION",
            kind: "FLOW",
            label: "Principal repaid",
            description:
                "Loan principal repaid over the period.",
        },
    ];

interface Combo {
    componentType: PlanComponentType;
    role: PlanComponentRole;
}

/**
 * Which (type, role) combos each plan_type may include. Authoritative.
 * A combo absent here is rejected by the service for that plan_type.
 */
export const PLAN_COMPONENT_MATRIX: Record<
    PlanType,
    readonly Combo[]
> = {
    ACCUMULATION: [
        { componentType: "ACCOUNT", role: "ASSET" },
        { componentType: "CATEGORY", role: "CONTRIBUTION" },
        { componentType: "INVESTMENT", role: "ASSET" },
        {
            componentType: "INVESTMENT",
            role: "CONTRIBUTION",
        },
    ],
    DEBT_PAYOFF: [
        { componentType: "ACCOUNT", role: "LIABILITY" },
        { componentType: "LOAN", role: "LIABILITY" },
        { componentType: "LOAN", role: "CONTRIBUTION" },
    ],
    EXPENSE_PLAN: [
        { componentType: "ACCOUNT", role: "ASSET" },
        { componentType: "CATEGORY", role: "SPENDING" },
    ],
    CASHFLOW_TARGET: [
        { componentType: "ACCOUNT", role: "CONTRIBUTION" },
        { componentType: "CATEGORY", role: "CONTRIBUTION" },
        { componentType: "CATEGORY", role: "SPENDING" },
    ],
    PORTFOLIO_GROWTH: [
        { componentType: "ACCOUNT", role: "ASSET" },
        { componentType: "INVESTMENT", role: "ASSET" },
        {
            componentType: "INVESTMENT",
            role: "CONTRIBUTION",
        },
    ],
};

export function isPlanComponentComboAllowed(
    planType: PlanType,
    componentType: PlanComponentType,
    role: PlanComponentRole
): boolean {
    return (
        PLAN_COMPONENT_MATRIX[planType]?.some(
            combo =>
                combo.componentType === componentType &&
                combo.role === role
        ) ?? false
    );
}

/** Component types usable at all by a plan_type (for the picker). */
export function allowedComponentTypesFor(
    planType: PlanType
): PlanComponentType[] {
    const seen = new Set<PlanComponentType>();

    for (const combo of PLAN_COMPONENT_MATRIX[
        planType
    ] ?? []) {
        seen.add(combo.componentType);
    }

    return PLAN_COMPONENT_TYPES.filter(type =>
        seen.has(type)
    );
}

/** Roles a plan_type allows for a given component type (for the picker). */
export function allowedRolesFor(
    planType: PlanType,
    componentType: PlanComponentType
): PlanComponentRole[] {
    return (PLAN_COMPONENT_MATRIX[planType] ?? [])
        .filter(
            combo =>
                combo.componentType === componentType
        )
        .map(combo => combo.role);
}

/**
 * A CATEGORY component's role is fixed by the category's type - the user
 * never chooses it. TRANSFER categories are never linkable.
 */
export function deriveCategoryRole(
    categoryType: string
): PlanComponentRole | null {
    if (categoryType === "INCOME") {
        return "CONTRIBUTION";
    }

    if (categoryType === "EXPENSE") {
        return "SPENDING";
    }

    return null;
}

/**
 * Per-component targets are allowed for every plan_type EXCEPT
 * CASHFLOW_TARGET, where the plan's per-period target is authoritative.
 */
export function componentTargetsAllowed(
    planType: PlanType
): boolean {
    return planType !== "CASHFLOW_TARGET";
}

export function getPlanComponentTypeLabel(
    value: string
): string {
    return (
        PLAN_COMPONENT_TYPE_LABELS[
            value as PlanComponentType
        ] ?? value
    );
}

export function getPlanComponentRoleLabel(
    value: string
): string {
    return (
        PLAN_COMPONENT_ROLE_LABELS[
            value as PlanComponentRole
        ] ?? value
    );
}

export function getPlanComponentComboLabel(
    componentType: string,
    role: string
): string {
    const meta = PLAN_COMPONENT_CATALOG.find(
        entry =>
            entry.componentType === componentType &&
            entry.role === role
    );

    return (
        meta?.label ??
        `${getPlanComponentTypeLabel(componentType)} ${getPlanComponentRoleLabel(role)}`
    );
}

export const PLAN_COMPONENT_UNAVAILABLE_LABELS: Record<
    string,
    string
> = {
    SOURCE_MISSING: "Source no longer exists",
    SOURCE_INACTIVE: "Source is no longer active",
    CURRENCY_MISMATCH:
        "Source currency no longer matches the plan",
    INVALID_ACCOUNT_TYPE:
        "Account type is no longer valid for this component",
    INVALID_CATEGORY_TYPE:
        "Category type is no longer valid for this component",
};
