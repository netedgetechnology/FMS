import { useCallback, useMemo, useState } from "react";
import { Plus } from "lucide-react";

import {
    AddFinancialGoalDialog,
    DeleteFinancialGoalDialog,
    EditFinancialGoalDialog,
    FinancialGoalTable,
    ManageGoalAccountLinksDialog,
    ManageGoalCategoryLinksDialog,
    ManageGoalLoanLinksDialog,
    ManageGoalInvestmentLinksDialog,
    ViewFinancialGoalDialog,
} from "../components";

import {
    useFinancialGoals,
    useGoalActualsBatch,
} from "../hooks";

import type {
    FinancialGoal,
} from "../types";

import { isLinkedGoalMode } from "../constants";

import {
    useCurrencies,
} from "@/modules/currencies/hooks/useCurrencies";

export function FinancialGoalsPage() {
    const {
        goals,
        loading,
        createGoal,
        updateGoal,
        deleteGoal,
    } = useFinancialGoals();

    const {
        currencies,
        loading: currenciesLoading,
    } = useCurrencies();

    const {
        resultsByGoalId,
        loading: actualsLoading,
        refresh: refreshActuals,
    } = useGoalActualsBatch(goals.length > 0);

    const [addOpen, setAddOpen] =
        useState(false);

    const [viewGoal, setViewGoal] =
        useState<FinancialGoal | null>(null);

    const [editGoal, setEditGoal] =
        useState<FinancialGoal | null>(null);

    const [deleteGoalState, setDeleteGoalState] =
        useState<FinancialGoal | null>(null);

    const [managingAccountsGoal, setManagingAccountsGoal] =
        useState<FinancialGoal | null>(null);

    const [managingCategoriesGoal, setManagingCategoriesGoal] =
        useState<FinancialGoal | null>(null);

    const [managingLoansGoal, setManagingLoansGoal] =
        useState<FinancialGoal | null>(null);

    const [managingInvestmentsGoal, setManagingInvestmentsGoal] =
        useState<FinancialGoal | null>(null);

    const handleManageLinks = useCallback(
        (goal: FinancialGoal) => {
            if (
                goal.goalMode ===
                "CATEGORY_CONTRIBUTION_LINKED"
            ) {
                setManagingCategoriesGoal(goal);
            } else if (
                goal.goalMode === "LOAN_PAYOFF_LINKED"
            ) {
                setManagingLoansGoal(goal);
            } else if (
                goal.goalMode === "INVESTMENT_LINKED"
            ) {
                setManagingInvestmentsGoal(goal);
            } else {
                setManagingAccountsGoal(goal);
            }
        },
        []
    );

    const currencySymbols = useMemo(() => {
        return currencies.reduce<Record<string, string>>(
            (result, currency) => {
                result[currency.id] = currency.symbol;
                return result;
            },
            {}
        );
    }, [currencies]);

    const isLoading =
        loading || currenciesLoading;

    // createGoal / updateGoal / deleteGoal already refresh the goal
    // list themselves (useFinancialGoals) - also refresh actuals so a
    // new/edited/deleted goal's computed progress is never stale.
    const handleCreate = useCallback(
        async (
            request: Parameters<typeof createGoal>[0]
        ) => {
            await createGoal(request);
            await refreshActuals();
        },
        [createGoal, refreshActuals]
    );

    const handleUpdate = useCallback(
        async (
            request: Parameters<typeof updateGoal>[0]
        ) => {
            await updateGoal(request);
            await refreshActuals();
        },
        [updateGoal, refreshActuals]
    );

    const handleDelete = useCallback(
        async (id: string) => {
            await deleteGoal(id);
            await refreshActuals();
        },
        [deleteGoal, refreshActuals]
    );

    const linkedResultForView =
        viewGoal &&
        isLinkedGoalMode(viewGoal.goalMode)
            ? (resultsByGoalId.get(viewGoal.id) ??
              null)
            : null;

    return (
        <div className="space-y-6">

            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">

                <div>
                    <h1 className="text-2xl font-bold text-slate-900">
                        Financial Goals
                    </h1>

                    <p className="mt-1 text-sm text-slate-500">
                        Set, track, and manage your financial goals.
                    </p>
                </div>

                <button
                    type="button"
                    onClick={() => setAddOpen(true)}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
                >
                    <Plus size={17} />
                    Add Financial Goal
                </button>

            </div>

            <div className="grid gap-4 sm:grid-cols-3">

                <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <p className="text-sm text-slate-500">
                        Total Goals
                    </p>

                    <p className="mt-1 text-2xl font-bold text-slate-900">
                        {goals.length}
                    </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <p className="text-sm text-slate-500">
                        Active Goals
                    </p>

                    <p className="mt-1 text-2xl font-bold text-slate-900">
                        {
                            goals.filter(
                                goal =>
                                    goal.status === "ACTIVE"
                            ).length
                        }
                    </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <p className="text-sm text-slate-500">
                        Completed Goals
                    </p>

                    <p className="mt-1 text-2xl font-bold text-slate-900">
                        {
                            goals.filter(
                                goal =>
                                    goal.status === "COMPLETED"
                            ).length
                        }
                    </p>
                </div>

            </div>

            {isLoading ? (
                <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
                    <p className="text-sm text-slate-500">
                        Loading financial goals...
                    </p>
                </div>
            ) : (
                <FinancialGoalTable
                    goals={goals}
                    currencySymbols={currencySymbols}
                    actualsByGoalId={resultsByGoalId}
                    actualsLoading={actualsLoading}
                    onView={setViewGoal}
                    onEdit={setEditGoal}
                    onDelete={setDeleteGoalState}
                    onManageLinks={
                        handleManageLinks
                    }
                />
            )}

            <AddFinancialGoalDialog
                open={addOpen}
                onClose={() => setAddOpen(false)}
                onCreate={handleCreate}
            />

            <ViewFinancialGoalDialog
                open={viewGoal !== null}
                goal={viewGoal}
                currencySymbols={currencySymbols}
                linkedResult={linkedResultForView}
                onClose={() => setViewGoal(null)}
            />

            <EditFinancialGoalDialog
                open={editGoal !== null}
                goal={editGoal}
                onClose={() => setEditGoal(null)}
                onUpdate={handleUpdate}
            />

            <DeleteFinancialGoalDialog
                open={deleteGoalState !== null}
                goal={deleteGoalState}
                onClose={() => setDeleteGoalState(null)}
                onDelete={handleDelete}
            />

            <ManageGoalAccountLinksDialog
                open={managingAccountsGoal !== null}
                goal={managingAccountsGoal}
                onClose={() =>
                    setManagingAccountsGoal(null)
                }
                onChanged={refreshActuals}
            />

            <ManageGoalCategoryLinksDialog
                open={managingCategoriesGoal !== null}
                goal={managingCategoriesGoal}
                onClose={() =>
                    setManagingCategoriesGoal(null)
                }
                onChanged={refreshActuals}
            />

            <ManageGoalLoanLinksDialog
                open={managingLoansGoal !== null}
                goal={managingLoansGoal}
                onClose={() =>
                    setManagingLoansGoal(null)
                }
                onChanged={refreshActuals}
            />

            <ManageGoalInvestmentLinksDialog
                open={managingInvestmentsGoal !== null}
                goal={managingInvestmentsGoal}
                onClose={() =>
                    setManagingInvestmentsGoal(null)
                }
                onChanged={refreshActuals}
            />

        </div>
    );
}

