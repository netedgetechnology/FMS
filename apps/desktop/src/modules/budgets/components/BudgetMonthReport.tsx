import { useMemo, type ReactNode } from "react";
import { Eye, Pencil, Trash2 } from "lucide-react";

import { useMoneyFormatter } from "@/core/formatting";

import type { Budget } from "../types";
import type { BudgetSpendingSummary } from "../services";
import {
    buildBudgetReportRows,
    filterBudgetReportRows,
    formatPercentUsed,
    type BudgetReportRow,
    type BudgetStatusKey,
} from "../services";

export interface BudgetMonthReportProps {
    summary: BudgetSpendingSummary;
    /** ISO code of the currency this section reports in (e.g. "INR"). */
    currencyCode?: string;
    /** Show the currency heading (only needed when >1 currency scope). */
    showCurrencyHeading: boolean;
    monthLabel: string;
    categoryNameById: Map<string, string>;
    budgetsById: Map<string, Budget>;
    search: string;
    onView: (budget: Budget) => void;
    onEdit: (budget: Budget) => void;
    onDelete: (budget: Budget) => void;
    onAddBudget: () => void;
}

const STATUS_CLASSES: Record<BudgetStatusKey, string> = {
    over: "bg-red-50 text-red-700",
    approaching: "bg-amber-50 text-amber-700",
    "on-track": "bg-emerald-50 text-emerald-700",
    "no-spending": "bg-slate-100 text-slate-500",
};

