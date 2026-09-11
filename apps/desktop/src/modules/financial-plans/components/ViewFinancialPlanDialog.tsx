import {
    AlertTriangle,
    ShieldAlert,
} from "lucide-react";

import { useDateFormatter } from "@/core/formatting";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import type { Currency } from "@/modules/currencies/types";
import type { FinancialGoal } from "@/modules/financial-goals/types";
import type { FinancialPlan } from "../types";
import {
    getFinancialPlanCategory,
    getFinancialPlanSubcategoryLabel,
    getPlanPeriodTypeLabel,
    getPlanTypeLabel,
    isPerPeriodTarget,
} from "../constants";
import {
    usePlanActuals,
    usePlanComponents,
} from "../hooks";
import {
    checkPlanIntegrity,
    describePlanActualsSummary,
} from "../services";

export interface ViewFinancialPlanDialogProps {
    plan: FinancialPlan | null;
    currency?: Currency;
    /** Name of the linked Goal, resolved by the page. */
    linkedGoalName?: string;
    /**
     * The LIVE linked goal (from the non-deleted goals list), or null
     * when the link is dangling. Used only for integrity surfacing.
     */
    linkedGoal?: FinancialGoal | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}



function formatAmount(
    amount: number | null,
    currency?: Currency
) {
    if (amount === null || amount === undefined) {
        return "—";
    }

    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: currency?.code || "INR",
        maximumFractionDigits: 2,
    }).format(Number(amount));
}

function formatStatus(status: FinancialPlan["status"]) {
    return (
        status.charAt(0) +
        status.slice(1).toLowerCase()
    );
}

function Detail({
    label,
    value,
}: {
    label: string;
    value: string;
}) {
    return (
        <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                {label}
            </div>

            <div className="text-sm text-slate-800">
                {value || "—"}
            </div>
        </div>
    );
}

