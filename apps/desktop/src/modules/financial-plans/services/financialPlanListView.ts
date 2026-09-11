import type { Currency } from "@/modules/currencies/types";

import type {
    FinancialPlan,
    FinancialPlanStatus,
} from "../types";
import type { PlanCalcResult } from "./planActuals";

// ---------------------------------------------------------------------
// Financial Plans - Phase 6 (UI & Management) - pure view helpers
//
// Presentation-only, no I/O. Kept out of the React components so the
// list-filter, status-badge and actuals-summary logic is unit-testable
// in the project's node test environment (mirrors budgetReportView.ts).
// ---------------------------------------------------------------------

export type PlanStatusFilter =
    | "ALL"
    | FinancialPlanStatus;

export const PLAN_STATUS_FILTERS: readonly {
    value: PlanStatusFilter;
    label: string;
}[] = [
    { value: "ALL", label: "All" },
    { value: "ACTIVE", label: "Active" },
    { value: "COMPLETED", label: "Completed" },
    { value: "ARCHIVED", label: "Archived" },
];

/** Narrow a plan list by lifecycle status. "ALL" is a pass-through. */
export function filterPlansByStatus(
    plans: readonly FinancialPlan[],
    filter: PlanStatusFilter
): FinancialPlan[] {
    if (filter === "ALL") {
        return [...plans];
    }
    return plans.filter(
        plan => plan.status === filter
    );
}

/** Count of plans per status, for filter chips. */
export function countPlansByStatus(
    plans: readonly FinancialPlan[]
): Record<PlanStatusFilter, number> {
    const counts: Record<PlanStatusFilter, number> = {
        ALL: plans.length,
        ACTIVE: 0,
        COMPLETED: 0,
        ARCHIVED: 0,
    };
    for (const plan of plans) {
        if (
            plan.status === "ACTIVE" ||
            plan.status === "COMPLETED" ||
            plan.status === "ARCHIVED"
        ) {
            counts[plan.status] += 1;
        }
    }
    return counts;
}

/** Tailwind classes for a status badge (mirrors FinancialGoalTable). */
export function getPlanStatusClasses(
    status: string
): string {
    switch (status) {
        case "ACTIVE":
            return "bg-emerald-50 text-emerald-700";
        case "COMPLETED":
            return "bg-blue-50 text-blue-700";
        case "ARCHIVED":
            return "bg-slate-100 text-slate-500";
        default:
            return "bg-slate-100 text-slate-600";
    }
}

export function canArchivePlan(
    plan: Pick<FinancialPlan, "status">
): boolean {
    return plan.status !== "ARCHIVED";
}

export function canRestorePlan(
    plan: Pick<FinancialPlan, "status">
): boolean {
    return plan.status === "ARCHIVED";
}

// -------------------- actuals summary (View dialog) --------------------

export interface PlanActualsSummaryRow {
    label: string;
    /** Pre-formatted display string. */
    value: string;
    /** Optional emphasis for the headline row. */
    emphasis?: boolean;
}

export interface PlanActualsSummary {
    /** COMPLETE / INCOMPLETE from the engine. */
    status: PlanCalcResult["status"];
    /** Human note when the plan has no components at all. */
    empty: boolean;
    periodLabel: string;
    rows: PlanActualsSummaryRow[];
    /** Distinct warning messages, de-duplicated, in engine order. */
    warnings: string[];
    componentCountLabel: string;
}

function money(
    amount: number | null,
    currency: Currency | undefined
): string {
    if (amount === null || amount === undefined) {
        return "—";
    }
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: currency?.code || "INR",
        maximumFractionDigits: 2,
    }).format(Number(amount));
}

/**
 * Turns a PlanCalcResult into an ordered, pre-formatted read-out for the
 * View dialog. Read-only: it never computes progress %, target ratios or
 * projections - it only labels and formats the engine's own totals.
 */
export function describePlanActualsSummary(
    result: PlanCalcResult,
    currency: Currency | undefined
): PlanActualsSummary {
    const t = result.totals;
    const rows: PlanActualsSummaryRow[] = [];

    if (t.positionValue !== null) {
        rows.push({
            label:
                result.planType === "DEBT_PAYOFF"
                    ? "Outstanding"
                    : "Current position",
            value: money(t.positionValue, currency),
            emphasis: true,
        });
    }

    if (t.currentPeriodNet !== null) {
        rows.push({
            label: "This period — net",
            value: money(
                t.currentPeriodNet,
                currency
            ),
            emphasis: t.positionValue === null,
        });
    }

    if (t.currentPeriodInflow !== null) {
        rows.push({
            label:
                result.planType === "DEBT_PAYOFF"
                    ? "This period — principal repaid"
                    : "This period — contributions",
            value: money(
                t.currentPeriodInflow,
                currency
            ),
        });
    }

    if (t.currentPeriodOutflow !== null) {
        rows.push({
            label:
                result.planType === "DEBT_PAYOFF"
                    ? "This period — principal repaid"
                    : "This period — spending",
            value: money(
                t.currentPeriodOutflow,
                currency
            ),
        });
    }

    if (t.lifetimeInflow !== null) {
        rows.push({
            label: "Since plan start — in",
            value: money(t.lifetimeInflow, currency),
        });
    }
    if (t.lifetimeOutflow !== null) {
        rows.push({
            label: "Since plan start — out",
            value: money(
                t.lifetimeOutflow,
                currency
            ),
        });
    }

    rows.push({
        label: t.isPerPeriodTarget
            ? "Per-period target"
            : "Target",
        value: money(t.planTarget, currency),
    });

    const warnings: string[] = [];
    for (const warning of result.warnings) {
        if (!warnings.includes(warning.message)) {
            warnings.push(warning.message);
        }
    }

    return {
        status: result.status,
        empty:
            result.components.length === 0 &&
            t.positionValue === null &&
            t.currentPeriodNet === null,
        periodLabel: result.currentPeriod.label,
        rows,
        warnings,
        componentCountLabel: `${t.activeComponentCount} active${
            t.unavailableComponentCount > 0
                ? `, ${t.unavailableComponentCount} unavailable`
                : ""
        }`,
    };
}

// -------------------- list / dashboard summaries (Phase 7) --------------------

/**
 * The single headline figure for a plan row - the emphasised row from
 * describePlanActualsSummary (current position, or per-period net for a
 * cash-flow plan). Null when the plan has no computable position yet.
 */
export function getPlanHeadlineActual(
    result: PlanCalcResult,
    currency: Currency | undefined
): PlanActualsSummaryRow | null {
    const summary = describePlanActualsSummary(
        result,
        currency
    );
    return (
        summary.rows.find(row => row.emphasis) ?? null
    );
}

/**
 * Count of plans that need the user's attention: an INCOMPLETE engine
 * result, or a flagged integrity problem. ARCHIVED plans are excluded -
 * an archived plan's gaps are not actionable.
 */
export function countPlansNeedingAttention(
    plans: readonly FinancialPlan[],
    resultsByPlanId: ReadonlyMap<
        string,
        Pick<PlanCalcResult, "status">
    >,
    planIdsWithIntegrityIssues?: ReadonlySet<string>
): number {
    let count = 0;
    for (const plan of plans) {
        if (plan.status === "ARCHIVED") {
            continue;
        }
        const incomplete =
            resultsByPlanId.get(plan.id)?.status ===
            "INCOMPLETE";
        const integrity =
            planIdsWithIntegrityIssues?.has(
                plan.id
            ) ?? false;
        if (incomplete || integrity) {
            count += 1;
        }
    }
    return count;
}
