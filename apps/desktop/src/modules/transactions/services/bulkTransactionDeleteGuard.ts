export type BulkTransactionDeleteDecision =
    | {
          allowed: true;
          blockedTransactionIds: [];
          message: null;
      }
    | {
          allowed: false;
          blockedTransactionIds: string[];
          message: string;
      };

/**
 * Pre-validation for BulkDeleteTransactionsDialog (Transactions -
 * safer bulk delete): given the selected batch and the subset of it
 * that TransactionService.findEmiLinkedTransactionIds reports as
 * EMI-linked, decides whether the whole batch may proceed. Kept as a
 * small pure function, separate from the dialog's async data
 * fetching, so the block/allow decision and its message are directly
 * unit-testable.
 *
 * Any EMI-linked transaction in the batch blocks the entire batch -
 * nothing in it is deleted, ordinary or not, so the dialog never
 * partially processes a selection up to the first one
 * TransactionService.delete() would itself refuse.
 */
export function evaluateBulkTransactionDelete(
    selectedTransactionIds: readonly string[],
    emiLinkedTransactionIds: readonly string[]
): BulkTransactionDeleteDecision {
    const emiLinked = new Set(emiLinkedTransactionIds);

    const blockedTransactionIds =
        selectedTransactionIds.filter(id =>
            emiLinked.has(id)
        );

    if (blockedTransactionIds.length === 0) {
        return {
            allowed: true,
            blockedTransactionIds: [],
            message: null,
        };
    }

    const count = blockedTransactionIds.length;

    return {
        allowed: false,
        blockedTransactionIds,
        message: `${count} of the selected transaction${
            count === 1 ? "" : "s"
        } record${
            count === 1 ? "s" : ""
        } a loan EMI payment and can't be deleted here. Open the loan's EMI schedule and reverse the payment${
            count === 1 ? "" : "s"
        } first, then try again. No transactions were deleted.`,
    };
}
