import { useMemo, useState } from "react";
import { Plus } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/common";

import { useCurrencies } from "@/modules/currencies/hooks/useCurrencies";

import { useFinancialPlans } from "../hooks";

import {
    AddFinancialPlanDialog,
    DeleteFinancialPlanDialog,
    EditFinancialPlanDialog,
    FinancialPlanTable,
    ViewFinancialPlanDialog,
} from "../components";

import type { FinancialPlan } from "../types";

export default function FinancialPlansPage() {
    const {
        plans,
        loading,
        error,
        refresh,
    } = useFinancialPlans();

    const {
        currencies,
    } = useCurrencies();

    const [search, setSearch] = useState("");

    const [adding, setAdding] = useState(false);

    const [viewingPlan, setViewingPlan] =
        useState<FinancialPlan | null>(null);

    const [editingPlan, setEditingPlan] =
        useState<FinancialPlan | null>(null);

    const [deletingPlan, setDeletingPlan] =
        useState<FinancialPlan | null>(null);

    const currencyMap = useMemo(
        () =>
            new Map(
                currencies.map(currency => [
                    currency.id,
                    currency,
                ])
            ),
        [currencies]
    );

    const filteredPlans = useMemo(() => {
        const query = search.trim().toLowerCase();

        if (!query) {
            return plans;
        }

        return plans.filter(plan =>
            [
                plan.name,
                plan.planType,
                plan.status,
                plan.startDate,
                plan.endDate ?? "",
                currencyMap.get(plan.currencyId)?.code ?? "",
            ]
                .join(" ")
                .toLowerCase()
                .includes(query)
        );
    }, [plans, search, currencyMap]);

    return (
        <div className="min-h-full bg-white">
            <div className="mx-auto w-full max-w-[1400px] px-8 py-8">

                <PageHeader
                    title="Financial Plans"

                    actions={
                        <button
                            type="button"
                            onClick={() => setAdding(true)}
                            className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-800"
                        >
                            <Plus size={16} />
                            Add Financial Plan
                        </button>
                    }
                />

                <section className="mt-8 rounded-2xl border border-slate-100 bg-white">

                    <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
                        <div>
                            <h2 className="text-sm font-semibold text-slate-900">
                                Financial Plans
                            </h2>

                            <p className="mt-1 text-xs text-slate-400">
                                {plans.length}{" "}
                                {plans.length === 1
                                    ? "plan"
                                    : "plans"}
                            </p>
                        </div>

                        <div className="w-[280px]">
                            <input
                                type="search"
                                value={search}
                                onChange={event =>
                                    setSearch(
                                        event.target.value
                                    )
                                }
                                placeholder="Search financial plans..."
                                className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:border-slate-500"
                            />
                        </div>
                    </div>

                    {loading && (
                        <div className="flex min-h-[240px] items-center justify-center">
                            <p className="text-sm text-slate-400">
                                Loading financial plans...
                            </p>
                        </div>
                    )}

                    {!loading && error && (
                        <div className="flex min-h-[240px] items-center justify-center">
                            <p className="text-sm text-red-500">
                                {error}
                            </p>
                        </div>
                    )}

                    {!loading &&
                        !error &&
                        plans.length === 0 && (
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-12">
                                <EmptyState
                                    title="No financial plans yet"
                                    description="Create your first financial plan to start organizing your financial objectives."
                                />
                            </div>
                        )}

                    {!loading &&
                        !error &&
                        plans.length > 0 &&
                        filteredPlans.length === 0 && (
                            <div className="flex min-h-[180px] items-center justify-center">
                                <p className="text-sm text-slate-400">
                                    No financial plans match your search.
                                </p>
                            </div>
                        )}

                    {!loading &&
                        !error &&
                        filteredPlans.length > 0 && (
                            <div className="overflow-hidden rounded-b-2xl">
                                <FinancialPlanTable
                                    plans={filteredPlans}
                                    currencies={currencyMap}
                                    onView={setViewingPlan}
                                    onEdit={setEditingPlan}
                                    onDelete={setDeletingPlan}
                                />
                            </div>
                        )}
                </section>

                <AddFinancialPlanDialog
                    currencies={currencies}
                    open={adding}
                    onOpenChange={setAdding}
                    onSuccess={refresh}
                />

                <ViewFinancialPlanDialog
                    plan={viewingPlan}
                    currency={
                        viewingPlan
                            ? currencyMap.get(
                                  viewingPlan.currencyId
                              )
                            : undefined
                    }
                    open={viewingPlan !== null}
                    onOpenChange={open => {
                        if (!open) {
                            setViewingPlan(null);
                        }
                    }}
                />

                <EditFinancialPlanDialog
                    plan={editingPlan}
                    currencies={currencies}
                    open={editingPlan !== null}
                    onOpenChange={open => {
                        if (!open) {
                            setEditingPlan(null);
                        }
                    }}
                    onSuccess={refresh}
                />

                <DeleteFinancialPlanDialog
                    plan={deletingPlan}
                    open={deletingPlan !== null}
                    onOpenChange={open => {
                        if (!open) {
                            setDeletingPlan(null);
                        }
                    }}
                    onSuccess={refresh}
                />

            </div>
        </div>
    );
}