export function ViewFinancialPlanDialog({
    plan,
    currency,
    linkedGoalName,
    linkedGoal,
    open,
    onOpenChange,
}: ViewFinancialPlanDialogProps) {
    const formatDate = useDateFormatter();

    const {
        result: actuals,
        loading: actualsLoading,
        error: actualsError,
    } = usePlanActuals(
        open && plan ? plan.id : null
    );

    const { components } = usePlanComponents(
        open && plan ? plan.id : null
    );

    if (!plan) {
        return null;
    }

    const summary = actuals
        ? describePlanActualsSummary(
              actuals,
              currency
          )
        : null;

    const integrity = checkPlanIntegrity(plan, {
        goal: linkedGoal ?? null,
        components,
    });

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
        >
            <DialogContent
                showCloseButton
                className="
                    flex
                    max-h-[calc(100vh-48px)]
                    w-[680px]
                    max-w-[calc(100vw-48px)]
                    flex-col
                    overflow-hidden
                    rounded-[28px]
                    border border-slate-100
                    bg-white
                    p-0
                    shadow-lg
                "
            >
                <DialogHeader className="shrink-0 px-7 pb-5 pt-6">
                    <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">
                        Financial Plan Details
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        View financial plan information.
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100 px-7 py-6">
                    <div className="grid grid-cols-2 gap-x-8 gap-y-6">
                        <Detail
                            label="Plan Name"
                            value={plan.name}
                        />

                        <Detail
                            label="Plan Category"
                            value={
                                getFinancialPlanCategory(
                                    plan.planCategory ?? ""
                                )?.label ??
                                plan.planCategory ??
                                "—"
                            }
                        />

                        <Detail
                            label="Plan Type"
                            value={getPlanTypeLabel(
                                plan.planType
                            )}
                        />

                        <Detail
                            label="Focus"
                            value={getFinancialPlanSubcategoryLabel(
                                plan.planCategory ?? "",
                                plan.planSubcategory ??
                                    plan.planType
                            )}
                        />

                        <Detail
                            label="Review Period"
                            value={getPlanPeriodTypeLabel(
                                plan.periodType
                            )}
                        />

                        <Detail
                            label="Status"
                            value={formatStatus(
                                plan.status
                            )}
                        />

                        <Detail
                            label="Currency"
                            value={
                                currency
                                    ? `${currency.code} — ${currency.name}`
                                    : plan.currencyId
                            }
                        />

                        <Detail
                            label="Linked Goal"
                            value={
                                plan.goalId
                                    ? linkedGoalName ??
                                      "Linked goal unavailable"
                                    : "—"
                            }
                        />

                        <Detail
                            label="Start Date"
                            value={formatDate(
                                plan.startDate
                            )}
                        />

                        <Detail
                            label="End Date"
                            value={formatDate(
                                plan.endDate
                            )}
                        />

                        <Detail
                            label={
                                isPerPeriodTarget(
                                    plan.planType
                                )
                                    ? "Per-Period Target"
                                    : "Target Amount"
                            }
                            value={formatAmount(
                                plan.targetAmount,
                                currency
                            )}
                        />

                        <Detail
                            label="Created"
                            value={
                                plan.createdAt || "—"
                            }
                        />

                        <div className="col-span-2 space-y-1">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                                Notes
                            </div>

                            <div className="whitespace-pre-wrap text-sm text-slate-800">
                                {plan.notes || "—"}
                            </div>
                        </div>
                    </div>

                    <div className="mt-8 border-t border-slate-100 pt-6">
                        <div className="flex items-center justify-between">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                                Current Position
                            </div>

                            {summary && (
                                <span
                                    className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                        summary.status ===
                                        "INCOMPLETE"
                                            ? "bg-amber-50 text-amber-700"
                                            : "bg-emerald-50 text-emerald-700"
                                    }`}
                                >
                                    {summary.status ===
                                    "INCOMPLETE"
                                        ? "Incomplete"
                                        : "Complete"}
                                </span>
                            )}
                        </div>

                        {actualsLoading && (
                            <p className="mt-3 text-sm text-slate-400">
                                Calculating current
                                position…
                            </p>
                        )}

                        {!actualsLoading &&
                            actualsError && (
                                <p className="mt-3 text-sm text-red-500">
                                    {actualsError}
                                </p>
                            )}

                        {!actualsLoading &&
                            !actualsError &&
                            summary && (
                                <>
                                    <p className="mt-1 text-xs text-slate-400">
                                        {
                                            summary.periodLabel
                                        }{" "}
                                        ·{" "}
                                        {
                                            summary.componentCountLabel
                                        }
                                    </p>

                                    {summary.empty ? (
                                        <p className="mt-3 text-sm text-slate-500">
                                            No components
                                            yet — add
                                            sources to
                                            track this
                                            plan's
                                            position.
                                        </p>
                                    ) : (
                                        <dl className="mt-3 space-y-2">
                                            {summary.rows.map(
                                                (
                                                    row,
                                                    index
                                                ) => (
                                                    <div
                                                        key={`${row.label}-${index}`}
                                                        className="flex items-baseline justify-between gap-4"
                                                    >
                                                        <dt className="text-sm text-slate-500">
                                                            {
                                                                row.label
                                                            }
                                                        </dt>
                                                        <dd
                                                            className={`text-sm ${
                                                                row.emphasis
                                                                    ? "font-semibold text-slate-900"
                                                                    : "text-slate-700"
                                                            }`}
                                                        >
                                                            {
                                                                row.value
                                                            }
                                                        </dd>
                                                    </div>
                                                )
                                            )}
                                        </dl>
                                    )}

                                    {summary.warnings
                                        .length > 0 && (
                                        <ul className="mt-4 space-y-1.5">
                                            {summary.warnings.map(
                                                message => (
                                                    <li
                                                        key={
                                                            message
                                                        }
                                                        className="flex items-start gap-2 text-xs text-amber-700"
                                                    >
                                                        <AlertTriangle
                                                            size={
                                                                12
                                                            }
                                                            className="mt-0.5 shrink-0"
                                                        />
                                                        <span>
                                                            {
                                                                message
                                                            }
                                                        </span>
                                                    </li>
                                                )
                                            )}
                                        </ul>
                                    )}
                                </>
                            )}
                    </div>

                    {integrity.issues.length > 0 && (
                        <div className="mt-8 border-t border-slate-100 pt-6">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                                Integrity
                            </div>

                            <ul className="mt-3 space-y-2">
                                {integrity.issues.map(
                                    issue => (
                                        <li
                                            key={`${issue.code}-${
                                                issue.componentId ??
                                                "plan"
                                            }`}
                                            className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
                                                issue.severity ===
                                                "error"
                                                    ? "bg-red-50 text-red-700"
                                                    : "bg-amber-50 text-amber-700"
                                            }`}
                                        >
                                            <ShieldAlert
                                                size={13}
                                                className="mt-0.5 shrink-0"
                                            />
                                            <span>
                                                {
                                                    issue.message
                                                }
                                            </span>
                                        </li>
                                    )
                                )}
                            </ul>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
