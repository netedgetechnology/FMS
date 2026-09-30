// An account's stored `openingBalance` (from AccountRepository - for a
// LOAN account this is already a read-time projection of its
// outstanding principal/interest, not a literal opening balance; see
// AccountRepository.getAll()) is a snapshot, not a running balance.
// Every income/expense transaction posted against the account since
// then must be added/subtracted on top of it to get the account's
// actual current balance - this is the one formula both the Accounts
// page and the Dashboard's Accounts Summary use, so the two can never
// disagree about what an account is worth again.

import { balanceSide } from "@/core/accounting/transferClassification";

export interface AccountBalanceTransaction {
    accountId: string;
    type: string;
    amount: number;
    /** For type "transfer": "OUT" / "IN" (see balanceSide). */
    transferDirection?: string | null;
}

export interface AccountBalanceSource {
    id: string;
    openingBalance: number;
}

/**
 * Nets every transaction's balance movement per account into a single
 * delta, keyed by account id: income (+), expense (-), and a transfer
 * by its direction - OUT (-) / IN (+) - see balanceSide. A transfer is
 * never income or expense, but it still moves its account's balance. A
 * legacy transfer with no recorded direction (and any other type) is
 * skipped, as before.
 */
export function computeAccountTransactionDeltas(
    transactions: readonly AccountBalanceTransaction[]
): Map<string, number> {
    const deltas = new Map<string, number>();

    for (const transaction of transactions) {
        const side = balanceSide(transaction);

        if (!side) {
            continue;
        }

        const amount = Math.abs(Number(transaction.amount) || 0);
        const signedAmount =
            side === "income" ? amount : -amount;

        deltas.set(
            transaction.accountId,
            (deltas.get(transaction.accountId) ?? 0) + signedAmount
        );
    }

    return deltas;
}

/**
 * An account's current balance: its stored opening balance plus every
 * income/expense transaction posted against it (see
 * computeAccountTransactionDeltas). Accepts the deltas map rather than
 * the raw transaction list so callers computing this for many accounts
 * at once (e.g. the Accounts page) only walk the transaction list once.
 */
export function computeAccountCurrentBalance(
    account: AccountBalanceSource,
    deltas: ReadonlyMap<string, number>
): number {
    return (
        (Number(account.openingBalance) || 0) +
        (deltas.get(account.id) ?? 0)
    );
}

/**
 * Current balances for every given account, keyed by account id -
 * convenience wrapper over computeAccountTransactionDeltas +
 * computeAccountCurrentBalance for callers (e.g. the Accounts page)
 * that need the whole set at once.
 */
export function computeAccountCurrentBalances(
    accounts: readonly AccountBalanceSource[],
    transactions: readonly AccountBalanceTransaction[]
): Map<string, number> {
    const deltas = computeAccountTransactionDeltas(transactions);

    return new Map(
        accounts.map(account => [
            account.id,
            computeAccountCurrentBalance(account, deltas),
        ])
    );
}
