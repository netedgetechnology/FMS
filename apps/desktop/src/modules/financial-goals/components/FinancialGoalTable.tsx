import { Eye, Pencil, Trash2 } from "lucide-react";

import type { FinancialGoal } from "../types";
import {
    getFinancialGoalCategory,
    getFinancialGoalSubcategoryLabel,
} from "../constants";

interface FinancialGoalTableProps {
    goals: FinancialGoal[];
    currencySymbols: Record<string, string>;
    onView: (goal: FinancialGoal) => void;
    onEdit: (goal: FinancialGoal) => void;
    onDelete: (goal: FinancialGoal) => void;
}

function formatAmount(
    amount: number,
    currencySymbol: string
): string {
    return `${currencySymbol}${amount.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

function formatDate(date: string | null): string {
    if (!date) {
        return "—";
    }

    const parsed = new Date(date);

    if (Number.isNaN(parsed.getTime())) {
        return date;
    }

    return parsed.toLocaleDateString();
}

function getProgress(goal: FinancialGoal): number {
    if (goal.targetAmount <= 0) {
        return 0;
    }

    return Math.min(
        100,
        Math.max(
            0,
            (goal.currentAmount / goal.targetAmount) * 100
        )
    );
}

function getStatusClasses(
    status: FinancialGoal["status"]
): string {
    switch (status) {
        case "ACTIVE":
            return "bg-emerald-50 text-emerald-700";

        case "COMPLETED":
            return "bg-blue-50 text-blue-700";

        case "PAUSED":
            return "bg-amber-50 text-amber-700";

        case "CANCELLED":
            return "bg-red-50 text-red-700";

        default:
            return "bg-slate-50 text-slate-700";
    }
}

export function FinancialGoalTable({
    goals,
    currencySymbols,
    onView,
    onEdit,
    onDelete,
}: FinancialGoalTableProps) {
    if (goals.length === 0) {
        return (
            <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">

                <p className="text-base font-semibold text-slate-900">
                    No financial goals yet
                </p>

                <p className="mt-1 text-sm text-slate-500">
                    Create your first financial goal to start tracking progress.
                </p>

            </div>
        );
    }

    return (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">

            <div className="overflow-x-auto">

                <table className="w-full min-w-[1050px] text-left">

                    <thead className="border-b border-slate-200 bg-slate-50">

                        <tr>

                            <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Goal
                            </th>

                            <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Category
                            </th>

                            <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Target
                            </th>

                            <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Current
                            </th>

                            <th className="w-44 px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Progress
                            </th>

                            <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Target Date
                            </th>

                            <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Status
                            </th>

                            <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Actions
                            </th>

                        </tr>

                    </thead>

                    <tbody className="divide-y divide-slate-100">

                        {goals.map((goal) => {

                            const progress = getProgress(goal);

                            const currencySymbol =
                                currencySymbols[goal.currencyId] ?? "";

                            return (
                                <tr
                                    key={goal.id}
                                    className="transition-colors hover:bg-slate-50/70"
                                >

                                    <td className="px-5 py-4">

                                        <div className="font-semibold text-slate-900">
                                            {goal.name}
                                        </div>

                                        <div className="mt-1 text-xs text-slate-500">
                                            {getFinancialGoalSubcategoryLabel(
                                                goal.goalCategory,
                                                goal.goalSubcategory
                                            )}
                                        </div>

                                    </td>

                                    <td className="px-5 py-4">

                                        <span className="text-sm text-slate-700">
                                            {getFinancialGoalCategory(goal.goalCategory)?.label ??
                                                goal.goalCategory}
                                        </span>

                                    </td>

                                    <td className="px-5 py-4">

                                        <span className="whitespace-nowrap text-sm font-medium text-slate-900">
                                            {formatAmount(
                                                goal.targetAmount,
                                                currencySymbol
                                            )}
                                        </span>

                                    </td>

                                    <td className="px-5 py-4">

                                        <span className="whitespace-nowrap text-sm text-slate-700">
                                            {formatAmount(
                                                goal.currentAmount,
                                                currencySymbol
                                            )}
                                        </span>

                                    </td>

                                    <td className="px-5 py-4">

                                        <div className="flex items-center gap-3">

                                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">

                                                <div
                                                    className="h-full rounded-full bg-blue-600"
                                                    style={{
                                                        width: `${progress}%`,
                                                    }}
                                                />

                                            </div>

                                            <span className="w-12 text-right text-xs font-semibold text-slate-700">
                                                {progress.toFixed(0)}%
                                            </span>

                                        </div>

                                    </td>

                                    <td className="px-5 py-4">

                                        <span className="whitespace-nowrap text-sm text-slate-700">
                                            {formatDate(goal.targetDate)}
                                        </span>

                                    </td>

                                    <td className="px-5 py-4">

                                        <span
                                            className={[
                                                "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
                                                getStatusClasses(goal.status),
                                            ].join(" ")}
                                        >
                                            {goal.status}
                                        </span>

                                    </td>

                                    <td className="px-5 py-4">

                                        <div className="flex items-center gap-1">

                                            <button
                                                type="button"
                                                onClick={() => onView(goal)}
                                                title="View goal"
                                                aria-label={`View ${goal.name}`}
                                                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                                            >
                                                <Eye size={15} />
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => onEdit(goal)}
                                                title="Edit goal"
                                                aria-label={`Edit ${goal.name}`}
                                                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                                            >
                                                <Pencil size={15} />
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => onDelete(goal)}
                                                title="Delete goal"
                                                aria-label={`Delete ${goal.name}`}
                                                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600"
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

        </div>
    );
}
