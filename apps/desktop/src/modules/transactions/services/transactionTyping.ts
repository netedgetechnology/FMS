import {
    debitCreditTypeForDirection,
    transferDirectionForType,
    type TransferDirection,
} from "@/core/accounting/transferClassification";
import type { CategoryType } from "@/modules/categories/types";

// ---------------------------------------------------------------------
// Transaction Type and Transfer direction in the Add / Edit Transaction
// form (TransactionForm).
//
// Selecting a category sets the Type to that category's type - its
// account / business-entity mapping when one applies (a lock), else the
// category's own configured type: INCOME -> Income, EXPENSE -> Expense,
// TRANSFER -> Transfer. A Transfer category can also say which way its
// transfers go (categories.transfer_direction, set in Edit Category):
// selecting it sets that direction - e.g. a drawdown category In, a
// repayment category Out. Only the category's configuration is used,
// never its name. Opening a saved transaction never changes its Type or
// direction.
//
// The direction is never typed in. When it must be derived, in order:
//   1. Income / Expense picked BY HAND in the Type field;
//   2. the selected category's configured direction;
//   3. the bank statement's side (imported, still on its statement's
//      account);
//   4. the Income / Expense the form shows or last showed.
//
// The bank statement stays authoritative for how money actually moved:
// a category direction that contradicts it, or a saved direction that
// contradicts the category, BLOCKS saving until the user changes the
// category or the Type - nothing is reversed or recategorised for them.
// ---------------------------------------------------------------------

export type FormTransactionType = "income" | "expense" | "transfer";

export type DebitCreditSide = "income" | "expense";

/** The Type a newly selected category sets, or null to leave it as it is. */
export function typeForSelectedCategory(
    resolvedCategoryType: CategoryType | null | undefined
): FormTransactionType | null {
    switch (resolvedCategoryType) {
        case "INCOME":
            return "income";
        case "EXPENSE":
            return "expense";
        case "TRANSFER":
            return "transfer";
        default:
            return null;
    }
}

/**
 * The Income / Expense side a transaction opens with, for deriving a
 * Transfer's direction: its own Income/Expense type (Add: Expense). null
 * for a saved transfer - it keeps the direction it was saved with.
 */
export function initialDebitCreditSide(
    type: FormTransactionType | undefined,
    statementSide: DebitCreditSide | null | undefined
): DebitCreditSide | null {
    if (statementSide) {
        return statementSide;
    }

    if (type === "income" || type === "expense") {
        return type;
    }

    return type === "transfer" ? null : "expense";
}

/**
 * A category's configured Transfer direction (categories.transfer_direction)
 * - only for a TRANSFER category; null for any other category, for an
 * either-way Transfer category, or for no category.
 */
export function categoryTransferDirection(
    category: {
        categoryType: CategoryType;
        transferDirection?: TransferDirection | null;
    } | null | undefined
): TransferDirection | null {
    return category?.categoryType === "TRANSFER"
        ? category.transferDirection ?? null
        : null;
}

/** The Debit/Credit side a Type + direction moves the account on. */
export function sideOf(
    type: FormTransactionType,
    transferDirection: TransferDirection | null | undefined
): DebitCreditSide | null {
    return type === "transfer"
        ? debitCreditTypeForDirection(transferDirection)
        : type;
}

/** The side a Transfer's direction is derived from - see the order above. */
export function derivationSideFor(params: {
    manualSide: DebitCreditSide | null | undefined;
    categoryDirection: TransferDirection | null | undefined;
    statementSide: DebitCreditSide | null | undefined;
    shownSide: DebitCreditSide | null | undefined;
}): DebitCreditSide | null {
    return (
        params.manualSide ??
        debitCreditTypeForDirection(params.categoryDirection) ??
        params.statementSide ??
        params.shownSide ??
        null
    );
}

/**
 * Exactly what the form saves - the Type and direction it submits, so
 * the message shown and the record saved can never differ:
 *  - a Transfer keeps its direction, or (if it has none yet) takes it
 *    from `derivationSide`;
 *  - Income / Expense on a Transfer category is saved as a Transfer (the
 *    service's rule, applyTransferCategoryRule) whose direction comes
 *    from `derivationSide`;
 *  - anything else is saved as shown.
 */
