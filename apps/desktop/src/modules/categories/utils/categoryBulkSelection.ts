import { getErrorMessage } from "@/core/errors";

import type { Category } from "../types";

// ---------------------------------------------------------------------
// Categories bulk selection + delete.
//
// Same selection behaviour as the Transactions page (TransactionsPage's
// allSelected / someSelected / toggleRowSelected / toggleAllSelected):
// the header checkbox works on the rows currently displayed (after
// search / filters); rows selected before a filter change stay selected.
//
// Deletion reuses CategoryService.delete - the existing soft delete - one
// category at a time, like BulkDeleteTransactionsDialog. It stops at the
// first failure and reports exactly which categories were already
// deleted, so the page can refresh and keep only the rest selected.
// ---------------------------------------------------------------------

export function getCategorySelectionState(
    displayed: readonly Pick<Category, "id">[],
    selectedIds: ReadonlySet<string>
): { allSelected: boolean; someSelected: boolean } {
    const allSelected =
        displayed.length > 0 &&
        displayed.every(category => selectedIds.has(category.id));

    const someSelected =
        !allSelected &&
        displayed.some(category => selectedIds.has(category.id));

    return { allSelected, someSelected };
}

export function toggleCategorySelected(
    selectedIds: ReadonlySet<string>,
    id: string
): Set<string> {
    const next = new Set(selectedIds);

    if (next.has(id)) {
        next.delete(id);
    } else {
        next.add(id);
    }

    return next;
}

// Header checkbox: all displayed rows selected -> deselect them;
// otherwise (none or some) -> select every displayed row.
export function toggleAllCategoriesSelected(
    selectedIds: ReadonlySet<string>,
    displayed: readonly Pick<Category, "id">[]
): Set<string> {
    const next = new Set(selectedIds);
    const { allSelected } = getCategorySelectionState(displayed, selectedIds);

    for (const category of displayed) {
        if (allSelected) {
            next.delete(category.id);
        } else {
            next.add(category.id);
        }
    }

    return next;
}

// The selected categories that still exist in the loaded list - a
// category deleted some other way (e.g. the row's own Delete) drops out
// here, so the count and the delete never include it.
export function selectedCategories(
    categories: readonly Category[],
    selectedIds: ReadonlySet<string>
): Category[] {
    return categories.filter(category => selectedIds.has(category.id));
}

export function withoutIds(
    selectedIds: ReadonlySet<string>,
    ids: readonly string[]
): Set<string> {
    const next = new Set(selectedIds);

    for (const id of ids) {
        next.delete(id);
    }

    return next;
}

function categoriesLabel(count: number): string {
    return `${count} ${count === 1 ? "category" : "categories"}`;
}

export interface BulkCategoryDeleteOutcome {
    deletedIds: string[];
    failed: boolean;
}

// Deletes the given categories one by one via the existing soft delete.
// Success: one success toast. Failure: one error toast naming the
// category that failed and how many were deleted before it.
export async function runBulkCategoryDelete(
    service: { delete: (id: string) => Promise<void> },
    categories: readonly Pick<Category, "id" | "name">[],
    notify: {
        success: (message: string) => unknown;
        error: (message: string) => unknown;
    }
): Promise<BulkCategoryDeleteOutcome> {
    const deletedIds: string[] = [];

    for (const category of categories) {
        try {
            await service.delete(category.id);
            deletedIds.push(category.id);
        } catch (error) {
            console.error("Failed to delete categories:", error);

            const reason = getErrorMessage(
                error,
                "Failed to delete categories. Please try again."
            );

            notify.error(
                deletedIds.length === 0
                    ? reason
                    : `Deleted ${deletedIds.length} of ${categories.length} categories, then could not delete "${category.name}": ${reason}`
            );

            return { deletedIds, failed: true };
        }
    }

    notify.success(
        categories.length === 1
            ? "Category deleted successfully."
            : `${categoriesLabel(categories.length)} deleted successfully.`
    );

    return { deletedIds, failed: false };
}
