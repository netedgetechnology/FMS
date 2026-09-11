import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useCategories } from "@/modules/categories/hooks";

import { isGoalEligibleCategoryType } from "../constants";
import { GoalCategoryLinkRepository } from "../repositories";
import type {
    FinancialGoal,
    GoalCategoryLink,
} from "../types";

interface ManageGoalCategoryLinksDialogProps {
    open: boolean;
    goal: FinancialGoal | null;
    onClose: () => void;
    /** Called after any link is added or removed, so the page can refresh actuals. */
    onChanged: () => Promise<void> | void;
}

export function ManageGoalCategoryLinksDialog({
    open,
    goal,
    onClose,
    onChanged,
}: ManageGoalCategoryLinksDialogProps) {
    const repository = useMemo(
        () => new GoalCategoryLinkRepository(),
        []
    );

    const { categories, loading: categoriesLoading } =
        useCategories();

    const [links, setLinks] = useState<
        GoalCategoryLink[]
    >([]);
    const [loadingLinks, setLoadingLinks] =
        useState(false);
    const [busyCategoryId, setBusyCategoryId] =
        useState<string | null>(null);

    useEffect(() => {
        if (!open || !goal) {
            return;
        }

        let active = true;

        async function load() {
            setLoadingLinks(true);
            try {
                const result =
                    await repository.listByGoal(
                        goal!.id
                    );
                if (active) {
                    setLinks(result);
                }
            } finally {
                if (active) {
                    setLoadingLinks(false);
                }
            }
        }

        void load();

        return () => {
            active = false;
        };
    }, [open, goal, repository]);

    if (!open || !goal) {
        return null;
    }

    const linkedCategoryIds = new Set(
        links.map(link => link.categoryId)
    );

    const eligibleCategories = categories.filter(
        category =>
            isGoalEligibleCategoryType(
                category.categoryType
            ) && category.isActive
    );

    async function handleAdd(categoryId: string) {
        setBusyCategoryId(categoryId);
        try {
            const link: GoalCategoryLink = {
                id: crypto.randomUUID(),
                goalId: goal!.id,
                categoryId,
                isActive: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };

            await repository.create({
                id: link.id,
                goalId: link.goalId,
                categoryId: link.categoryId,
            });

            setLinks(prev => [...prev, link]);
            await onChanged();
            toast.success("Category linked.");
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to link category."
            );
        } finally {
            setBusyCategoryId(null);
        }
    }

    async function handleRemove(
        link: GoalCategoryLink
    ) {
        setBusyCategoryId(link.categoryId);
        try {
            await repository.softDelete(link.id);
            setLinks(prev =>
                prev.filter(l => l.id !== link.id)
            );
            await onChanged();
            toast.success("Category unlinked.");
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to unlink category."
            );
        } finally {
            setBusyCategoryId(null);
        }
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manage-goal-categories-title"
        >
            <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl">
                <div className="border-b border-slate-100 px-6 py-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2
                                id="manage-goal-categories-title"
                                className="text-xl font-bold text-slate-900"
                            >
                                Manage Linked Categories
                            </h2>

                            <p className="mt-1 text-sm text-slate-500">
                                {goal.name} - current
                                amount is the sum of
                                income transactions in
                                the categories linked
                                below.
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

                <div className="space-y-5 p-6">
                    <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Currently linked
                        </p>

                        {loadingLinks ? (
                            <p className="text-sm text-slate-400">
                                Loading...
                            </p>
                        ) : links.length === 0 ? (
                            <p className="text-sm text-slate-400">
                                No categories linked yet.
                            </p>
                        ) : (
                            <ul className="space-y-2">
                                {links.map(link => {
                                    const category =
                                        categories.find(
                                            c =>
                                                c.id ===
                                                link.categoryId
                                        );

                                    return (
                                        <li
                                            key={link.id}
                                            className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2.5"
                                        >
                                            <span className="text-sm font-medium text-slate-800">
                                                {category?.name ??
                                                    "Category no longer exists"}
                                            </span>

                                            <button
                                                type="button"
                                                onClick={() =>
                                                    void handleRemove(
                                                        link
                                                    )
                                                }
                                                disabled={
                                                    busyCategoryId ===
                                                    link.categoryId
                                                }
                                                className="rounded-lg border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                                            >
                                                {busyCategoryId ===
                                                link.categoryId
                                                    ? "..."
                                                    : "Unlink"}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>

                    <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Add a category
                        </p>

                        {categoriesLoading ? (
                            <p className="text-sm text-slate-400">
                                Loading categories...
                            </p>
                        ) : (
                            <ul className="space-y-2">
                                {eligibleCategories
                                    .filter(
                                        category =>
                                            !linkedCategoryIds.has(
                                                category.id
                                            )
                                    )
                                    .map(category => (
                                        <li
                                            key={
                                                category.id
                                            }
                                            className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-2.5"
                                        >
                                            <span className="text-sm text-slate-700">
                                                {
                                                    category.name
                                                }
                                            </span>

                                            <button
                                                type="button"
                                                onClick={() =>
                                                    void handleAdd(
                                                        category.id
                                                    )
                                                }
                                                disabled={
                                                    busyCategoryId ===
                                                    category.id
                                                }
                                                className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                                            >
                                                {busyCategoryId ===
                                                category.id
                                                    ? "..."
                                                    : "Link"}
                                            </button>
                                        </li>
                                    ))}

                                {eligibleCategories.filter(
                                    category =>
                                        !linkedCategoryIds.has(
                                            category.id
                                        )
                                ).length === 0 && (
                                    <p className="text-sm text-slate-400">
                                        No more eligible
                                        income categories.
                                    </p>
                                )}
                            </ul>
                        )}
                    </div>

                    <div className="flex justify-end border-t border-slate-100 pt-5">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
                        >
                            Done
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
