import { useMemo, useState } from "react";
import { Plus } from "lucide-react";

import {
    AddFinancialGoalDialog,
    DeleteFinancialGoalDialog,
    EditFinancialGoalDialog,
    FinancialGoalTable,
    ViewFinancialGoalDialog,
} from "../components";

import {
    useFinancialGoals,
} from "../hooks";

import type {
    FinancialGoal,
} from "../types";

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

    const [addOpen, setAddOpen] =
        useState(false);

    const [viewGoal, setViewGoal] =
        useState<FinancialGoal | null>(null);

    const [editGoal, setEditGoal] =
        useState<FinancialGoal | null>(null);

    const [deleteGoalState, setDeleteGoalState] =
        useState<FinancialGoal | null>(null);

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
                    onView={setViewGoal}
                    onEdit={setEditGoal}
                    onDelete={setDeleteGoalState}
                />
            )}

            <AddFinancialGoalDialog
                open={addOpen}
                onClose={() => setAddOpen(false)}
                onCreate={createGoal}
            />

            <ViewFinancialGoalDialog
                open={viewGoal !== null}
                goal={viewGoal}
                currencySymbols={currencySymbols}
                onClose={() => setViewGoal(null)}
            />

            <EditFinancialGoalDialog
                open={editGoal !== null}
                goal={editGoal}
                onClose={() => setEditGoal(null)}
                onUpdate={updateGoal}
            />

            <DeleteFinancialGoalDialog
                open={deleteGoalState !== null}
                goal={deleteGoalState}
                onClose={() => setDeleteGoalState(null)}
                onDelete={deleteGoal}
            />

        </div>
    );
}
