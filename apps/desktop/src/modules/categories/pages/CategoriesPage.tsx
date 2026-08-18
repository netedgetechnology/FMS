import { useMemo, useState } from "react";

import {
    Plus,
    Search,
} from "lucide-react";

import { Input } from "@/components/ui/input";

import {
    PageHeader,
    SectionCard,
    StatCard,
} from "@/components/common";

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

import {
    AddCategoryDialog,
    CategoryTable,
    DeleteCategoryDialog,
    EditCategoryDialog,
    ViewCategoryDialog,
} from "../components";

import { useCategories } from "../hooks";

import { Category } from "../types";

export default function CategoriesPage() {
    const {
        categories,
        loading,
        error,
        refresh,
    } = useCategories();

    const [search, setSearch] = useState("");
    const [typeFilter, setTypeFilter] = useState("ALL");
    const [scopeFilter, setScopeFilter] = useState("ALL");
    const [statusFilter, setStatusFilter] = useState("ALL");

    const [addOpen, setAddOpen] = useState(false);
    const [viewCategory, setViewCategory] = useState<Category | null>(null);
    const [editCategory, setEditCategory] = useState<Category | null>(null);
    const [deleteCategory, setDeleteCategory] =
        useState<Category | null>(null);

    const filteredCategories = useMemo(() => {
        const query = search.trim().toLowerCase();

        return categories.filter(category => {
            const matchesSearch =
                !query ||
                category.name.toLowerCase().includes(query) ||
                category.description?.toLowerCase().includes(query);

            const matchesType =
                typeFilter === "ALL" ||
                category.categoryType === typeFilter;

            const matchesScope =
                scopeFilter === "ALL" ||
                category.financeScope === scopeFilter;

            const matchesStatus =
                statusFilter === "ALL" ||
                (statusFilter === "ACTIVE"
                    ? category.isActive
                    : !category.isActive);

            return (
                matchesSearch &&
                matchesType &&
                matchesScope &&
                matchesStatus
            );
        });
    }, [
        categories,
        search,
        typeFilter,
        scopeFilter,
        statusFilter,
    ]);

    const incomeCount = categories.filter(
        category => category.categoryType === "INCOME"
    ).length;

    const expenseCount = categories.filter(
        category => category.categoryType === "EXPENSE"
    ).length;

    const personalCount = categories.filter(
        category => category.financeScope === "PERSONAL"
    ).length;

    const businessCount = categories.filter(
        category => category.financeScope === "BUSINESS"
    ).length;

    return (
        <div className="space-y-6">
            <PageHeader
                title="Categories"
                actions={
                    <button
                        type="button"
                        onClick={() => setAddOpen(true)}
                        className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md active:scale-[0.98]"
                    >
                        <Plus size={16} />
                        Add Category
                    </button>
                }
            />

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard
                    title="Total Categories"
                    value={String(categories.length)}
                />

                <StatCard
                    title="Income"
                    value={String(incomeCount)}
                />

                <StatCard
                    title="Expenses"
                    value={String(expenseCount)}
                />

                <StatCard
                    title="Personal / Business"
                    value={`${personalCount} / ${businessCount}`}
                />
            </div>

            <SectionCard title="Category List">
                <div className="space-y-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                        <div className="relative min-w-0 flex-1">
                            <Search
                                size={16}
                                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                            />

                            <Input
                                value={search}
                                onChange={event =>
                                    setSearch(event.target.value)
                                }
                                placeholder="Search categories..."
                                className="pl-9"
                            />
                        </div>

                        <Select
                            value={typeFilter}
                            onValueChange={value => setTypeFilter(value ?? "ALL")}
                        >
                            <SelectTrigger className="w-full lg:w-[160px]">
                                <SelectValue placeholder="Type" />
                            </SelectTrigger>

                            <SelectContent>
                                <SelectItem value="ALL">
                                    All Types
                                </SelectItem>
                                <SelectItem value="INCOME">
                                    Income
                                </SelectItem>
                                <SelectItem value="EXPENSE">
                                    Expense
                                </SelectItem>
                                <SelectItem value="TRANSFER">
                                    Transfer
                                </SelectItem>
                            </SelectContent>
                        </Select>

                        <Select
                            value={scopeFilter}
                            onValueChange={value => setScopeFilter(value ?? "ALL")}
                        >
                            <SelectTrigger className="w-full lg:w-[160px]">
                                <SelectValue placeholder="Scope" />
                            </SelectTrigger>

                            <SelectContent>
                                <SelectItem value="ALL">
                                    All Scopes
                                </SelectItem>
                                <SelectItem value="PERSONAL">
                                    Personal
                                </SelectItem>
                                <SelectItem value="BUSINESS">
                                    Business
                                </SelectItem>
                            </SelectContent>
                        </Select>

                        <Select
                            value={statusFilter}
                            onValueChange={value => setStatusFilter(value ?? "ALL")}
                        >
                            <SelectTrigger className="w-full lg:w-[150px]">
                                <SelectValue placeholder="Status" />
                            </SelectTrigger>

                            <SelectContent>
                                <SelectItem value="ALL">
                                    All Status
                                </SelectItem>
                                <SelectItem value="ACTIVE">
                                    Active
                                </SelectItem>
                                <SelectItem value="INACTIVE">
                                    Inactive
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {error && (
                        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                            {error}
                        </div>
                    )}

                    {loading ? (
                        <div className="px-4 py-12 text-center text-sm text-slate-500">
                            Loading categories...
                        </div>
                    ) : filteredCategories.length === 0 ? (
                        <div className="px-4 py-12 text-center">
                            <div className="text-sm font-medium text-slate-700">
                                No categories found
                            </div>

                            <div className="mt-1 text-sm text-slate-400">
                                Create a category or adjust your filters.
                            </div>
                        </div>
                    ) : (
                        <CategoryTable
                            categories={filteredCategories}
                            onView={setViewCategory}
                            onEdit={setEditCategory}
                            onDelete={setDeleteCategory}
                        />
                    )}
                </div>
            </SectionCard>

            <AddCategoryDialog
                categories={categories}
                open={addOpen}
                onOpenChange={setAddOpen}
                onSuccess={refresh}
            />

            <ViewCategoryDialog
                category={viewCategory}
                categories={categories}
                open={Boolean(viewCategory)}
                onOpenChange={open => {
                    if (!open) {
                        setViewCategory(null);
                    }
                }}
            />

            <EditCategoryDialog
                category={editCategory}
                categories={categories}
                open={Boolean(editCategory)}
                onOpenChange={open => {
                    if (!open) {
                        setEditCategory(null);
                    }
                }}
                onSuccess={refresh}
            />

            <DeleteCategoryDialog
                category={deleteCategory}
                open={Boolean(deleteCategory)}
                onOpenChange={open => {
                    if (!open) {
                        setDeleteCategory(null);
                    }
                }}
                onSuccess={refresh}
            />
        </div>
    );
}

