import type { Currency } from "@/modules/currencies/types";
import type { FinancialGoal } from "@/modules/financial-goals/types";

import {
    FINANCIAL_PLAN_CATEGORIES,
    PLAN_PERIOD_TYPES,
    PLAN_TYPES,
    planTypeRequiresTarget,
} from "../constants";
import type { PlanType } from "../types";

// ---------------------------------------------------------------------
// Financial Plans - Phase 1 integrity
//
// Pure helpers used at the FinancialPlanService boundary. They mirror
// the zod form rules so they never reject anything the Add/Edit form
// already allows - they just also guard non-form callers - plus two
// reference checks (currency exists, linked Goal exists + same currency).
//
// No storage. No derived/actual/projection logic. `plan_type` only
// classifies a plan; a DEBT_PAYOFF plan with a null target is valid
// (read as "pay off entirely" in Phase 2), so target is required only
// for EXPENSE_PLAN and CASHFLOW_TARGET.
// ---------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value: string): boolean {
    return (
        ISO_DATE.test(value) &&
        !Number.isNaN(Date.parse(value))
    );
}

export interface FinancialPlanFieldInput {
    name: string;
    planType: string;
    planCategory: string;
    planSubcategory: string;
    periodType: string;
    startDate: string;
    endDate?: string | null;
    currencyId: string;
    targetAmount?: number | null;
}

/** First validation problem, or null when the fields are acceptable. */
export function validateFinancialPlanFields(
    input: FinancialPlanFieldInput
): string | null {
    if (!input.name || !input.name.trim()) {
        return "Plan name is required.";
    }

    if (
        !(PLAN_TYPES as readonly string[]).includes(
            input.planType
        )
    ) {
        return "Select a valid plan type.";
    }

    if (
        !(
            PLAN_PERIOD_TYPES as readonly string[]
        ).includes(input.periodType)
    ) {
        return "Select a valid period.";
    }

    const category = FINANCIAL_PLAN_CATEGORIES.find(
        entry => entry.value === input.planCategory
    );

    if (!category) {
        return "Select a valid plan category.";
    }

    if (
        !category.subcategories.some(
            sub => sub.value === input.planSubcategory
        )
    ) {
        return "Select a valid plan focus for this category.";
    }

    if (
        !input.startDate ||
        !isValidIsoDate(input.startDate)
    ) {
        return "A valid start date is required.";
    }

    const endDate = (input.endDate ?? "").trim();

    if (endDate) {
        if (!isValidIsoDate(endDate)) {
            return "The end date is not a valid date.";
        }

        if (endDate < input.startDate) {
            return "The end date cannot be before the start date.";
        }
    }

    if (input.periodType === "ONE_TIME" && !endDate) {
        return "A one-time plan needs an end date.";
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
            return "Target amount must be a number of zero or more.";
        }
    }

    if (
        planTypeRequiresTarget(
            input.planType as PlanType
        ) &&
        (input.targetAmount === null ||
            input.targetAmount === undefined)
    ) {
        return input.planType === "CASHFLOW_TARGET"
            ? "A cash-flow plan needs a per-period target amount."
            : "An expense plan needs a target amount.";
    }

    if (
        !input.currencyId ||
        !input.currencyId.trim()
    ) {
        return "A currency is required.";
    }

    return null;
}

export interface FinancialPlanReferenceCheck {
    ok: boolean;
    reason?: string;
}

/** A plan's currency must resolve to a real, non soft-deleted currency. */
export function validateFinancialPlanCurrency(
    currency: Currency | null | undefined
): FinancialPlanReferenceCheck {
    if (!currency) {
        return {
            ok: false,
            reason: "The selected currency no longer exists.",
        };
    }

    return { ok: true };
}

/**
 * The Goal link is optional. `null` means no link. When supplied it
 * must resolve to a live Goal in the SAME currency as the plan - no FX,
 * no cross-currency link. No Goal figure is copied onto the plan.
 */
export function validateFinancialPlanGoal(
    goalId: string | null,
    goal: FinancialGoal | null | undefined,
    planCurrencyId: string
): FinancialPlanReferenceCheck {
    if (goalId === null) {
        return { ok: true };
    }

    if (!goal) {
        return {
            ok: false,
            reason: "The selected goal no longer exists.",
        };
    }

    if (goal.currencyId !== planCurrencyId) {
        return {
            ok: false,
            reason: "The selected goal uses a different currency to this plan.",
        };
    }

    return { ok: true };
}
