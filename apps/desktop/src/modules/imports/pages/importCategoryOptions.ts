import type { NormalizedTransactionCandidate } from "@financeos/import-engine";

import type {
    BaseFinanceScope,
    Category,
    CategoryContextMapping,
} from "@/modules/categories/types";
import {
    financeScopeIncludes,
    isLockedResolution,
    resolveCategoryTransactionType,
} from "@/modules/categories/utils";

// ---------------------------------------------------------------------
// Import Preview - Category column options
//
// The Categories module is the single source of truth: options are the
// loaded active categories (useCategories), never hard-coded names, and
// a row stores the category's id.
//
// Income/Expense behavior reuses the existing category rules exactly as
// TransactionService.assertCompatibleType enforces them on save: a
// category that an account- or business-entity-specific mapping LOCKS
// to the opposite direction for the import's destination account (see
// resolveCategoryTransactionType / isLockedResolution) is left out for
// that row, since saving it would be rejected. A category's own default
// categoryType stays a soft suggestion - exactly as in the manual
// TransactionForm - so it never hides a category.
//
// Category Scope: the Import Preview's Personal / Business selector
// narrows the options to categories whose stored finance_scope includes
// it (a Personal + Business category appears under both). The scope is
// OPTIONAL: with none selected there is no scope filtering - every
// category the existing rules allow is offered. It is only a view over
// the existing categories.finance_scope data; it never changes a
// category, and never blocks the Import.
// ---------------------------------------------------------------------

/** Value of the Uncategorized (no category) option. */
export const UNCATEGORIZED_OPTION_VALUE = "";
export const UNCATEGORIZED_OPTION_LABEL = "Uncategorized";
export const UNAVAILABLE_CATEGORY_LABEL = "Unknown category (unavailable)";

export interface ImportCategoryOption {
    id: string;
    name: string;
    /**
     * True for a row's current category that isn't one of the normal
     * choices (inactive, deleted, or locked to the other direction) -
     * shown so the select still reflects the row's real value.
     */
    unavailable: boolean;
}

export interface ImportCategoryAccountContext {
    id: string;
    businessEntityId: string | null;
}

// The selectable categories for rows of one direction, in the selected
// Category Scope (none selected = no scope filtering).
export function resolveImportCategoryOptions(params: {
    categories: readonly Category[];
    mappings: readonly CategoryContextMapping[];
    account: ImportCategoryAccountContext | null;
    direction: NormalizedTransactionCandidate["type"];
    scope: BaseFinanceScope | null;
}): ImportCategoryOption[] {
    const { categories, mappings, account, direction, scope } = params;

    const activeCategories = categories.filter(
        category => category.isActive
    );

    return activeCategories
        .filter(
            category =>
                !scope ||
                financeScopeIncludes(category.financeScope, scope)
        )
        .filter(category => {
            if (!direction) {
                return true;
            }

            const resolution = resolveCategoryTransactionType({
                categoryId: category.id,
                accountId: account?.id ?? null,
                businessEntityId: account?.businessEntityId ?? null,
                mappings,
                categories: activeCategories,
            });

            if (
                !isLockedResolution(resolution) ||
                !resolution.categoryType
            ) {
                return true;
            }

            return (
                resolution.categoryType.toLowerCase() === direction
            );
        })
        .map(category => ({
            id: category.id,
            name: category.name,
            unavailable: false,
        }));
}

// A row's options: the direction's options, plus - when the row's
// current category (e.g. from a learned rule) isn't among them - that
// category first, marked unavailable, so the select shows the row's real
// value instead of silently falling back to Uncategorized. Never
// fabricated while categories are still loading.
export function withRowCategory(
    options: readonly ImportCategoryOption[],
    categoryId: string | null | undefined,
    categories: readonly Category[],
    categoriesLoading: boolean
): ImportCategoryOption[] {
    if (
        !categoryId ||
        categoriesLoading ||
        options.some(option => option.id === categoryId)
    ) {
        return [...options];
    }

    const known = categories.find(
        category => category.id === categoryId
    );

    return [
        {
            id: categoryId,
            name: known
                ? `${known.name} (unavailable)`
                : UNAVAILABLE_CATEGORY_LABEL,
            unavailable: true,
        },
        ...options,
    ];
}

// Row numbers whose category (typically applied by a learned rule) is
// outside the selected Category Scope - shown as "Name (unavailable)",
// never silently replaced, and listed by the optional "Show N Affected
// Rows" review view. They import with their category as-is: this never
// blocks the Import. With no scope selected nothing is out of scope.
export function rowsWithCategoryOutsideScope(
    candidates: readonly NormalizedTransactionCandidate[],
    categories: readonly Category[],
    scope: BaseFinanceScope | null
): number[] {
    const scopeById = new Map(
        categories.map(category => [category.id, category.financeScope])
    );

    return candidates
        .filter(candidate => {
            if (!candidate.categoryId) {
                return false;
            }

            if (!scope) {
                return false;
            }

            const categoryScope = scopeById.get(candidate.categoryId);

            // Unknown ids keep their existing handling (shown as
            // unavailable; the save-time checks apply).
            return (
                categoryScope !== undefined &&
                !financeScopeIncludes(categoryScope, scope)
            );
        })
        .map(candidate => candidate.rowNumber);
}

// Import Preview "affected rows" view: while it's on, only rows whose
// category is outside the selected Category Scope (see
// rowsWithCategoryOutsideScope) are shown - a pure view filter; it never
// changes a row or a category. A row the user corrects drops out of
// the view on the next render because it is no longer affected.
export function isPreviewRowVisible(
    rowNumber: number,
    affectedRowNumbers: ReadonlySet<number>,
    showAffectedOnly: boolean
): boolean {
    return !showAffectedOnly || affectedRowNumbers.has(rowNumber);
}

// The view toggle's label: "Show All Rows" while the affected-only view
// is on; "Show N Affected Rows" in the full view when any exist; null
// (no toggle) otherwise.
export function affectedRowsToggleLabel(
    showAffectedOnly: boolean,
    affectedCount: number
): string | null {
    if (showAffectedOnly) {
        return "Show All Rows";
    }

    return affectedCount > 0
        ? `Show ${affectedCount} Affected Rows`
        : null;
}
