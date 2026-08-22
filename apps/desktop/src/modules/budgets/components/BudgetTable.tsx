import { Eye, Pencil, Trash2 } from "lucide-react";

import type { Budget } from "../types";

export interface BudgetTableProps {
    budgets: Budget[];
    currencies: Map<string, { code: string; name?: string | null }>;
    categories: Map<string, string>;
    businessEntities: Map<string, string>;
    onView: (budget: Budget) => void;
    onEdit: (budget: Budget) => void;
    onDelete: (budget: Budget) => void;
}

function formatAmount(
    amount: number,
    currencyCode?: string
) {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: currencyCode || "INR",
        maximumFractionDigits: 2,
    }).format(Number(amount));
}

function formatPeriod(
    periodType: Budget["periodType"]
) {
    switch (periodType) {
        case "MONTHLY":
            return "Monthly";
        case "QUARTERLY":
            return "Quarterly";
        case "YEARLY":
            return "Yearly";
        case "CUSTOM":
            return "Custom";
        default:
            return periodType;
    }
}

export function BudgetTable({
    budgets,
    currencies,
    categories,
    businessEntities,
    onView,
    onEdit,
    onDelete,
}: BudgetTableProps) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-left">
                <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/70">
                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Budget
                        </th>

                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Category
                        </th>

                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Period
                        </th>

                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Amount
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
                    {budgets.map(budget => {
                        const currency =
                            currencies.get(
                                budget.currencyId
                            );

                        const categoryName =
                            budget.categoryId
                                ? categories.get(
                                      budget.categoryId
                                  )
                                : undefined;

                        const businessEntityName =
                            budget.businessEntityId
                                ? businessEntities.get(
                                      budget.businessEntityId
                                  )
                                : undefined;

                        return (
                            <tr
                                key={budget.id}
                                className="border-b border-slate-100 last:border-b-0"
                            >
                                <td className="px-5 py-4">
                                    <div className="text-sm font-medium text-slate-900">
                                        {budget.name}
                                    </div>

                                    <div className="mt-1 text-xs text-slate-400">
                                        {currency?.code ||
                                            budget.currencyId}
                                    </div>
                                </td>

                                <td className="px-5 py-4">
                                    <div className="text-sm text-slate-600">
                                        {categoryName ||
                                            "All Categories"}
                                    </div>

                                    {businessEntityName && (
                                        <div className="mt-1 text-xs text-slate-400">
                                            {businessEntityName}
                                        </div>
                                    )}
                                </td>

                                <td className="px-5 py-4">
                                    <div className="text-sm text-slate-600">
                                        {formatPeriod(
                                            budget.periodType
                                        )}
                                    </div>

                                    <div className="mt-1 text-xs text-slate-400">
                                        {budget.startDate}
                                        {budget.endDate
                                            ? ` → ${budget.endDate}`
                                            : ""}
                                    </div>
                                </td>

                                <td className="px-5 py-4">
                                    <div className="text-sm font-medium text-slate-800">
                                        {formatAmount(
                                            budget.amount,
                                            currency?.code
                                        )}
                                    </div>

                                    <div className="mt-1 text-xs text-slate-400">
                                        Alert at{" "}
                                        {
                                            budget.alertThreshold
                                        }
                                        %
                                    </div>
                                </td>

                                <td className="px-5 py-4">
                                    <span
                                        className={
                                            budget.isActive
                                                ? "inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
                                                : "inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-400"
                                        }
                                    >
                                        {budget.isActive
                                            ? "Active"
                                            : "Inactive"}
                                    </span>
                                </td>

                                <td className="px-5 py-4">
                                    <div className="flex justify-end gap-1">
                                        <button
                                            type="button"
                                            onClick={() =>
                                                onView(
                                                    budget
                                                )
                                            }
                                            title="View budget"
                                            aria-label={`View ${budget.name}`}
                                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                                        >
                                            <Eye size={15} />
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() =>
                                                onEdit(
                                                    budget
                                                )
                                            }
                                            title="Edit budget"
                                            aria-label={`Edit ${budget.name}`}
                                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                                        >
                                            <Pencil size={15} />
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() =>
                                                onDelete(
                                                    budget
                                                )
                                            }
                                            title="Delete budget"
                                            aria-label={`Delete ${budget.name}`}
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