export function finalTyping(params: {
    type: FormTransactionType;
    transferDirection: TransferDirection | null | undefined;
    isTransferCategory: boolean;
    derivationSide: DebitCreditSide | null | undefined;
}): { type: FormTransactionType; transferDirection: TransferDirection | null } {
    const { type, transferDirection, isTransferCategory, derivationSide } =
        params;

    if (type === "transfer") {
        return {
            type,
            transferDirection:
                transferDirection ??
                (derivationSide ? transferDirectionForType(derivationSide) : null),
        };
    }

    if (isTransferCategory) {
        return {
            type: "transfer",
            transferDirection: transferDirectionForType(derivationSide ?? type),
        };
    }

    return { type, transferDirection: null };
}

/**
 * The notice when the Type the user chose is NOT what will be saved:
 * Income / Expense on a Transfer category is saved as a Transfer (the
 * category decides - see finalTyping / applyTransferCategoryRule), so
 * say so plainly, with the way to really change it. null otherwise.
 */
export function transferCategoryTypeNotice(params: {
    chosenType: FormTransactionType;
    saved: { type: FormTransactionType; transferDirection: TransferDirection | null };
    categoryName: string | null | undefined;
}): string | null {
    const { chosenType, saved } = params;

    if (chosenType === "transfer" || saved.type !== "transfer") {
        return null;
    }

    const category = params.categoryName?.trim() || "This category";
    const direction = saved.transferDirection === "IN" ? "Transfer In" : saved.transferDirection === "OUT" ? "Transfer Out" : "Transfer";
    const chosen = chosenType === "income" ? "Income" : "Expense";

    return `${category} is a Transfer category, so this is saved as ${direction}, not ${chosen}. To save it as ${chosen === "Income" ? "an Income" : "an Expense"}, choose ${chosen === "Income" ? "an income" : "an expense"} category.`;
}

/** The saved type, as the success message names it: "Expense", "Transfer Out"... */
export function savedTypeLabel(saved: { type: string; transferDirection?: TransferDirection | null } | null | undefined): string | null {
    if (!saved) return null;
    if (saved.type === "transfer") {
        return saved.transferDirection === "IN" ? "Transfer In" : saved.transferDirection === "OUT" ? "Transfer Out" : "Transfer";
    }
    return saved.type === "income" ? "Income" : saved.type === "expense" ? "Expense" : null;
}

const SIDE_WORDS: Record<DebitCreditSide, string> = {
    income: "money in (a credit)",
    expense: "money out (a debit)",
};

const DIRECTION_WORDS: Record<TransferDirection, string> = {
    IN: "Transfer In (money in)",
    OUT: "Transfer Out (money out)",
};

/** The overdraft movement kinds and the side each requires. */
const LINK_KIND_SIDE: Record<string, { label: string; side: DebitCreditSide }> = {
    DRAWDOWN: { label: "Drawdown", side: "income" },
    REPAYMENT: { label: "Repayment", side: "expense" },
    INTEREST_CHARGE: { label: "Interest / Charge", side: "expense" },
};

/**
 * What happens to an overdraft link when its transaction is saved on
 * `savedSide`:
 *  - "keep": the link's movement still fits (Drawdown = money in,
 *    Repayment / Interest-Charge = money out);
 *  - a new kind: a principal movement whose side was corrected follows
 *    it - Repayment <-> Drawdown - so the OD never counts a corrected
 *    credit as a repayment (or a debit as a drawdown);
 *  - "refuse": an Interest / Charge link can't become money in - there
 *    is no fitting principal kind to guess; unlink it first.
 */
export function relinkedMovementKind(
    linkedMovementKind: string | null | undefined,
    savedSide: DebitCreditSide | null
): "keep" | "refuse" | "DRAWDOWN" | "REPAYMENT" {
    const linked = linkedMovementKind ? LINK_KIND_SIDE[linkedMovementKind] : undefined;

    if (!linked || !savedSide || linked.side === savedSide) {
        return "keep";
    }

    if (linkedMovementKind === "REPAYMENT") {
        return "DRAWDOWN";
    }

    if (linkedMovementKind === "DRAWDOWN") {
        return "REPAYMENT";
    }

    return "refuse";
}

