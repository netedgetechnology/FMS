export type TransactionAmountDirection =
    | "income"
    | "expense"
    | "transfer"
    | null
    | undefined;

// A transaction's stored amount is always a positive magnitude - direction
// (debit/credit) lives in `type`, never in the sign of `amount` itself (see
// NormalizedTransactionCandidate / Transaction). This resolves that pair
// into the signed number used purely for *display*: expense/debit negative,
// income/credit positive. Transfers (no debit/credit direction) are left as
// their plain magnitude, matching the existing neutral (non-colored)
// treatment used elsewhere for that type - never given an invented sign.
export function signedTransactionAmount(
    amount: number,
    type: TransactionAmountDirection
): number {
    if (type === "expense") {
        return -Math.abs(amount);
    }

    if (type === "income") {
        return Math.abs(amount);
    }

    return amount;
}
