export type FinancialPlanStatus =
    | "ACTIVE"
    | "COMPLETED"
    | "ARCHIVED";

/**
 * Strategy archetype - how a plan's actual position is derived and
 * projected (Phase 2). Distinct from the category/subcategory taxonomy
 * (which describes the "life area").
 */
export type PlanType =
    | "ACCUMULATION"
    | "DEBT_PAYOFF"
    | "EXPENSE_PLAN"
    | "CASHFLOW_TARGET"
    | "PORTFOLIO_GROWTH";

/**
 * The calendar cadence a plan is measured / reported at. Not the plan's
 * horizon (that is start_date / end_date). `ONE_TIME` requires an
 * end_date.
 */
export type PlanPeriodType =
    | "MONTHLY"
    | "QUARTERLY"
    | "YEARLY"
    | "ONE_TIME";

export interface FinancialPlan {
    id: string;
    name: string;
    planType: PlanType;
    planCategory: string;
    planSubcategory: string;
    periodType: PlanPeriodType;
    startDate: string;
    endDate: string | null;
    currencyId: string;
    /**
     * User-entered target. Cumulative for ACCUMULATION / DEBT_PAYOFF /
     * EXPENSE_PLAN / PORTFOLIO_GROWTH; per-period net surplus for
     * CASHFLOW_TARGET. Never derived, never synced from a linked Goal.
     */
    targetAmount: number | null;
    /**
     * Optional 1:1 link to a Goal (Plan -> Goal only). The linked Goal
     * must use the same currency. No Goal figure is copied here.
     */
    goalId: string | null;
    notes: string | null;
    status: FinancialPlanStatus;
    createdAt: string;
    updatedAt: string;
}
