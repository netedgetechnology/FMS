import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/common";
import {
    addMonths,
    currentMonth,
    formatMonthLabel,
    isSameMonth,
} from "@/core/formatting";

import { useAccounts } from "@/modules/accounts/hooks";
import { AccountType } from "@/modules/accounts/types";
import { useCategories } from "@/modules/categories/hooks";
import { useBusinessEntities } from "@/modules/business-entities/hooks";
import { useCurrencies } from "@/modules/currencies/hooks/useCurrencies";
import { useTransactions } from "@/modules/transactions/hooks";

import {
    useBudgets,
    useEmiInterestByTransactionId,
} from "../hooks";
import {
    calculateBudgetSpending,
    resolveBudgetCategoryLabel,
    resolveBudgetCurrencyScopes,
    selectBudgetsForMonth,
} from "../services";

import {
    AddBudgetDialog,
    BudgetMonthReport,
    DeleteBudgetDialog,
    EditBudgetDialog,
    ViewBudgetDialog,
} from "../components";

import type { Budget } from "../types";

export default function BudgetsPage() {
    const {
        budgets,
        loading: budgetsLoading,
        error: budgetsError,
        refresh,
    } = useBudgets();

    const {
        transactions,
        loading: transactionsLoading,
        error: transactionsError,
    } = useTransactions();

    const {
        emiInterestByTransactionId,
        loading: emiInterestLoading,
    } = useEmiInterestByTransactionId();

    const {
        accounts,
        loading: accountsLoading,
    } = useAccounts();

    const {
        categories,
        loading: categoriesLoading,
    } = useCategories();

    const {
        businessEntities,
        loading: businessEntitiesLoading,
    } = useBusinessEntities();

    const {
        currencies,
        loading: currenciesLoading,
    } = useCurrencies();

    const [search, setSearch] = useState("");

    // The calendar month the page is scoped to. Held as the first day of
    // that month at local midnight (see currentMonth / addMonths).
    // Defaults to the current calendar month.
    const [selectedMonth, setSelectedMonth] =
        useState<Date>(() => currentMonth());

    const goToPreviousMonth = () =>
        setSelectedMonth(month =>
            addMonths(month, -1)
        );

    const goToNextMonth = () =>
        setSelectedMonth(month =>
            addMonths(month, 1)
        );

    const goToCurrentMonth = () =>
        setSelectedMonth(currentMonth());

    const viewingCurrentMonth = isSameMonth(
        selectedMonth,
        currentMonth()
    );

    const monthLabel = formatMonthLabel(selectedMonth);

    const [adding, setAdding] =
        useState(false);

    const [viewingBudget, setViewingBudget] =
        useState<Budget | null>(null);

    const [editingBudget, setEditingBudget] =
        useState<Budget | null>(null);

    const [deletingBudget, setDeletingBudget] =
        useState<Budget | null>(null);

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

    const categoryNameById = useMemo(
        () =>
            new Map(
                categories.map(category => [
                    category.id,
                    category.name,
                ])
            ),
        [categories]
    );

    const businessEntityMap = useMemo(
        () =>
            new Map(
                businessEntities.map(entity => [
                    entity.id,
                    entity.name,
                ])
            ),
        [businessEntities]
    );

    const budgetsById = useMemo(
        () =>
            new Map(
                budgets.map(budget => [
                    budget.id,
                    budget,
                ])
            ),
        [budgets]
    );

    // Budgets whose date range covers the selected calendar month
    // (Phase 1 rule). Used only for headline counts and to decide which
    // currency sections to render - the spending engine re-applies the
    // same rule internally.
    const applicableBudgets = useMemo(
        () =>
            selectBudgetsForMonth(
                budgets,
                selectedMonth
            ),
        [budgets, selectedMonth]
    );

    // One Budget-vs-Actual section per currency that has an applicable
    // budget this month (or the default currency when none do). Amounts
    // are never converted or summed across currencies - see Phase 2.
    const currencyScopeIds = useMemo(
        () =>
            resolveBudgetCurrencyScopes(
                applicableBudgets,
                currencies
            ),
        [applicableBudgets, currencies]
    );

    // Ids of the CREDIT_CARD accounts, so the spending engine can drop a
    // bank -> credit-card bill payment without touching card purchases
    // (Phase 5 - transaction correctness).
    const creditCardAccountIds = useMemo(
        () =>
            new Set(
                accounts
                    .filter(
                        account =>
                            account.type ===
                            AccountType.CREDIT_CARD
                    )
                    .map(account => account.id)
            ),
        [accounts]
    );

    const scopeSummaries = useMemo(
        () =>
            currencyScopeIds.map(currencyId => ({
                currencyId,
                currencyCode:
                    currencyMap.get(currencyId)?.code,
                // The whole budget list is handed over untouched - the
                // engine applies month / active / currency filtering
                // itself, so this always reflects the current
                // transactions + budgets (Phase 2 stores nothing).
                summary: calculateBudgetSpending({
                    budgets,
                    transactions,
                    month: selectedMonth,
                    currencyId,
                    emiInterestByTransactionId,
                    creditCardAccountIds,
                }),
            })),
        [
            currencyScopeIds,
            currencyMap,
            budgets,
            transactions,
            selectedMonth,
            emiInterestByTransactionId,
            creditCardAccountIds,
        ]
    );

    const loading =
        budgetsLoading ||
        transactionsLoading ||
        emiInterestLoading ||
        accountsLoading;

    const error =
        budgetsError ?? transactionsError;

    const optionsLoading =
        categoriesLoading ||
        businessEntitiesLoading ||
        currenciesLoading;

    const anySpending = scopeSummaries.some(
        scope => scope.summary.totalExpense > 0
    );

    const showNoBudgetsYet =
        budgets.length === 0 && !anySpending;

    const showNoBudgetsThisMonth =
        budgets.length > 0 &&
        applicableBudgets.length === 0 &&
        !anySpending;

    const showSections =
        !showNoBudgetsYet &&
        !showNoBudgetsThisMonth;

    const showCurrencyHeadings =
        scopeSummaries.length > 1;

    return (
        <div className="min-h-full bg-white">
            <div className="mx-auto w-full max-w-[1400px] px-8 py-8">

                <PageHeader
                    title="Budgets"
                    actions={
                        <button
                            type="button"
                            onClick={() =>
                                setAdding(true)
                            }
                            className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-800"
                        >
                            <Plus size={16} />
                            Add Budget
                        </button>
                    }
                />

                <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-100 bg-white px-5 py-4">
                    <div>
                        <h2 className="text-sm font-semibold text-slate-900">
                            Budget vs actual
                        </h2>

                        <p className="mt-1 text-xs text-slate-400">
                            {applicableBudgets.length}{" "}
                            {applicableBudgets.length === 1
                                ? "budget"
                                : "budgets"}
                            {" for "}
                            {monthLabel}
                        </p>
                    </div>

                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={goToPreviousMonth}
                            aria-label="Previous month"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                        >
                            <ChevronLeft size={16} />
                        </button>

                        <div className="min-w-[150px] text-center text-sm font-semibold text-slate-900">
                            {monthLabel}
                        </div>

                        <button
                            type="button"
                            onClick={goToNextMonth}
                            aria-label="Next month"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                        >
                            <ChevronRight size={16} />
                        </button>

                        {!viewingCurrentMonth && (
                            <button
                                type="button"
                                onClick={goToCurrentMonth}
                                className="ml-1 inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                            >
                                This month
                            </button>
                        )}
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
                            placeholder="Search budgets..."
                            className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:border-slate-500"
                        />
                    </div>
                </div>

                {loading && (
                    <div className="mt-6 flex min-h-[240px] items-center justify-center rounded-2xl border border-slate-100">
                        <p className="text-sm text-slate-400">
                            Loading budgets...
                        </p>
                    </div>
                )}

                {!loading && error && (
                    <div className="mt-6 flex min-h-[240px] items-center justify-center rounded-2xl border border-slate-100">
                        <p className="text-sm text-red-500">
                            {error}
                        </p>
                    </div>
                )}

                {!loading &&
                    !error &&
                    showNoBudgetsYet && (
                        <div className="mt-6 rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-12">
                            <EmptyState
                                title="No budgets yet"
                                description="Create your first budget to start tracking planned spending."
                            />
                        </div>
                    )}

                {!loading &&
                    !error &&
                    showNoBudgetsThisMonth && (
                        <div className="mt-6 flex min-h-[180px] items-center justify-center rounded-2xl border border-slate-100">
                            <p className="text-sm text-slate-400">
                                No budgets for{" "}
                                {monthLabel}.
                            </p>
                        </div>
                    )}

                {!loading &&
                    !error &&
                    showSections && (
                        <div className="mt-6 space-y-6">
                            {scopeSummaries.map(
                                scope => (
                                    <BudgetMonthReport
                                        key={
                                            scope.currencyId ||
                                            "default"
                                        }
                                        summary={
                                            scope.summary
                                        }
                                        currencyCode={
                                            scope.currencyCode
                                        }
                                        showCurrencyHeading={
                                            showCurrencyHeadings
                                        }
                                        monthLabel={
                                            monthLabel
                                        }
                                        categoryNameById={
                                            categoryNameById
                                        }
                                        budgetsById={
                                            budgetsById
                                        }
                                        search={search}
                                        onView={
                                            setViewingBudget
                                        }
                                        onEdit={
                                            setEditingBudget
                                        }
                                        onDelete={
                                            setDeletingBudget
                                        }
                                        onAddBudget={() =>
                                            setAdding(
                                                true
                                            )
                                        }
                                    />
                                )
                            )}
                        </div>
                    )}

                <AddBudgetDialog
                    open={adding}
                    onOpenChange={setAdding}
                    onSuccess={refresh}
                />

                <ViewBudgetDialog
                    budget={viewingBudget}
                    currencyCode={
                        viewingBudget
                            ? currencyMap.get(
                                  viewingBudget.currencyId
                              )?.code
                            : undefined
                    }
                    categoryName={resolveBudgetCategoryLabel(
                        viewingBudget?.categoryId ??
                            null,
                        categoryNameById
                    )}
                    businessEntityName={
                        viewingBudget?.businessEntityId
                            ? businessEntityMap.get(
                                  viewingBudget.businessEntityId
                              )
                            : undefined
                    }
                    open={
                        viewingBudget !== null
                    }
                    onOpenChange={open => {
                        if (!open) {
                            setViewingBudget(null);
                        }
                    }}
                />

                <EditBudgetDialog
                    budget={editingBudget}
                    open={
                        editingBudget !== null
                    }
                    onOpenChange={open => {
                        if (!open) {
                            setEditingBudget(null);
                        }
                    }}
                    onSuccess={refresh}
                />

                <DeleteBudgetDialog
                    budget={deletingBudget}
                    open={
                        deletingBudget !== null
                    }
                    onOpenChange={open => {
                        if (!open) {
                            setDeletingBudget(null);
                        }
                    }}
                    onSuccess={refresh}
                />

                {optionsLoading && (
                    <div className="sr-only">
                        Loading budget options
                    </div>
                )}

            </div>
        </div>
    );
}
