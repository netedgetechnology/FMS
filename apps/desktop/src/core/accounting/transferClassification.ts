// ---------------------------------------------------------------------
// Transfer classification - the one rule for "is this transaction a
// transfer?" wherever Income / Expense totals are computed.
//
// A transfer moves money between the user's own accounts: it is neither
// Income nor Expense. A transaction is classified as a transfer when
// EITHER
//   - its type is "transfer", or
//   - its category (or sub-category) is a TRANSFER-type category - e.g.
//     an imported bank debit "To savings a/c" categorised as "Self
//     Transfer". Import always books a row as income/expense from its
//     Credit/Debit side, so the category is how an imported row is
//     classified as a transfer.
//
// This is ONLY for Income/Expense totals (Dashboard income, expenses,
// cash flow, spending breakdowns; budget spending). It must never be
// used to drop a transaction from an account balance, reconciliation or
// transaction lists: every transfer still moves its account's balance in
// its own direction - see balanceSide below, used by accounts/utils/
// accountBalance.ts and the other balance calculations.
// ---------------------------------------------------------------------

export interface TransferClassifiable {
    type: string | null;
    categoryId?: string | null;
    subcategoryId?: string | null;
}

// ---------------------------------------------------------------------
// Transfer direction.
//
// A `type = "transfer"` transaction records which way it moves money on
// its own account in `transferDirection` ("OUT" / "IN") - amounts are
// always positive, so this is the only place that direction lives. When
// a transaction BECOMES a transfer (a Transfer category is chosen), its
// direction comes from its previous Debit/Credit side: expense -> OUT,
// income -> IN.
// ---------------------------------------------------------------------

export type TransferDirection = "OUT" | "IN";

export function transferDirectionForType(
    type: string | null | undefined
): TransferDirection | null {
    if (type === "expense") {
        return "OUT";
    }
    if (type === "income") {
        return "IN";
    }
    return null;
}

// The Debit/Credit side a transaction moves its account's balance on:
// "income" (+) or "expense" (-). A transfer counts by its direction; a
// transfer with no recorded direction (legacy) returns null and - as
// before - moves no balance. For BALANCES and cash-movement totals only;
// never for Income/Expense totals (see isTransferClassified).
export function balanceSide(transaction: {
    type: string;
    transferDirection?: string | null;
}): "income" | "expense" | null {
    if (transaction.type === "income" || transaction.type === "expense") {
        return transaction.type;
    }

    if (transaction.type === "transfer") {
        if (transaction.transferDirection === "IN") {
            return "income";
        }
        if (transaction.transferDirection === "OUT") {
            return "expense";
        }
    }

    return null;
}

// The rule applied wherever a transaction's category is set: choosing a
// TRANSFER category makes it a transfer, keeping its money direction
// (from its previous Debit/Credit side, or its existing transfer
// direction). Choosing any other category never changes the type.
export function applyTransferCategoryRule(
    current: { type: string; transferDirection?: TransferDirection | null },
    isTransferCategory: boolean
): { type: string; transferDirection: TransferDirection | null } {
    if (current.type === "transfer") {
        return {
            type: "transfer",
            transferDirection: current.transferDirection ?? null,
        };
    }

    if (isTransferCategory) {
        return {
            type: "transfer",
            transferDirection:
                current.transferDirection ??
                transferDirectionForType(current.type),
        };
    }

    return { type: current.type, transferDirection: null };
}

export function transferCategoryIdSet(
    categories: readonly { id: string; categoryType: string }[]
): Set<string> {
    return new Set(
        categories
            .filter(category => category.categoryType === "TRANSFER")
            .map(category => category.id)
    );
}

export function isTransferClassified(
    transaction: TransferClassifiable,
    transferCategoryIds?: ReadonlySet<string>
): boolean {
    if (transaction.type === "transfer") {
        return true;
    }

    if (!transferCategoryIds || transferCategoryIds.size === 0) {
        return false;
    }

    return (
        (!!transaction.categoryId &&
            transferCategoryIds.has(transaction.categoryId)) ||
        (!!transaction.subcategoryId &&
            transferCategoryIds.has(transaction.subcategoryId))
    );
}
