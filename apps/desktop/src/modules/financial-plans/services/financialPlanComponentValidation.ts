import {
    ACCOUNT_ASSET_TYPES,
    ACCOUNT_EXCLUDED_TYPES,
    ACCOUNT_LIABILITY_TYPES,
    componentTargetsAllowed,
    deriveCategoryRole,
    getPlanComponentComboLabel,
    isPlanComponentComboAllowed,
    MAX_COMPONENTS_PER_PLAN,
    PLAN_COMPONENT_ROLES,
    PLAN_COMPONENT_TYPES,
} from "../constants";
import { getPlanTypeLabel } from "../constants";
import type {
    FinancialPlanComponent,
    PlanComponentRole,
    PlanComponentType,
    PlanComponentUnavailableReason,
    PlanType,
} from "../types";

// ---------------------------------------------------------------------
// Financial Plans - Phase 2 integrity (pure helpers)
//
// Used at the FinancialPlanComponentService boundary. No storage, no
// derived/actual/projection logic. Every message is safe to surface in
// the Add/Edit Component dialog.
// ---------------------------------------------------------------------

export interface ComponentFieldInput {
    componentType: string;
    role: string;
    sourceId: string;
    label?: string | null;
    targetAmount?: number | null;
    notes?: string | null;
}

/** First field problem, or null when the shape is acceptable. */
export function validateComponentFields(
    input: ComponentFieldInput
): string | null {
    if (
        !(
            PLAN_COMPONENT_TYPES as readonly string[]
        ).includes(input.componentType)
    ) {
        return "Select a valid component type.";
    }

    if (
        !(
            PLAN_COMPONENT_ROLES as readonly string[]
        ).includes(input.role)
    ) {
        return "Select a valid component role.";
    }

    if (!input.sourceId || !input.sourceId.trim()) {
        return "Select a source for this component.";
    }

    if (
        input.label !== null &&
        input.label !== undefined &&
        input.label.length > 120
    ) {
        return "The component label is too long.";
    }

    if (
        input.targetAmount !== null &&
        input.targetAmount !== undefined
    ) {
        if (
            typeof input.targetAmount !== "number" ||
            !Number.isFinite(input.targetAmount) ||
            input.targetAmount < 0
        ) {
            return "The component target must be a number of zero or more.";
        }
    }

    return null;
}

/** The (plan_type, component_type, role) triple must be in the matrix. */
export function validateComponentCombo(
    planType: PlanType,
    componentType: PlanComponentType,
    role: PlanComponentRole
): string | null {
    if (
        isPlanComponentComboAllowed(
            planType,
            componentType,
            role
        )
    ) {
        return null;
    }

    return `A ${getPlanTypeLabel(
        planType
    )} plan cannot include a "${getPlanComponentComboLabel(
        componentType,
        role
    )}" component.`;
}

/**
 * Component targets are optional everywhere except CASHFLOW_TARGET,
 * where the plan's per-period target is authoritative and a component
 * target must not be supplied.
 */
export function validateComponentTarget(
    planType: PlanType,
    targetAmount: number | null
): string | null {
    if (
        !componentTargetsAllowed(planType) &&
        targetAmount !== null
    ) {
        return "A cash-flow plan uses its own per-period target - components cannot have their own target.";
    }

    return null;
}

export interface ComponentReferenceCheck {
    ok: boolean;
    reason?: string;
    /** Set on failure so reads can report a precise unavailable reason. */
    unavailableReason?: PlanComponentUnavailableReason;
}

const OK: ComponentReferenceCheck = { ok: true };

/** ACCOUNT source: type must suit the role and not be a derived account. */
export function validateAccountSource(
    role: PlanComponentRole,
    account: { type: string } | null | undefined
): ComponentReferenceCheck {
    if (!account) {
        return {
            ok: false,
            reason: "The selected account no longer exists.",
            unavailableReason: "SOURCE_MISSING",
        };
    }

    if (
        ACCOUNT_EXCLUDED_TYPES.includes(account.type)
    ) {
        return {
            ok: false,
            reason: "Investment and loan accounts are represented by investment or loan components, not account components.",
            unavailableReason: "INVALID_ACCOUNT_TYPE",
        };
    }

    if (
        role === "ASSET" &&
        !ACCOUNT_ASSET_TYPES.includes(account.type)
    ) {
        return {
            ok: false,
            reason: "An asset-balance component needs a cash, savings, current or wallet account.",
            unavailableReason: "INVALID_ACCOUNT_TYPE",
        };
    }

    if (
        role === "LIABILITY" &&
        !ACCOUNT_LIABILITY_TYPES.includes(account.type)
    ) {
        return {
            ok: false,
            reason: "A liability-balance account component needs a credit-card account.",
            unavailableReason: "INVALID_ACCOUNT_TYPE",
        };
    }

    return OK;
}

