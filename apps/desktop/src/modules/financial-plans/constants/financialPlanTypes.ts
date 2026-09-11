import type { PlanType, PlanPeriodType } from "../types/FinancialPlan";

// ---------------------------------------------------------------------
// Financial Plans - Phase 1
//
// plan_type = the plan's STRATEGY ARCHETYPE. It decides how a plan's
// actual position is derived and projected (Phase 2). It is orthogonal
// to the category/subcategory taxonomy (the "life area").
//
// period_type = the calendar cadence a plan is measured / reported at.
// It is NOT the plan's horizon (that is start_date / end_date).
// ---------------------------------------------------------------------

export const PLAN_TYPES = [
    "ACCUMULATION",
    "DEBT_PAYOFF",
    "EXPENSE_PLAN",
    "CASHFLOW_TARGET",
    "PORTFOLIO_GROWTH",
] as const satisfies readonly PlanType[];

export const PLAN_PERIOD_TYPES = [
    "MONTHLY",
    "QUARTERLY",
    "YEARLY",
    "ONE_TIME",
] as const satisfies readonly PlanPeriodType[];

export const PLAN_TYPE_LABELS: Record<PlanType, string> = {
    ACCUMULATION: "Accumulation",
    DEBT_PAYOFF: "Debt Payoff",
    EXPENSE_PLAN: "Expense Plan",
    CASHFLOW_TARGET: "Cash-Flow Target",
    PORTFOLIO_GROWTH: "Portfolio Growth",
};

export const PLAN_TYPE_DESCRIPTIONS: Record<PlanType, string> = {
    ACCUMULATION:
        "Build up a pool of money toward a cumulative target.",
    DEBT_PAYOFF:
        "Reduce a liability toward zero (or a residual target).",
    EXPENSE_PLAN:
        "Set aside money for a known, planned expense.",
    CASHFLOW_TARGET:
        "Achieve a net surplus of money for each period.",
    PORTFOLIO_GROWTH:
        "Grow the market value of investments toward a target.",
};

export const PLAN_PERIOD_TYPE_LABELS: Record<
    PlanPeriodType,
    string
> = {
    MONTHLY: "Monthly",
    QUARTERLY: "Quarterly",
    YEARLY: "Yearly",
    ONE_TIME: "One-time",
};

/**
 * Whether `target_amount` is a per-period figure (CASHFLOW_TARGET only)
 * or a cumulative figure over the plan's horizon (everything else).
 * Phase 1 only stores the number - this documents the interpretation
 * Phase 2 must apply.
 */
export function isPerPeriodTarget(planType: PlanType): boolean {
    return planType === "CASHFLOW_TARGET";
}

/**
 * Whether a `target_amount` must be supplied for this plan type. An
 * expense plan and a cash-flow target are meaningless without a number.
 * DEBT_PAYOFF with no target is read as "pay off entirely" (0) later -
 * so it is NOT required here.
 */
export function planTypeRequiresTarget(
    planType: PlanType
): boolean {
    return (
        planType === "EXPENSE_PLAN" ||
        planType === "CASHFLOW_TARGET"
    );
}

export function getPlanTypeLabel(value: string): string {
    return (
        PLAN_TYPE_LABELS[value as PlanType] ?? value
    );
}

export function getPlanPeriodTypeLabel(
    value: string
): string {
    return (
        PLAN_PERIOD_TYPE_LABELS[
            value as PlanPeriodType
        ] ?? value
    );
}
