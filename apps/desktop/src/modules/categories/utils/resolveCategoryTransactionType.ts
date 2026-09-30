import { Category } from "../types/Category";
import { CategoryContextMapping } from "../types/CategoryContextMapping";
import { CategoryType } from "../types/CategoryType";

export type CategoryTypeResolutionSource =
    | "account"
    | "business-entity"
    | "default";

export interface CategoryTypeResolution {
    categoryType: CategoryType | null;
    source: CategoryTypeResolutionSource | null;
}

export interface ResolveCategoryTransactionTypeParams {
    categoryId: string | null | undefined;
    accountId: string | null | undefined;

    // The selected account's own business entity, if any - resolved by
    // the caller (Account.businessEntityId) before calling this.
    businessEntityId: string | null | undefined;

    mappings: readonly CategoryContextMapping[];
    categories: readonly Category[];
}

/**
 * Resolves which Income/Expense direction applies to a category in a
 * given transaction context, in priority order:
 *   1. A mapping specific to the selected account.
 *   2. A mapping specific to the selected account's business entity.
 *   3. The category's own default categoryType.
 *   4. null (no category selected - the caller must ask the user).
 *
 * Pure and side-effect free so it can run identically in the
 * TransactionForm (live, as the user picks account/category) and in
 * TransactionService (validating a save) without either one needing to
 * duplicate the priority order.
 */
export function resolveCategoryTransactionType(
    params: ResolveCategoryTransactionTypeParams
): CategoryTypeResolution {

    const {
        categoryId,
        accountId,
        businessEntityId,
        mappings,
        categories,
    } = params;

    if (!categoryId) {
        return { categoryType: null, source: null };
    }

    if (accountId) {
        const accountMapping = mappings.find(
            mapping =>
                mapping.categoryId === categoryId &&
                mapping.accountId === accountId &&
                mapping.isActive
        );

        if (accountMapping) {
            return {
                categoryType: accountMapping.categoryType,
                source: "account",
            };
        }
    }

    if (businessEntityId) {
        const entityMapping = mappings.find(
            mapping =>
                mapping.categoryId === categoryId &&
                mapping.businessEntityId === businessEntityId &&
                mapping.isActive
        );

        if (entityMapping) {
            return {
                categoryType: entityMapping.categoryType,
                source: "business-entity",
            };
        }
    }

    const category = categories.find(
        item => item.id === categoryId
    );

    if (category) {
        return {
            categoryType: category.categoryType,
            source: "default",
        };
    }

    return { categoryType: null, source: null };
}

// Only an account- or business-entity-specific mapping is treated as a
// hard rule (see the module README-level note in
// resolveCategoryTransactionType above) - the category's own default
// type stays a soft suggestion, since it has never been enforced and
// many existing categories are used across both income and expense
// transactions today.
export function isLockedResolution(
    resolution: CategoryTypeResolution
): boolean {
    return (
        resolution.source === "account" ||
        resolution.source === "business-entity"
    );
}
