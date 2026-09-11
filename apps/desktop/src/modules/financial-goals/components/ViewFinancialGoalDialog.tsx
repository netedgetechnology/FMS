import { useDateFormatter } from "@/core/formatting";
import {
    isLinkedGoalMode,
    roleForGoalMode,
} from "../constants";
import type { FinancialGoal } from "../types";
import type { GoalCalcResult } from "../services";

interface ViewFinancialGoalDialogProps {
    open: boolean;
    goal: FinancialGoal | null;
    currencySymbols: Record<string, string>;
    /** Computed actuals, for any linked goal mode. */
    linkedResult?: GoalCalcResult | null;
    onClose: () => void;
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

export function ViewFinancialGoalDialog({
    open,
    goal,
    currencySymbols,
    linkedResult,
    onClose,
}: ViewFinancialGoalDialogProps) {
    const formatDate = useDateFormatter();
    if (!open || !goal) {
        return null;
    }

    const role = roleForGoalMode(goal.goalMode);
    const isLinked = isLinkedGoalMode(goal.goalMode);
    const isDebtPayoff = role === "LIABILITY";
    const isCategoryLinked =
        goal.goalMode ===
        "CATEGORY_CONTRIBUTION_LINKED";
    const isLoanLinked =
        goal.goalMode === "LOAN_PAYOFF_LINKED";
    const isInvestmentLinked =
        goal.goalMode === "INVESTMENT_LINKED";
    // Both DEBT_PAYOFF_LINKED and LOAN_PAYOFF_LINKED are "amount paid
    // off" goals - same label set and outstanding-debt display.
    const isDebtStyle = isDebtPayoff || isLoanLinked;

    const currencySymbol =
        currencySymbols[goal.currencyId] ?? "";

    const currentAmount = isLinked
        ? (linkedResult?.totals.currentAmount ?? 0)
        : goal.currentAmount;

    const progress = isLinked
        ? (linkedResult?.totals.progressPercentage ??
          0)
        : getProgress(goal);

    const remainingAmount = isLinked
        ? (linkedResult?.totals.remainingAmount ??
          Math.max(
              0,
              goal.targetAmount - currentAmount
          ))
        : Math.max(
              0,
              goal.targetAmount - goal.currentAmount
          );

    const outstandingDebt =
        linkedResult?.totals.outstandingDebt ?? 0;

    const targetLabel = isDebtStyle
        ? "Original Debt Target"
        : "Target Amount";
    const currentLabel = isDebtStyle
        ? "Amount Paid Off"
        : "Current Amount";
    const remainingLabel = isDebtStyle
        ? "Remaining Debt"
        : "Remaining Amount";
    const progressLabel = isDebtStyle
        ? "Percentage Paid Off"
        : "Progress";

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="view-financial-goal-title"
        >
            <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">

                <div className="border-b border-slate-100 px-6 py-5">

                    <div className="flex items-center justify-between">

                        <div>
                            <h2
                                id="view-financial-goal-title"
                                className="text-xl font-bold text-slate-900"
                            >
                                Financial Goal
                            </h2>

                            <p className="mt-1 text-sm text-slate-500">
                                View the details and progress of this goal.
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Close"
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                            ×
                        </button>

                    </div>

                </div>

                <div className="space-y-6 p-6">

                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Goal
                        </p>

                        <h3 className="mt-1 flex items-center gap-2 text-2xl font-bold text-slate-900">
                            {goal.name}

                            {isLinked && (
                                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-600">
                                    {isDebtPayoff
                                        ? "Debt-payoff goal"
                                        : isLoanLinked
                                          ? "Loan payoff goal"
                                          : isCategoryLinked
                                            ? "Category-linked goal"
                                            : isInvestmentLinked
                                              ? "Investment-linked goal"
                                              : "Savings goal"}{" "}
                                    · Auto-calculated
                                </span>
                            )}
                        </h3>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">

                        <div className="rounded-xl bg-slate-50 p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Category
                            </p>

                            <p className="mt-1 font-semibold text-slate-900">
                                {goal.goalCategory}
                            </p>
                        </div>

                        <div className="rounded-xl bg-slate-50 p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Subcategory
                            </p>

                            <p className="mt-1 font-semibold text-slate-900">
                                {goal.goalSubcategory}
                            </p>
                        </div>

                        <div className="rounded-xl bg-slate-50 p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                {targetLabel}
                            </p>

                            <p className="mt-1 font-semibold text-slate-900">
                                {formatAmount(
                                    goal.targetAmount,
                                    currencySymbol
                                )}
                            </p>
                        </div>

                        {isDebtStyle && (
                            <div className="rounded-xl bg-slate-50 p-4">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Outstanding Debt
                                    <span className="ml-1.5 normal-case text-blue-600">
                                        (auto-updated)
                                    </span>
                                </p>

                                <p className="mt-1 font-semibold text-slate-900">
                                    {formatAmount(
                                        outstandingDebt,
                                        currencySymbol
                                    )}
                                </p>
                            </div>
                        )}

                        <div className="rounded-xl bg-slate-50 p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                {currentLabel}
                                {isLinked && (
                                    <span className="ml-1.5 normal-case text-blue-600">
                                        (auto-updated)
                                    </span>
                                )}
                            </p>

                            <p className="mt-1 font-semibold text-slate-900">
                                {formatAmount(
                                    currentAmount,
                                    currencySymbol
                                )}
                            </p>
                        </div>

                        <div className="rounded-xl bg-slate-50 p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                {remainingLabel}
                            </p>

                            <p className="mt-1 font-semibold text-slate-900">
                                {formatAmount(
                                    remainingAmount,
                                    currencySymbol
                                )}
                            </p>
                        </div>

                        <div className="rounded-xl bg-slate-50 p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Target Date
                            </p>

                            <p className="mt-1 font-semibold text-slate-900">
                                {formatDate(goal.targetDate)}
                            </p>
                        </div>

                        <div className="rounded-xl bg-slate-50 p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Status
                            </p>

                            <p className="mt-1 font-semibold text-slate-900">
                                {goal.status}
                            </p>
                        </div>

                    </div>

                    <div>

                        <div className="mb-2 flex items-center justify-between">

                            <span className="text-sm font-semibold text-slate-700">
                                {progressLabel}
                            </span>

                            <span className="text-sm font-bold text-slate-900">
                                {progress.toFixed(1)}%
                            </span>

                        </div>

                        <div className="h-3 overflow-hidden rounded-full bg-slate-200">

                            <div
                                className="h-full rounded-full bg-blue-600 transition-all"
                                style={{
                                    width: `${progress}%`,
                                }}
                            />

                        </div>

                        {isLinked &&
                            (linkedResult?.warnings
                                .length ?? 0) > 0 && (
                                <div className="mt-3 rounded-xl bg-amber-50 p-3">
                                    <p className="text-xs font-semibold text-amber-700">
                                        {isCategoryLinked
                                            ? "Some contributions are excluded from this total:"
                                            : isLoanLinked
                                              ? "Some linked loans are excluded from this total:"
                                              : isInvestmentLinked
                                                ? "Some linked investments are excluded from this total:"
                                                : "Some linked accounts are excluded from this total:"}
                                    </p>
                                    <ul className="mt-1 space-y-0.5 text-xs text-amber-700">
                                        {linkedResult?.warnings.map(
                                            (
                                                warning,
                                                index
                                            ) => (
                                                <li
                                                    key={
                                                        index
                                                    }
                                                >
                                                    {
                                                        warning
                                                    }
                                                </li>
                                            )
                                        )}
                                    </ul>
                                </div>
                            )}

                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">

                        <div className="rounded-xl border border-slate-200 p-4">

                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Priority
                            </p>

                            <p className="mt-1 font-semibold text-slate-900">
                                {goal.priority}
                            </p>

                        </div>

                        <div className="rounded-xl border border-slate-200 p-4">

                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Goal Type
                            </p>

                            <p className="mt-1 font-semibold text-slate-900">
                                {goal.goalType}
                            </p>

                        </div>

                    </div>

                    {goal.notes ? (
                        <div className="rounded-xl border border-slate-200 p-4">

                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Notes
                            </p>

                            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                                {goal.notes}
                            </p>

                        </div>
                    ) : null}

                    <div className="flex justify-end border-t border-slate-100 pt-5">

                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
                        >
                            Close
                        </button>

                    </div>

                </div>

            </div>
        </div>
    );
}

