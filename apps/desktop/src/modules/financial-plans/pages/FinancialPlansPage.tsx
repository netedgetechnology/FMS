import {
    useCallback,
    useMemo,
    useState,
} from "react";
import { Plus } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/common";

import { useCurrencies } from "@/modules/currencies/hooks/useCurrencies";
import { useFinancialGoals } from "@/modules/financial-goals/hooks";

import {
    useFinancialPlans,
    usePlanActualsBatch,
} from "../hooks";

import {
    AddFinancialPlanDialog,
    ArchiveFinancialPlanDialog,
    DeleteFinancialPlanDialog,
    EditFinancialPlanDialog,
    FinancialPlanTable,
    ManagePlanComponentsDialog,
    ViewFinancialPlanDialog,
} from "../components";

import {
    checkPlanGoalIntegrity,
    countPlansByStatus,
    countPlansNeedingAttention,
    filterPlansByStatus,
    PLAN_STATUS_FILTERS,
    type PlanStatusFilter,
} from "../services";

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

    const { goals } = useFinancialGoals();

    const {
        resultsByPlanId,
        loading: actualsLoading,
        refresh: refreshActuals,
    } = usePlanActualsBatch(plans.length > 0);

    // A mutation can change both the plan list AND the list-level
    // actuals / attention counts, so refresh both after every dialog.
    const refreshAll = useCallback(async () => {
        await refresh();
        await refreshActuals();
    }, [refresh, refreshActuals]);

    const goalById = useMemo(
        () =>
            new Map(
                goals.map(goal => [goal.id, goal])
            ),
        [goals]
    );

    const goalNameById = useMemo(
        () =>
            new Map(
                goals.map(goal => [
                    goal.id,
                    goal.name,
                ])
            ),
        [goals]
    );

    /** Plans whose Goal link has drifted (deleted / currency mismatch). */
    const goalDriftPlanIds = useMemo(() => {
        const ids = new Set<string>();
        for (const plan of plans) {
            if (!plan.goalId) {
                continue;
            }
            const issues = checkPlanGoalIntegrity(
                plan,
                goalById.get(plan.goalId) ?? null
            );
            if (issues.length > 0) {
                ids.add(plan.id);
            }
        }
        return ids;
    }, [plans, goalById]);

    const attentionCount = useMemo(
        () =>
            countPlansNeedingAttention(
                plans,
                resultsByPlanId,
                goalDriftPlanIds
            ),
        [plans, resultsByPlanId, goalDriftPlanIds]
    );

    /** Non-archived plans that need attention, for the row indicator. */
    const attentionPlanIds = useMemo(() => {
        const ids = new Set<string>();
        for (const plan of plans) {
            if (plan.status === "ARCHIVED") {
                continue;
            }
            if (
                resultsByPlanId.get(plan.id)
                    ?.status === "INCOMPLETE" ||
                goalDriftPlanIds.has(plan.id)
            ) {
                ids.add(plan.id);
            }
        }
        return ids;
    }, [plans, resultsByPlanId, goalDriftPlanIds]);

    const [search, setSearch] = useState("");

    const [statusFilter, setStatusFilter] =
        useState<PlanStatusFilter>("ALL");

    const [adding, setAdding] = useState(false);

    const [viewingPlan, setViewingPlan] =
        useState<FinancialPlan | null>(null);

    const [editingPlan, setEditingPlan] =
        useState<FinancialPlan | null>(null);

    const [deletingPlan, setDeletingPlan] =
        useState<FinancialPlan | null>(null);

    const [managingPlan, setManagingPlan] =
        useState<FinancialPlan | null>(null);

    const [archivingPlan, setArchivingPlan] =
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

    const statusCounts = useMemo(
        () => countPlansByStatus(plans),
        [plans]
    );

    const filteredPlans = useMemo(() => {
        const byStatus = filterPlansByStatus(
            plans,
            statusFilter
        );

        const query = search.trim().toLowerCase();

        if (!query) {
            return byStatus;
        }

        return byStatus.filter(plan =>
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
    }, [plans, statusFilter, search, currencyMap]);

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

                    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
                        <div className="flex items-center gap-1">
                            {PLAN_STATUS_FILTERS.map(
                                option => (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() =>
                                            setStatusFilter(
                                                option.value
                                            )
                                        }
                                        className={`h-8 rounded-lg px-3 text-xs font-medium transition-colors ${
                                            statusFilter ===
                                            option.value
                                                ? "bg-slate-900 text-white"
                                                : "text-slate-500 hover:bg-slate-100"
                                        }`}
                                    >
                                        {option.label}
                                        <span className="ml-1.5 text-[11px] opacity-70">
                                            {
                                                statusCounts[
                                                    option
                                                        .value
                                                ]
                                            }
                                        </span>
                                    </button>
                                )
                            )}
                        </div>

                        <div className="flex items-center gap-3">
                            {attentionCount > 0 && (
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                                    {attentionCount}{" "}
                                    {attentionCount ===
                                    1
                                        ? "plan needs"
                                        : "plans need"}{" "}
                                    attention
                                </span>
                            )}

                            <div className="w-[280px]">
                                <input
                                    type="search"
                                    value={search}
                                    onChange={event =>
                                        setSearch(
                                            event
                                                .target
                                                .value
                                        )
                                    }
                                    placeholder="Search financial plans..."
                                    className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:border-slate-500"
                                />
                            </div>
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
                                    {search.trim()
                                        ? "No financial plans match your search."
                                        : statusFilter ===
                                            "ARCHIVED"
                                          ? "No archived plans."
                                          : `No ${statusFilter.toLowerCase()} plans — switch the filter to see the others.`}
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
                                    actualsByPlanId={
                                        resultsByPlanId
                                    }
                                    actualsLoading={
                                        actualsLoading
                                    }
                                    attentionPlanIds={
                                        attentionPlanIds
                                    }
                                    onView={setViewingPlan}
                                    onEdit={setEditingPlan}
                                    onDelete={setDeletingPlan}
                                    onManageComponents={
                                        setManagingPlan
                                    }
                                    onArchiveToggle={
                                        setArchivingPlan
                                    }
                                />
                            </div>
                        )}
                </section>

                <AddFinancialPlanDialog
                    currencies={currencies}
                    open={adding}
                    onOpenChange={setAdding}
                    onSuccess={refreshAll}
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
                    linkedGoalName={
                        viewingPlan?.goalId
                            ? goalNameById.get(
                                  viewingPlan.goalId
                              )
                            : undefined
                    }
                    linkedGoal={
                        viewingPlan?.goalId
                            ? goalById.get(
                                  viewingPlan.goalId
                              ) ?? null
                            : null
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
                    onSuccess={refreshAll}
                />

                <ManagePlanComponentsDialog
                    plan={managingPlan}
                    open={managingPlan !== null}
                    onOpenChange={open => {
                        if (!open) {
                            setManagingPlan(null);
                            // component edits change list-level actuals
                            void refreshActuals();
                        }
                    }}
                />

                <ArchiveFinancialPlanDialog
                    plan={archivingPlan}
                    open={archivingPlan !== null}
                    onOpenChange={open => {
                        if (!open) {
                            setArchivingPlan(null);
                        }
                    }}
                    onSuccess={refreshAll}
                />

                <DeleteFinancialPlanDialog
                    plan={deletingPlan}
                    open={deletingPlan !== null}
                    onOpenChange={open => {
                        if (!open) {
                            setDeletingPlan(null);
                        }
                    }}
                    onSuccess={refreshAll}
                />

            </div>
        </div>
    );
}