/** CATEGORY source: role is fixed by category_type; TRANSFER is never allowed. */
export function validateCategorySource(
    role: PlanComponentRole,
    category: { categoryType: string } | null | undefined
): ComponentReferenceCheck {
    if (!category) {
        return {
            ok: false,
            reason: "The selected category no longer exists.",
            unavailableReason: "SOURCE_MISSING",
        };
    }

    const expectedRole = deriveCategoryRole(
        category.categoryType
    );

    if (expectedRole === null) {
        return {
            ok: false,
            reason: "Transfer categories cannot be used as plan components.",
            unavailableReason: "INVALID_CATEGORY_TYPE",
        };
    }

    if (expectedRole !== role) {
        return {
            ok: false,
            reason:
                expectedRole === "CONTRIBUTION"
                    ? "This is an income category - use it as a contribution component."
                    : "This is an expense category - use it as a spending component.",
            unavailableReason: "INVALID_CATEGORY_TYPE",
        };
    }

    return OK;
}

export function validateInvestmentSource(
    investment: { status: string } | null | undefined
): ComponentReferenceCheck {
    if (!investment) {
        return {
            ok: false,
            reason: "The selected investment no longer exists.",
            unavailableReason: "SOURCE_MISSING",
        };
    }

    if (investment.status !== "ACTIVE") {
        return {
            ok: false,
            reason: "The selected investment is no longer active.",
            unavailableReason: "SOURCE_INACTIVE",
        };
    }

    return OK;
}

export function validateLoanSource(
    loan: { status: string } | null | undefined
): ComponentReferenceCheck {
    if (!loan) {
        return {
            ok: false,
            reason: "The selected loan no longer exists.",
            unavailableReason: "SOURCE_MISSING",
        };
    }

    if (loan.status !== "ACTIVE") {
        return {
            ok: false,
            reason: "The selected loan is no longer active.",
            unavailableReason: "SOURCE_INACTIVE",
        };
    }

    return OK;
}

/**
 * ACCOUNT / INVESTMENT / LOAN sources must match the plan currency
 * exactly (no FX). CATEGORY has no currency - it is skipped here and
 * Phase 3 filters its transactions to the plan currency instead.
 */
export function validateComponentCurrency(
    componentType: PlanComponentType,
    sourceCurrencyId: string | null | undefined,
    planCurrencyId: string
): ComponentReferenceCheck {
    if (componentType === "CATEGORY") {
        return OK;
    }

    if (sourceCurrencyId !== planCurrencyId) {
        return {
            ok: false,
            reason: "The selected source uses a different currency to this plan.",
            unavailableReason: "CURRENCY_MISMATCH",
        };
    }

    return OK;
}

export interface DuplicateComponentCandidate {
    id: string | null;
    componentType: PlanComponentType;
    role: PlanComponentRole;
    sourceId: string;
}

function sourceIdOf(
    component: FinancialPlanComponent
): string {
    return (
        component.accountId ??
        component.categoryId ??
        component.investmentId ??
        component.loanId ??
        ""
    );
}

/** Exact (component_type, source, role) duplicate among existing components. */
export function findDuplicateComponent(
    candidate: DuplicateComponentCandidate,
    existing: readonly FinancialPlanComponent[]
): FinancialPlanComponent | null {
    return (
        existing.find(
            component =>
                component.id !== candidate.id &&
                component.componentType ===
                    candidate.componentType &&
                component.role === candidate.role &&
                sourceIdOf(component) ===
                    candidate.sourceId
        ) ?? null
    );
}

/**
 * A CASHFLOW_TARGET plan is either account-scoped (ACCOUNT components)
 * or category-scoped (CATEGORY components) - never both, so the same
 * money is not counted twice.
 */
export function violatesCashflowMode(
    planType: PlanType,
    candidateType: PlanComponentType,
    existing: readonly FinancialPlanComponent[]
): boolean {
    if (planType !== "CASHFLOW_TARGET") {
        return false;
    }

    if (candidateType === "ACCOUNT") {
        return existing.some(
            component =>
                component.componentType === "CATEGORY"
        );
    }

    if (candidateType === "CATEGORY") {
        return existing.some(
            component =>
                component.componentType === "ACCOUNT"
        );
    }

    return false;
}

/** True when adding one more component would exceed the per-plan cap. */
export function exceedsComponentLimit(
    existingCount: number
): boolean {
    return existingCount >= MAX_COMPONENTS_PER_PLAN;
}

// ---------------------------------------------------------------------
// Phase 4 - plan_type / component integrity
//
// When a plan's `plan_type` changes, an already-attached component can
// stop being valid for the new type: its (type, role) combo may leave
// PLAN_COMPONENT_MATRIX, or a per-component target may become disallowed
// (CASHFLOW_TARGET). FinancialPlanService.update() calls this to block
// such a change; the Phase 3 engine applies the same two checks per
// component as defence in depth. Reuses the single matrix source of
// truth - no rule is duplicated here.
// ---------------------------------------------------------------------

/**
 * Every component (from a caller-supplied, already deleted-filtered
 * list) that is NOT valid for `planType` - because its (type, role) is
 * outside the matrix, or it carries a target the new type forbids.
 */
export function findComponentsIncompatibleWithPlanType(
    planType: PlanType,
    components: readonly FinancialPlanComponent[]
): FinancialPlanComponent[] {
    return components.filter(component => {
        const comboInvalid = !isPlanComponentComboAllowed(
            planType,
            component.componentType,
            component.role
        );

        const targetInvalid =
            validateComponentTarget(
                planType,
                component.targetAmount ?? null
            ) !== null;

        return comboInvalid || targetInvalid;
    });
}
