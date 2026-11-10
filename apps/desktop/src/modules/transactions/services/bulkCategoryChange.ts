import {
    balanceSide,
    debitCreditTypeForDirection,
} from "@/core/accounting/transferClassification";
import { getErrorMessage } from "@/core/errors";
import type {
    Category,
    CategoryContextMapping,
} from "@/modules/categories/types";
import {
    isLockedResolution,
    resolveCategoryTransactionType,
} from "@/modules/categories/utils";

import type { Transaction } from "../types";

import { categoryTransferDirection } from "./transactionTyping";

// ---------------------------------------------------------------------
// Transactions - bulk "Change Category".
//
// Category rules are exactly the single-transaction edit's (see
// TransactionService.assertCompatibleType): a category is refused for a
// transaction only when an ACTIVE account- or business-entity mapping
// locks that category to Income/Expense and the transaction's type
// differs. A category's own default type is only a suggestion - never
// enforced - so every other active category is allowed, TRANSFER
// categories included.
//
// Changing the category never changes the transaction's type, direction,
// amount or account (so never a balance): a Transfer category only
// changes how Income/Expense totals classify the row (see
// core/accounting/transferClassification.ts). Learned import rules are
// not touched - this is a direct edit of transaction data.
// ---------------------------------------------------------------------

export type BulkCategoryTransaction = Pick<
    Transaction,
    "id" | "accountId" | "type"
> &
    Partial<Pick<Transaction, "categoryId" | "transferDirection">>;

// The type a transaction will have once `category` is applied - the same
// rule as TransactionService.changeCategory: a TRANSFER category makes it
// a transfer; a normal category replacing a TRANSFER category turns a
// transfer back into Income/Expense from its direction; otherwise the
// type is unchanged. Locks are checked against THIS type, so the dropdown
// offers exactly what Apply accepts.
export function typeAfterCategoryChange(
    transaction: BulkCategoryTransaction,
    category: Pick<Category, "id" | "categoryType">,
    categoryTypeById: ReadonlyMap<string, string>
): Transaction["type"] {
    if (category.categoryType === "TRANSFER") {
        return "transfer";
    }

    if (
        transaction.type === "transfer" &&
        !!transaction.categoryId &&
        transaction.categoryId !== category.id &&
        categoryTypeById.get(transaction.categoryId) === "TRANSFER"
    ) {
        return (
            debitCreditTypeForDirection(transaction.transferDirection) ??
            transaction.type
        );
    }

    return transaction.type;
}

// The selected transactions `category` can't be applied to (locked to
// the other type for their account / business entity).
export function incompatibleTransactionIds(
    category: Pick<Category, "id" | "categoryType">,
    transactions: readonly BulkCategoryTransaction[],
    mappings: readonly CategoryContextMapping[],
    businessEntityIdByAccountId: ReadonlyMap<string, string | null>
): string[] {
    const own = mappings.filter(
        mapping => mapping.categoryId === category.id && mapping.isActive
    );

    // No active mapping -> nothing can lock it.
    if (own.length === 0) {
        return [];
    }

    return transactions
        .filter(transaction => {
            const resolution = resolveCategoryTransactionType({
                categoryId: category.id,
                accountId: transaction.accountId,
                businessEntityId:
                    businessEntityIdByAccountId.get(transaction.accountId) ??
                    null,
                mappings: own,
                categories: [category as Category],
            });

            return (
                isLockedResolution(resolution) &&
                !!resolution.categoryType &&
                resolution.categoryType.toLowerCase() !== transaction.type
            );
        })
        .map(transaction => transaction.id);
}

// The dropdown's options: every active category valid for ALL selected
// transactions - each checked with the type it will have after the
// change, as Apply checks it - in the given order.
export function categoriesForBulkChange(
    categories: readonly Category[],
    transactions: readonly BulkCategoryTransaction[],
    mappings: readonly CategoryContextMapping[],
    businessEntityIdByAccountId: ReadonlyMap<string, string | null>
): Category[] {
    const categoryTypeById = new Map(
        categories.map(category => [category.id, category.categoryType])
    );

    return categories.filter(
        category =>
            category.isActive &&
            bulkDirectionConflictIds(category, transactions).length === 0 &&
            incompatibleTransactionIds(
                category,
                transactions.map(transaction => ({
                    ...transaction,
                    type: typeAfterCategoryChange(
                        transaction,
                        category,
                        categoryTypeById
                    ),
                })),
                mappings,
                businessEntityIdByAccountId
            ).length === 0
    );
}

// The selected transactions a Transfer category with a configured
// direction can't be applied to in bulk: those whose money moves the
// other way - by their current Debit/Credit side, or (when known) by
// their bank statement's side. Bulk Change Category never changes a
// transaction's sign; a row that needs one is corrected on its own in
// Edit Transaction, where the change is shown and checked against the
// statement. An either-way or non-Transfer category refuses none.
export function bulkDirectionConflictIds(
    category: Pick<Category, "categoryType" | "transferDirection">,
    transactions: readonly BulkCategoryTransaction[],
    statementSideById: ReadonlyMap<string, "income" | "expense"> = new Map()
): string[] {
    const categorySide = debitCreditTypeForDirection(
        categoryTransferDirection(category)
    );

    if (!categorySide) {
        return [];
    }

    return transactions
        .filter(transaction => {
            const side = balanceSide({
                type: transaction.type,
                transferDirection: transaction.transferDirection ?? null,
            });
            const statementSide = statementSideById.get(transaction.id);

            return (
                side !== categorySide ||
                (statementSide !== undefined && statementSide !== categorySide)
            );
        })
        .map(transaction => transaction.id);
}

function transactionsLabel(count: number): string {
    return `${count} transaction${count === 1 ? "" : "s"}`;
}

// Runs the one atomic update (TransactionService.changeCategory). One
// success toast, or one error toast - in which case nothing changed.
export async function runBulkCategoryChange(
    service: {
        changeCategory: (
            transactionIds: readonly string[],
            categoryId: string
        ) => Promise<{ updated: number }>;
    },
    transactionIds: readonly string[],
    category: Pick<Category, "id" | "name">,
    notify: {
        success: (message: string) => unknown;
        error: (message: string) => unknown;
    }
): Promise<{ changed: boolean }> {
    try {
        const { updated } = await service.changeCategory(
            transactionIds,
            category.id
        );

        notify.success(
            `Category changed to ${category.name} for ${transactionsLabel(updated)}.`
        );

        return { changed: true };
    } catch (error) {
        console.error("Failed to change transaction categories:", error);

        notify.error(
            `Failed to change category - no transactions were changed. ${getErrorMessage(
                error,
                "Please try again."
            )}`
        );

        return { changed: false };
    }
}
