import { getErrorMessage } from "@/core/errors";

import type { Category, FinanceScope } from "../types";

import {
    FinanceScopeFlags,
    financeScopeFlags,
    financeScopeFromFlags,
    matchesFinanceScopeFilter,
} from "./financeScope";

// ---------------------------------------------------------------------
// Scopes screen (CategoryScopesDialog) - the only place a category's
// Personal / Business scope is changed by hand.
//
// Every active category appears once, with a Personal and a Business
// checkbox. Ticks are held as drafts until "Save Changes"; only
// categories whose scope actually changed are written, all in one atomic
// update (CategoryService.updateScopes). A category left with neither
// box ticked is flagged and blocks Save - the other box is never ticked
// behind the user's back. Cancel just drops the drafts.
// ---------------------------------------------------------------------

export type ScopeDrafts = Readonly<Record<string, FinanceScopeFlags>>;

export type ScopeKey = keyof FinanceScopeFlags;

export interface CategoryScopeChange {
    id: string;
    financeScope: FinanceScope;
}

export interface CategoryScopeFilters {
    search: string;
    /** "ALL" or a CategoryType. */
    typeFilter: string;
    /** "ALL" | "PERSONAL" | "BUSINESS" - on the saved scope. */
    scopeFilter: string;
}

// Active categories only (deleted ones are never loaded), each once,
// by name.
export function scopeManagedCategories(
    categories: readonly Category[]
): Category[] {
    const seen = new Set<string>();

    return categories
        .filter(category => {
            if (!category.isActive || seen.has(category.id)) {
                return false;
            }
            seen.add(category.id);
            return true;
        })
        .sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        );
}

export function initialScopeDrafts(
    categories: readonly Category[]
): ScopeDrafts {
    return Object.fromEntries(
        categories.map(category => [
            category.id,
            financeScopeFlags(category.financeScope),
        ])
    );
}

export function toggleScopeDraft(
    drafts: ScopeDrafts,
    id: string,
    key: ScopeKey
): ScopeDrafts {
    const current = drafts[id];

    if (!current) {
        return drafts;
    }

    return {
        ...drafts,
        [id]: { ...current, [key]: !current[key] },
    };
}

// Categories currently left with neither Personal nor Business.
export function zeroScopeIds(drafts: ScopeDrafts): string[] {
    return Object.entries(drafts)
        .filter(([, flags]) => financeScopeFromFlags(flags) === null)
        .map(([id]) => id);
}

// Only categories whose scope differs from what's saved - and only valid
// (non-empty) scopes.
export function scopeChanges(
    categories: readonly Category[],
    drafts: ScopeDrafts
): CategoryScopeChange[] {
    const changes: CategoryScopeChange[] = [];

    for (const category of categories) {
        const flags = drafts[category.id];
        const financeScope = flags ? financeScopeFromFlags(flags) : null;

        if (financeScope && financeScope !== category.financeScope) {
            changes.push({ id: category.id, financeScope });
        }
    }

    return changes;
}

// Search by name/description, Type, and Scope (the saved scope, so rows
// don't jump out of view while being edited).
export function filterScopeCategories(
    categories: readonly Category[],
    filters: CategoryScopeFilters
): Category[] {
    const query = filters.search.trim().toLowerCase();

    return categories.filter(category => {
        const matchesSearch =
            !query ||
            category.name.toLowerCase().includes(query) ||
            Boolean(category.description?.toLowerCase().includes(query));

        const matchesType =
            filters.typeFilter === "ALL" ||
            category.categoryType === filters.typeFilter;

        return (
            matchesSearch &&
            matchesType &&
            matchesFinanceScopeFilter(category.financeScope, filters.scopeFilter)
        );
    });
}

// "Save Changes": one atomic write of every changed scope. Success: one
// success toast with the count. Failure: one error toast - and nothing
// was written.
export async function runSaveCategoryScopes(
    service: {
        updateScopes: (
            changes: readonly CategoryScopeChange[]
        ) => Promise<void>;
    },
    changes: readonly CategoryScopeChange[],
    notify: {
        success: (message: string) => unknown;
        error: (message: string) => unknown;
    }
): Promise<{ saved: boolean }> {
    try {
        await service.updateScopes(changes);
    } catch (error) {
        console.error("Failed to save category scopes:", error);

        notify.error(
            `Failed to save scopes - no categories were changed. ${getErrorMessage(
                error,
                "Please try again."
            )}`
        );

        return { saved: false };
    }

    notify.success(
        `Scopes updated for ${changes.length} ${
            changes.length === 1 ? "category" : "categories"
        }.`
    );

    return { saved: true };
}