export interface DirectionChecks {
    /** Conflicts that must be resolved before saving. */
    blocking: string[];
    /** Worth knowing, but saving is allowed. */
    warnings: string[];
}

/**
 * What is wrong with saving `savedSide`, in plain language. Blocking:
 *  - the category's direction contradicts the bank statement (e.g. a
 *    repayment category on a statement credit);
 *  - the saved direction contradicts the category's direction (e.g. a
 *    Type picked by hand, or a saved transfer opened on another
 *    category);
 *  - THIS edit changes the side to one the bank statement contradicts
 *    (a manual override never bypasses the statement).
 * Warnings: a contradiction with the statement the transaction already
 * had (nothing in this edit causes it), a change of sign (shown so it
 * is never silent), or a side that no longer fits the overdraft movement
 * the transaction is linked as.
 */
export function directionChecks(params: {
    savedSide: DebitCreditSide | null;
    statementSide: DebitCreditSide | null | undefined;
    categoryName: string | null | undefined;
    categoryDirection: TransferDirection | null | undefined;
    linkedMovementKind: string | null | undefined;
    /** Edit only: the side the transaction had when opened. */
    originalSide?: DebitCreditSide | null;
    /**
     * Edit only: false when this edit changes the category, Type or
     * direction. A contradiction with the statement is only tolerated
     * (as a warning) on an edit that leaves all three as they were.
     */
    typingUnchanged?: boolean;
}): DirectionChecks {
    const {
        savedSide,
        statementSide,
        categoryName,
        categoryDirection,
        linkedMovementKind,
        originalSide = null,
        typingUnchanged = true,
    } = params;

    const blocking: string[] = [];
    const warnings: string[] = [];
    const categorySide = debitCreditTypeForDirection(categoryDirection);
    const name = categoryName ? `"${categoryName}"` : "This category";

    if (categoryDirection && categorySide && statementSide && categorySide !== statementSide) {
        blocking.push(
            `${name} is for ${DIRECTION_WORDS[categoryDirection]}, but the bank statement shows this transaction as ${SIDE_WORDS[statementSide]}. Choose a category that matches the statement before saving.`
        );
    } else if (categoryDirection && categorySide && savedSide && categorySide !== savedSide) {
        blocking.push(
            `${name} is for ${DIRECTION_WORDS[categoryDirection]}, but this would be saved as ${SIDE_WORDS[savedSide]}. Change the category or the Type before saving.`
        );
    } else if (statementSide && savedSide && statementSide !== savedSide) {
        if (originalSide && originalSide === savedSide && typingUnchanged) {
            // Already like this before the edit, and the edit doesn't
            // touch the category / Type - flagged, not blocked, so an
            // unrelated edit (e.g. Notes) is still possible.
            warnings.push(
                `The bank statement shows this as ${SIDE_WORDS[statementSide]}, but it is saved as ${SIDE_WORDS[savedSide]}. Correct its Type or category to match the statement.`
            );
        } else {
            blocking.push(
                `The bank statement shows this as ${SIDE_WORDS[statementSide]}; it can't be saved as ${SIDE_WORDS[savedSide]}. Choose the Type or category that matches the statement.`
            );
        }
    }

    // A change of sign is never silent.
    if (originalSide && savedSide && originalSide !== savedSide && blocking.length === 0) {
        warnings.push(
            originalSide === "expense"
                ? "This changes the transaction from money out (-) to money in (+)."
                : "This changes the transaction from money in (+) to money out (-)."
        );
    }

    const linked = linkedMovementKind ? LINK_KIND_SIDE[linkedMovementKind] : undefined;
    const relinked = relinkedMovementKind(linkedMovementKind, savedSide);

    if (linked && relinked === "refuse") {
        blocking.push(
            `This transaction is linked to an overdraft as an ${linked.label} (money out). It can't be saved as money in while linked - unlink it first.`
        );
    } else if (linked && (relinked === "DRAWDOWN" || relinked === "REPAYMENT")) {
        warnings.push(
            `Its overdraft link will change from ${linked.label} to ${LINK_KIND_SIDE[relinked]!.label}, to match.`
        );
    }

    return { blocking, warnings };
}