export function BudgetMonthReport({
    summary,
    currencyCode,
    showCurrencyHeading,
    monthLabel,
    categoryNameById,
    budgetsById,
    search,
    onView,
    onEdit,
    onDelete,
    onAddBudget,
}: BudgetMonthReportProps) {
    const formatMoney = useMoneyFormatter();

    const money = (value: number) =>
        formatMoney(value, currencyCode);

    const rows = useMemo(
        () =>
            buildBudgetReportRows(
                summary,
                categoryNameById
            ),
        [summary, categoryNameById]
    );

    const visibleRows = useMemo(
        () => filterBudgetReportRows(rows, search),
        [rows, search]
    );

    const hasBudgets = rows.length > 0;

    return (
        <section className="rounded-2xl border border-slate-100 bg-white">

            {showCurrencyHeading && (
                <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
                    <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                        {currencyCode ?? "—"}
                    </span>

                    <span className="text-xs text-slate-400">
                        Budgets and spending in{" "}
                        {currencyCode ?? "this currency"}
                    </span>
                </div>
            )}

            {/* --- summary --- */}
            <div className="border-b border-slate-100 px-5 py-5">
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    <SummaryTile
                        label="Total Budget"
                        value={money(
                            summary.totalBudgetAmount
                        )}
                    />

                    <SummaryTile
                        label="Actual Spending"
                        value={money(
                            summary.budgetedActual
                        )}
                        hint={`Total spending this month: ${money(
                            summary.totalExpense
                        )}`}
                    />

                    <SummaryTile
                        label="Remaining"
                        value={money(
                            summary.totalRemaining
                        )}
                        tone={
                            summary.totalRemaining < 0
                                ? "negative"
                                : "default"
                        }
                    />

                    <SummaryTile
                        label="% Used"
                        value={formatPercentUsed(
                            summary.totalPercentageUsed,
                            summary.totalBudgetAmount
                        )}
                        tone={
                            summary.totalBudgetAmount >
                                0 &&
                            summary.totalPercentageUsed >
                                100
                                ? "negative"
                                : "default"
                        }
                    />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
                    <span>
                        Unbudgeted spending:{" "}
                        <span className="font-semibold text-slate-700">
                            {money(
                                summary.unbudgetedSpending
                            )}
                        </span>
                    </span>

                    <span>
                        Uncategorized:{" "}
                        <span className="font-semibold text-slate-700">
                            {money(
                                summary.uncategorizedSpending
                            )}
                        </span>{" "}
                        <span className="text-slate-400">
                            (included in unbudgeted)
                        </span>
                    </span>
                </div>
            </div>

            {/* --- table / empty --- */}
            {!hasBudgets && (
                <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
                    <p className="text-sm text-slate-500">
                        No budgets for {monthLabel}
                        {showCurrencyHeading &&
                        currencyCode
                            ? ` in ${currencyCode}`
                            : ""}
                        .
                    </p>

                    {summary.totalExpense > 0 && (
                        <p className="text-xs text-slate-400">
                            {money(
                                summary.totalExpense
                            )}{" "}
                            of spending this month is
                            shown as unbudgeted above.
                        </p>
                    )}

                    <button
                        type="button"
                        onClick={onAddBudget}
                        className="mt-1 inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
                    >
                        Add a budget
                    </button>
                </div>
            )}

            {hasBudgets &&
                visibleRows.length === 0 && (
                    <div className="flex min-h-[140px] items-center justify-center">
                        <p className="text-sm text-slate-400">
                            No budgets match your
                            search.
                        </p>
                    </div>
                )}

            {hasBudgets &&
                visibleRows.length > 0 && (
                    <div className="overflow-x-auto rounded-b-2xl">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="border-b border-slate-100 bg-slate-50/70">
                                    <Th>Budget</Th>
                                    <Th align="right">
                                        Budgeted
                                    </Th>
                                    <Th align="right">
                                        Actual
                                    </Th>
                                    <Th align="right">
                                        Remaining
                                    </Th>
                                    <Th align="right">
                                        % Used
                                    </Th>
                                    <Th>Status</Th>
                                    <Th align="right">
                                        Actions
                                    </Th>
                                </tr>
                            </thead>

                            <tbody>
                                {visibleRows.map(
                                    row => {
                                        const budget =
                                            budgetsById.get(
                                                row.budgetId
                                            );

                                        return (
                                            <BudgetRow
                                                key={
                                                    row.budgetId
                                                }
                                                row={
                                                    row
                                                }
                                                budget={
                                                    budget
                                                }
                                                money={
                                                    money
                                                }
                                                onView={
                                                    onView
                                                }
                                                onEdit={
                                                    onEdit
                                                }
                                                onDelete={
                                                    onDelete
                                                }
                                            />
                                        );
                                    }
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
        </section>
    );
}

function SummaryTile({
    label,
    value,
    hint,
    tone = "default",
}: {
    label: string;
    value: string;
    hint?: string;
    tone?: "default" | "negative";
}) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-xs font-medium text-slate-500">
                {label}
            </div>

            <div
                className={
                    "mt-1 text-lg font-semibold tracking-tight " +
                    (tone === "negative"
                        ? "text-red-600"
                        : "text-slate-900")
                }
            >
                {value}
            </div>

            {hint && (
                <div className="mt-1 text-[11px] text-slate-400">
                    {hint}
                </div>
            )}
        </div>
    );
}

function Th({
    children,
    align = "left",
}: {
    children: ReactNode;
    align?: "left" | "right";
}) {
    return (
        <th
            className={
                "px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 " +
                (align === "right"
                    ? "text-right"
                    : "text-left")
            }
        >
            {children}
        </th>
    );
}

function BudgetRow({
    row,
    budget,
    money,
    onView,
    onEdit,
    onDelete,
}: {
    row: BudgetReportRow;
    budget: Budget | undefined;
    money: (value: number) => string;
    onView: (budget: Budget) => void;
    onEdit: (budget: Budget) => void;
    onDelete: (budget: Budget) => void;
}) {
    return (
        <tr className="border-b border-slate-100 last:border-b-0">
            <td className="px-5 py-4">
                <div className="text-sm font-medium text-slate-900">
                    {row.budgetName}
                </div>

                <div className="mt-1 text-xs text-slate-400">
                    {row.categoryLabel}
                    {row.isOverallBudget
                        ? " · overall"
                        : ""}
                </div>
            </td>

            <td className="px-5 py-4 text-right text-sm text-slate-700">
                {money(row.budgetAmount)}
            </td>

            <td className="px-5 py-4 text-right text-sm text-slate-700">
                {money(row.actualAmount)}
            </td>

            <td
                className={
                    "px-5 py-4 text-right text-sm font-medium " +
                    (row.remainingAmount < 0
                        ? "text-red-600"
                        : "text-slate-700")
                }
            >
                {money(row.remainingAmount)}
            </td>

            <td
                className={
                    "px-5 py-4 text-right text-sm " +
                    (row.overBudget
                        ? "font-semibold text-red-600"
                        : "text-slate-700")
                }
            >
                {formatPercentUsed(
                    row.percentageUsed,
                    row.budgetAmount
                )}
            </td>

            <td className="px-5 py-4">
                <span
                    className={
                        "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold " +
                        STATUS_CLASSES[row.status.key]
                    }
                >
                    {row.status.label}
                </span>
            </td>

            <td className="px-5 py-4">
                <div className="flex justify-end gap-1">
                    <button
                        type="button"
                        onClick={() =>
                            budget && onView(budget)
                        }
                        disabled={!budget}
                        title="View budget"
                        aria-label={`View ${row.budgetName}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40"
                    >
                        <Eye size={15} />
                    </button>

                    <button
                        type="button"
                        onClick={() =>
                            budget && onEdit(budget)
                        }
                        disabled={!budget}
                        title="Edit budget"
                        aria-label={`Edit ${row.budgetName}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40"
                    >
                        <Pencil size={15} />
                    </button>

                    <button
                        type="button"
                        onClick={() =>
                            budget && onDelete(budget)
                        }
                        disabled={!budget}
                        title="Delete budget"
                        aria-label={`Delete ${row.budgetName}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-white text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40"
                    >
                        <Trash2 size={15} />
                    </button>
                </div>
            </td>
        </tr>
    );
}
