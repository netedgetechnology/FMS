import type { FinancialGoal } from "@/modules/financial-goals/types";

import { getPlanComponentTypeLabel } from "../constants";
import type {
    FinancialPlan,
    FinancialPlanComponent,
    PlanComponentType,
} from "../types";

// ---------------------------------------------------------------------
// Financial Plans - Phase 7 (Integrity & Dashboard) - pure checks
//
// Structural / reference integrity that the Phase 3-5 calculation engine
// does not (and should not) report:
//   - Plan -> Goal drift: the linked goal was deleted, or its currency
//     no longer matches the plan (Phase 1 only checked at write time).
//   - Malformed component rows: not exactly one source FK is set, or the
//     set FK does not match component_type. Phase 2 enforces this on
//     write; this catches a row that reached the DB another way. The
//     engine already treats such a row as an unavailable source and
//     leaves it out of totals - this just names the problem clearly.
//
// No I/O, no derived money values, no engine changes.
// ---------------------------------------------------------------------

export type PlanIntegrityCode =
    | "GOAL_MISSING"
    | "GOAL_CURRENCY_MISMATCH"
    | "MALFORMED_COMPONENT_ROW";

export type PlanIntegritySeverity = "error" | "warning";

export interface PlanIntegrityIssue {
    code: PlanIntegrityCode;
    severity: PlanIntegritySeverity;
    /** Safe to show directly in the plan UI; ends with an action. */
    message: string;
    /** Set for component-scoped issues. */
    componentId?: string;
}

export interface PlanIntegrityReport {
    issues: PlanIntegrityIssue[];
    hasErrors: boolean;
    hasWarnings: boolean;
}

const FK_FIELD: Record<
    PlanComponentType,
    keyof Pick<
        FinancialPlanComponent,
        | "accountId"
        | "categoryId"
        | "investmentId"
        | "loanId"
    >
> = {
    ACCOUNT: "accountId",
    CATEGORY: "categoryId",
    INVESTMENT: "investmentId",
    LOAN: "loanId",
};

/**
 * Plan -> Goal reference drift. `goal` is the LIVE goal (undefined /
 * null when it has been deleted). No issue when the plan has no link.
 */
export function checkPlanGoalIntegrity(
    plan: Pick<FinancialPlan, "goalId" | "currencyId">,
    goal:
        | Pick<FinancialGoal, "currencyId">
        | null
        | undefined
): PlanIntegrityIssue[] {
    if (!plan.goalId) {
        return [];
    }

    if (!goal) {
        return [
            {
                code: "GOAL_MISSING",
                severity: "warning",
                message:
                    "The linked goal no longer exists. Edit the plan to clear or re-link it.",
            },
        ];
    }

    if (goal.currencyId !== plan.currencyId) {
        return [
            {
                code: "GOAL_CURRENCY_MISMATCH",
                severity: "warning",
                message: `The linked goal now uses a different currency (${goal.currencyId}) to this plan (${plan.currencyId}). Edit the plan to re-link a matching goal or clear the link.`,
            },
        ];
    }

    return [];
}

/**
 * Structural check on one component row. Returns null when the row is
 * well formed (exactly one FK set, matching component_type).
 */
export function checkComponentRowIntegrity(
    component: Pick<
        FinancialPlanComponent,
        | "id"
        | "componentType"
        | "accountId"
        | "categoryId"
        | "investmentId"
        | "loanId"
    >
): PlanIntegrityIssue | null {
    const fks: Array<[string, string | null]> = [
        ["accountId", component.accountId],
        ["categoryId", component.categoryId],
        ["investmentId", component.investmentId],
        ["loanId", component.loanId],
    ];

    const setFields = fks
        .filter(([, value]) => value != null)
        .map(([field]) => field);

    const expectedField =
        FK_FIELD[component.componentType];

    const wellFormed =
        setFields.length === 1 &&
        setFields[0] === expectedField &&
        expectedField !== undefined;

    if (wellFormed) {
        return null;
    }

    return {
        code: "MALFORMED_COMPONENT_ROW",
        severity: "error",
        componentId: component.id,
        message: `A ${getPlanComponentTypeLabel(
            component.componentType
        )} component has an inconsistent source reference and is ignored in calculations. Remove and re-add it in Manage Components.`,
    };
}

export function checkPlanIntegrity(
    plan: Pick<
        FinancialPlan,
        "goalId" | "currencyId"
    >,
    context: {
        goal?:
            | Pick<FinancialGoal, "currencyId">
            | null;
        components?: readonly Pick<
            FinancialPlanComponent,
            | "id"
            | "componentType"
            | "accountId"
            | "categoryId"
            | "investmentId"
            | "loanId"
        >[];
    }
): PlanIntegrityReport {
    const issues: PlanIntegrityIssue[] = [
        ...checkPlanGoalIntegrity(
            plan,
            context.goal
        ),
    ];

    for (const component of context.components ??
        []) {
        const issue =
            checkComponentRowIntegrity(component);
        if (issue) {
            issues.push(issue);
        }
    }

    return {
        issues,
        hasErrors: issues.some(
            issue => issue.severity === "error"
        ),
        hasWarnings: issues.some(
            issue => issue.severity === "warning"
        ),
    };
}
