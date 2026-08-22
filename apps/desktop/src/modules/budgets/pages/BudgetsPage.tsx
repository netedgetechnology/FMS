import { useMemo, useState } from "react";
import { Plus } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/common";

import { useCategories } from "@/modules/categories/hooks";
import { useBusinessEntities } from "@/modules/business-entities/hooks";
import { useCurrencies } from "@/modules/currencies/hooks/useCurrencies";

import { useBudgets } from "../hooks";

import {
    AddBudgetDialog,
    BudgetTable,
    DeleteBudgetDialog,
    EditBudgetDialog,
    ViewBudgetDialog,
} from "../components";

import type { Budget } from "../types";

export default function BudgetsPage() {
    const {
        budgets,
        loading,
        error,
        refresh,
    } = useBudgets();

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

    const categoryMap = useMemo(
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

    const filteredBudgets = useMemo(() => {
        const query =
            search.trim().toLowerCase();

        if (!query) {
            return budgets;
        }

        return budgets.filter(budget =>
            [
                budget.name,
                budget.periodType,
                budget.startDate,
                budget.endDate ?? "",
                budget.isActive
                    ? "active"
                    : "inactive",
                budget.categoryId
                    ? categoryMap.get(
                          budget.categoryId
                      ) ?? ""
                    : "",
                budget.businessEntityId
                    ? businessEntityMap.get(
                          budget.businessEntityId
                      ) ?? ""
                    : "",
                currencyMap.get(
                    budget.currencyId
                )?.code ?? "",
            ]
                .join(" ")
                .toLowerCase()
                .includes(query)
        );
    }, [
        budgets,
        search,
        categoryMap,
        businessEntityMap,
        currencyMap,
    ]);

    const optionsLoading =
        categoriesLoading ||
        businessEntitiesLoading ||
        currenciesLoading;

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

                <section className="mt-8 rounded-2xl border border-slate-100 bg-white">

                    <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
                        <div>
                            <h2 className="text-sm font-semibold text-slate-900">
                                Budgets
                            </h2>

                            <p className="mt-1 text-xs text-slate-400">
                                {budgets.length}{" "}
                                {budgets.length === 1
                                    ? "budget"
                                    : "budgets"}
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
                                placeholder="Search budgets..."
                                className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:border-slate-500"
                            />
                        </div>
                    </div>

                    {loading && (
                        <div className="flex min-h-[240px] items-center justify-center">
                            <p className="text-sm text-slate-400">
                                Loading budgets...
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
                        budgets.length === 0 && (
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-12">
                                <EmptyState
                                    title="No budgets yet"
                                    description="Create your first budget to start tracking planned spending."
                                />
                            </div>
                        )}

                    {!loading &&
                        !error &&
                        budgets.length > 0 &&
                        filteredBudgets.length ===
                            0 && (
                            <div className="flex min-h-[180px] items-center justify-center">
                                <p className="text-sm text-slate-400">
                                    No budgets match your search.
                                </p>
                            </div>
                        )}

                    {!loading &&
                        !error &&
                        filteredBudgets.length > 0 && (
                            <div className="overflow-hidden rounded-b-2xl">
                                <BudgetTable
                                    budgets={
                                        filteredBudgets
                                    }
                                    currencies={
                                        currencyMap
                                    }
                                    categories={
                                        categoryMap
                                    }
                                    businessEntities={
                                        businessEntityMap
                                    }
                                    onView={
                                        setViewingBudget
                                    }
                                    onEdit={
                                        setEditingBudget
                                    }
                                    onDelete={
                                        setDeletingBudget
                                    }
                                />
                            </div>
                        )}
                </section>

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
                    categoryName={
                        viewingBudget?.categoryId
                            ? categoryMap.get(
                                  viewingBudget.categoryId
                              )
                            : undefined
                    }
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
