import { useDateFormatter } from "@/core/formatting";
import {
    Archive,
    ArchiveRestore,
    Eye,
    Layers,
    Pencil,
    ShieldAlert,
    Trash2,
} from "lucide-react";

import type { Currency } from "@/modules/currencies/types";
import type { FinancialPlan } from "../types";
import type { PlanCalcResult } from "../services";
import {
    getFinancialPlanSubcategoryLabel,
    getPlanPeriodTypeLabel,
    getPlanTypeLabel,
} from "../constants";
import {
    canRestorePlan,
    getPlanHeadlineActual,
    getPlanStatusClasses,
} from "../services";

export interface FinancialPlanTableProps {
    plans: FinancialPlan[];
    currencies: Map<string, Currency>;
    /** Batched, list-level actuals (one getAllPlanActuals call). */
    actualsByPlanId?: ReadonlyMap<
        string,
        PlanCalcResult
    >;
    actualsLoading?: boolean;
    /** Plan ids that need attention (incomplete / integrity). */
    attentionPlanIds?: ReadonlySet<string>;
    onView: (plan: FinancialPlan) => void;
    onEdit: (plan: FinancialPlan) => void;
    onDelete: (plan: FinancialPlan) => void;
    onManageComponents: (plan: FinancialPlan) => void;
    onArchiveToggle: (plan: FinancialPlan) => void;
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

export function FinancialPlanTable({
    plans,
    currencies,
    actualsByPlanId,
    actualsLoading = false,
    attentionPlanIds,
    onView,
    onEdit,
    onDelete,
    onManageComponents,
    onArchiveToggle,
}: FinancialPlanTableProps) {
    const formatDate = useDateFormatter();
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-left">
                <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/70">
                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Plan
                        </th>
                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Type
                        </th>
                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Period
                        </th>
                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Target
                        </th>
                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Current
                        </th>
                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Status
                        </th>
                        <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Actions
                        </th>
                    </tr>
                </thead>

                <tbody>
                    {plans.map(plan => {
                        const currency =
                            currencies.get(
                                plan.currencyId
                            );

                        const result =
                            actualsByPlanId?.get(
                                plan.id
                            );
                        const headline = result
                            ? getPlanHeadlineActual(
                                  result,
                                  currency
                              )
                            : null;
                        const needsAttention =
                            attentionPlanIds?.has(
                                plan.id
                            ) ?? false;

                        return (
                            <tr
                                key={plan.id}
                                className="border-b border-slate-100 last:border-b-0"
                            >
                                <td className="px-5 py-4">
                                    <div className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                                        {plan.name}
                                        {needsAttention && (
                                            <span
                                                title="This plan needs attention"
                                                className="inline-flex text-amber-600"
                                            >
                                                <ShieldAlert
                                                    size={
                                                        13
                                                    }
                                                />
                                            </span>
                                        )}
                                    </div>

                                    <div className="mt-1 text-xs text-slate-400">
                                        {currency?.code ||
                                            plan.currencyId}
                                    </div>
                                </td>

                                <td className="px-5 py-4 text-sm text-slate-600">
                                    <div>
                                        {getPlanTypeLabel(
                                            plan.planType
                                        )}
                                    </div>
                                    <div className="mt-1 text-xs text-slate-400">
                                        {getFinancialPlanSubcategoryLabel(
                                            plan.planCategory,
                                            plan.planSubcategory
                                        )}
                                    </div>
                                </td>

                                <td className="px-5 py-4 text-sm text-slate-600">
                                    <div>
                                        {formatDate(plan.startDate)}
                                        {plan.endDate
                                            ? ` → ${formatDate(plan.endDate)}`
                                            : ""}
                                    </div>
                                    <div className="mt-1 text-xs text-slate-400">
                                        {getPlanPeriodTypeLabel(
                                            plan.periodType
                                        )}
                                    </div>
                                </td>

                                <td className="px-5 py-4 text-sm font-medium text-slate-800">
                                    {formatAmount(
                                        plan.targetAmount,
                                        currency
                                    )}
                                </td>

                                <td className="px-5 py-4 text-sm text-slate-800">
                                    {headline ? (
                                        <>
                                            <div className="font-medium">
                                                {
                                                    headline.value
                                                }
                                            </div>
                                            <div className="mt-1 text-xs text-slate-400">
                                                {
                                                    headline.label
                                                }
                                            </div>
                                        </>
                                    ) : actualsLoading ? (
                                        <span className="text-xs text-slate-300">
                                            …
                                        </span>
                                    ) : (
                                        <span className="text-xs text-slate-400">
                                            —
                                        </span>
                                    )}
                                </td>

                                <td className="px-5 py-4">
                                    <span
                                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getPlanStatusClasses(
                                            plan.status
                                        )}`}
                                    >
                                        {plan.status}
                                    </span>
                                </td>

                                <td className="px-5 py-4">
                                    <div className="flex justify-end gap-1">
                                        <button
                                            type="button"
                                            onClick={() =>
                                                onView(plan)
                                            }
                                            title="View financial plan"
                                            aria-label={`View ${plan.name}`}
                                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                                        >
                                            <Eye size={15} />
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() =>
                                                onManageComponents(plan)
                                            }
                                            title="Manage plan components"
                                            aria-label={`Manage components for ${plan.name}`}
                                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                                        >
                                            <Layers size={15} />
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() =>
                                                onEdit(plan)
                                            }
                                            title="Edit financial plan"
                                            aria-label={`Edit ${plan.name}`}
                                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                                        >
                                            <Pencil size={15} />
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() =>
                                                onArchiveToggle(plan)
                                            }
                                            title={
                                                canRestorePlan(plan)
                                                    ? "Restore financial plan"
                                                    : "Archive financial plan"
                                            }
                                            aria-label={
                                                canRestorePlan(plan)
                                                    ? `Restore ${plan.name}`
                                                    : `Archive ${plan.name}`
                                            }
                                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                                        >
                                            {canRestorePlan(plan) ? (
                                                <ArchiveRestore size={15} />
                                            ) : (
                                                <Archive size={15} />
                                            )}
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() =>
                                                onDelete(plan)
                                            }
                                            title="Delete financial plan"
                                            aria-label={`Delete ${plan.name}`}
                                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-white text-red-600 transition-colors hover:bg-red-50"
                                        >
                                            <Trash2 size={15} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
