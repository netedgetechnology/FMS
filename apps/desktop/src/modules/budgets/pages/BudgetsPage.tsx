import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/common";
import {
    currentMonth,
    useDisplaySettings,
} from "@/core/formatting";

import { useAccounts } from "@/modules/accounts/hooks";
import { AccountType } from "@/modules/accounts/types";
import { transferCategoryIdSet } from "@/core/accounting/transferClassification";
import { useCategories } from "@/modules/categories/hooks";
import { useBusinessEntities } from "@/modules/business-entities/hooks";
import { useCurrencies } from "@/modules/currencies/hooks/useCurrencies";
import { useTransactions } from "@/modules/transactions/hooks";

import {
    useBudgets,
    useEmiInterestByTransactionId,
} from "../hooks";
import {
    ALL_BUDGETS_LABEL,
    calculateBudgetSpendingForView,
    DEFAULT_BUDGET_VIEW_MODE,
    resolveBudgetCategoryLabel,
    resolveBudgetCurrencyScopes,
    selectBudgetsForView,
    type BudgetMonthRange,
    type BudgetViewMode,
} from "../services";

import {
    AddBudgetDialog,
    BudgetMonthPicker,
    BudgetMonthReport,
    BudgetRangePicker,
    BudgetYearPicker,
    formatBudgetPeriodLabel,
    selectMonthInYear,
    selectYearContext,
    stepBudgetPeriod,
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

    // The app's actual configured default currency (app_settings'
    // general.default_currency) - the same source every other module
    // already uses. Preferred over each currency's own (separate,
    // occasionally out-of-sync) `isDefault` column when resolving
    // which currency to report in when no budget exists yet - see
    // resolveBudgetCurrencyScopes's own doc comment.
    const { defaultCurrency } = useDisplaySettings();

    const [search, setSearch] = useState("");

    // Which view the page shows: every budget ("all", the default), the
    // selected year, one month of the selected year, or a month range.
    // Kept separate from the selections below so switching views keeps
    // each one's last choice.
    const [viewMode, setViewMode] =
        useState<BudgetViewMode>(
            DEFAULT_BUDGET_VIEW_MODE
        );

    // The selected month, held as the first day of that month at local
    // midnight (see currentMonth / addMonths). Its year is the selected
    // year - the Year view's year and the Month view's context. Starts
    // at the current calendar month.
    const [selectedMonth, setSelectedMonth] =
        useState<Date>(() => currentMonth());

    // The selected start -> end month range; null until one is picked.
    const [selectedRange, setSelectedRange] =
        useState<BudgetMonthRange | null>(null);

    const viewingAllBudgets = viewMode === "all";

    const canStep =
        viewMode === "year" || viewMode === "month";

    const showAllBudgets = () =>
        setViewMode("all");

    const showYear = (year: number) => {
        setSelectedMonth(month =>
            selectYearContext(month, year)
        );
        setViewMode("year");
    };

    const showMonth = (monthIndex: number) => {
        setSelectedMonth(month =>
            selectMonthInYear(month, monthIndex)
        );
        setViewMode("month");
    };

    const showRange = (range: BudgetMonthRange) => {
        setSelectedRange(range);
        setViewMode("range");
    };

    const goToPrevious = () =>
        setSelectedMonth(month =>
            stepBudgetPeriod(viewMode, month, -1)
        );

    const goToNext = () =>
        setSelectedMonth(month =>
            stepBudgetPeriod(viewMode, month, 1)
        );

    const stepUnit =
        viewMode === "year" ? "year" : "month";

    const monthLabel = formatBudgetPeriodLabel(
        viewMode,
        selectedMonth,
        selectedRange
    );

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

    // Every budget in All Budgets view, otherwise those whose date range
    // overlaps the selected year / month (Phase 1 rule) / month range.
    // Used only for headline counts and to decide which currency
    // sections to render - the spending engine re-applies the same
    // scoping internally.
    const applicableBudgets = useMemo(
        () =>
            selectBudgetsForView(
                budgets,
                viewMode,
                selectedMonth,
                selectedRange
            ),
        [
            budgets,
            viewMode,
            selectedMonth,
            selectedRange,
        ]
    );

    // One Budget-vs-Actual section per currency that has an applicable
    // budget this month (or the default currency when none do). Amounts
    // are never converted or summed across currencies - see Phase 2.
    const currencyScopeIds = useMemo(
        () =>
            resolveBudgetCurrencyScopes(
                applicableBudgets,
                currencies,
                defaultCurrency
            ),
        [
            applicableBudgets,
            currencies,
            defaultCurrency,
        ]
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

    // TRANSFER-category ids: an expense in one of these is a transfer
    // between the user's own accounts, never budget spending.
    const transferCategoryIds = useMemo(
        () => transferCategoryIdSet(categories),
        [categories]
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
                summary: calculateBudgetSpendingForView({
                    viewMode,
                    budgets,
                    transactions,
                    month: selectedMonth,
                    range: selectedRange,
                    currencyId,
                    emiInterestByTransactionId,
                    creditCardAccountIds,
                    transferCategoryIds,
                }),
            })),
        [
            currencyScopeIds,
            currencyMap,
            budgets,
            transactions,
            viewMode,
            selectedMonth,
            selectedRange,
            emiInterestByTransactionId,
            creditCardAccountIds,
            transferCategoryIds,
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
                            {viewingAllBudgets
                                ? " across all periods"
                                : ` in ${monthLabel}`}
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1">
                        <button
                            type="button"
                            onClick={showAllBudgets}
                            aria-pressed={viewingAllBudgets}
                            className={
                                "mr-2 inline-flex h-9 items-center rounded-lg border px-3 text-sm font-medium transition-colors " +
                                (viewingAllBudgets
                                    ? "border-slate-900 bg-slate-900 text-white"
                                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900")
                            }
                        >
                            {ALL_BUDGETS_LABEL}
                        </button>

                        <BudgetYearPicker
                            year={selectedMonth.getFullYear()}
                            viewMode={viewMode}
                            onSelectYear={showYear}
                        />

                        <BudgetMonthPicker
                            month={selectedMonth}
                            viewMode={viewMode}
                            onSelectMonth={showMonth}
                        />

                        <BudgetRangePicker
                            range={selectedRange}
                            fallbackMonth={selectedMonth}
                            viewMode={viewMode}
                            onSelectRange={showRange}
                        />

                        <div className="ml-2 flex items-center gap-1">
                            <button
                                type="button"
                                onClick={goToPrevious}
                                disabled={!canStep}
                                aria-label={`Previous ${stepUnit}`}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40 disabled:hover:bg-white"
                            >
                                <ChevronLeft size={16} />
                            </button>

                            <button
                                type="button"
                                onClick={goToNext}
                                disabled={!canStep}
                                aria-label={`Next ${stepUnit}`}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40 disabled:hover:bg-white"
                            >
                                <ChevronRight size={16} />
                            </button>
                        </div>
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
                                No budgets in{" "}
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
                                        viewMode={
                                            viewMode
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
