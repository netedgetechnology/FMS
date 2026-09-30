import {
    useCallback,
    useMemo,
    useState,
} from "react";
import { Plus, Search } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/common";
import { useMoneyFormatter } from "@/core/formatting";

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
    const [isSearchOpen, setIsSearchOpen] = useState(false);

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

    const formatMoneyValue = useMoneyFormatter();

    // Amount cards are shown in a single currency scope - mirrors the
    // established multi-currency pattern used by the dashboard's budget
    // overview (resolveBudgetCurrencyScopes): the default currency when
    // plans exist in it, otherwise the first currency (alphabetically,
    // default-first) that plans actually use. Amounts are never summed
    // or converted across currencies.
    const primaryCurrencyId = useMemo(() => {
        const distinctIds = Array.from(
            new Set(plans.map(plan => plan.currencyId))
        );

        if (distinctIds.length === 0) {
            const fallback =
                currencies.find(
                    currency => currency.isDefault
                ) ?? currencies[0];
            return fallback?.id ?? null;
        }

        return distinctIds.sort((a, b) => {
            const left = currencyMap.get(a);
            const right = currencyMap.get(b);

            if (left?.isDefault && !right?.isDefault) {
                return -1;
            }
            if (right?.isDefault && !left?.isDefault) {
                return 1;
            }
            return (left?.code ?? a).localeCompare(
                right?.code ?? b
            );
        })[0];
    }, [plans, currencies, currencyMap]);

    const primaryCurrency = primaryCurrencyId
        ? currencyMap.get(primaryCurrencyId)
        : undefined;

    const currencyScopePlans = useMemo(
        () =>
            primaryCurrencyId
                ? plans.filter(
                      plan =>
                          plan.currencyId ===
                          primaryCurrencyId
                  )
                : [],
        [plans, primaryCurrencyId]
    );

    const hasOtherCurrencies =
        currencyScopePlans.length < plans.length;

    /** Target-amount totals for the summary cards' secondary values,
     *  scoped to primaryCurrencyId only - never summed across
     *  currencies. */
    const amountSummary = useMemo(() => {
        let totalTarget = 0;
        let activeTarget = 0;
        let completedTarget = 0;
        let attentionTarget = 0;

        for (const plan of currencyScopePlans) {
            const target = plan.targetAmount ?? 0;
            totalTarget += target;

            if (plan.status === "ACTIVE") {
                activeTarget += target;
            }
            if (plan.status === "COMPLETED") {
                completedTarget += target;
            }
            if (attentionPlanIds.has(plan.id)) {
                attentionTarget += target;
            }
        }

        return {
            totalTarget,
            activeTarget,
            completedTarget,
            attentionTarget,
        };
    }, [currencyScopePlans, attentionPlanIds]);

    const formatCardAmount = (amount: number) =>
        primaryCurrency
            ? formatMoneyValue(amount, primaryCurrency.code)
            : "—";

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

                <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
                    <PlanSummaryCard
                        title="Total Plans"
                        count={statusCounts.ALL}
                        amount={formatCardAmount(
                            amountSummary.totalTarget
                        )}
                    />

                    <PlanSummaryCard
                        title="Active Plans"
                        count={statusCounts.ACTIVE}
                        amount={formatCardAmount(
                            amountSummary.activeTarget
                        )}
                    />

                    <PlanSummaryCard
                        title="Needs Attention"
                        count={attentionCount}
                        amount={formatCardAmount(
                            amountSummary.attentionTarget
                        )}
                        emphasis={attentionCount > 0}
                    />

                    <PlanSummaryCard
                        title="Completed Plans"
                        count={statusCounts.COMPLETED}
                        amount={formatCardAmount(
                            amountSummary.completedTarget
                        )}
                    />
                </div>

                {hasOtherCurrencies && (
                    <p className="mt-2 text-xs text-slate-400">
                        Showing totals in{" "}
                        {primaryCurrency?.code ??
                            "the default currency"}{" "}
                        only — plans in other currencies
                        are not included.
                    </p>
                )}

                <section className="mt-8 rounded-2xl border border-slate-100 bg-white">

                    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
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
                        </div>

                        <div className="flex flex-wrap items-start justify-end gap-3">
                            {isSearchOpen && (
                                <div
                                    className="
                                        flex
                                        h-11
                                        w-[315px]
                                        items-center
                                        rounded-2xl
                                        border
                                        border-slate-200
                                        bg-slate-50
                                        px-4
                                        transition-all
                                        duration-200
                                        focus-within:border-slate-300
                                        focus-within:bg-white
                                        focus-within:shadow-sm
                                    "
                                >
                                    <input
                                        type="search"
                                        autoFocus
                                        value={search}
                                        onChange={event =>
                                            setSearch(
                                                event
                                                    .target
                                                    .value
                                            )
                                        }
                                        placeholder="Search financial plans..."
                                        className="
                                            w-full
                                            bg-transparent
                                            text-sm
                                            text-slate-700
                                            outline-none
                                            placeholder:text-slate-400
                                        "
                                    />
                                </div>
                            )}

                            <button
                                type="button"
                                onClick={() =>
                                    setIsSearchOpen(
                                        open => !open
                                    )
                                }
                                aria-label="Search financial plans"
                                aria-expanded={
                                    isSearchOpen
                                }
                                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-500 transition-all duration-200 hover:border-slate-300 hover:bg-white hover:text-slate-700"
                            >
                                <Search size={18} />
                            </button>
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

/**
 * Plan-count card with a smaller, secondary target-amount line
 * underneath. StatCard (@/components/common) only supports one value,
 * so this local variant covers the count + amount pairing without
 * changing the shared component.
 */
function PlanSummaryCard({
    title,
    count,
    amount,
    emphasis = false,
}: {
    title: string;
    count: number;
    amount: string;
    emphasis?: boolean;
}) {
    return (
        <div className="rounded-xl border-transparent bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">
                {title}
            </div>

            <div
                className={`mt-3 text-3xl font-bold ${
                    emphasis
                        ? "text-amber-600"
                        : "text-slate-900"
                }`}
            >
                {count}
            </div>

            <div className="mt-1 text-sm font-normal text-slate-400">
                {amount}
            </div>
        </div>
    );
}

