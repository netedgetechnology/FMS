import { getErrorMessage } from "@/core/errors";
import { AccountType, type Account } from "@/modules/accounts/types";

import type { Transaction } from "../types";

// ---------------------------------------------------------------------
// Transactions - bulk "Move to Account".
//
// Reassigns existing transactions to another account (e.g. a statement
// imported into the wrong account): only account_id changes. It is NOT a
// money transfer - no transaction is created, deleted or re-typed, no
// transfer record is written, and no opening balance changes. Every other
// field (id, date, amount, payee, category, type/direction, notes,
// reference, reconciliation state, import linkage) stays as it is; import
// history and learned rules are not touched.
//
// So the total financial position can't change merely because rows moved,
// both ends must be ordinary ledger accounts whose balance IS opening
// balance + transactions: LOAN and INVESTMENT accounts are excluded (their
// balances are projections of the loans / investments domains, so rows
// moved in or out would silently change Net Worth), and amounts are never
// reinterpreted across currencies.
// ---------------------------------------------------------------------

export type BulkMoveTransaction = Pick<Transaction, "id" | "accountId">;

export type BulkMoveAccount = Pick<
    Account,
    "id" | "name" | "type" | "currencyId" | "isActive"
>;

const NON_LEDGER_ACCOUNT_TYPES: ReadonlySet<string> = new Set([
    AccountType.LOAN,
    AccountType.INVESTMENT,
]);

export function isLedgerAccount(account: Pick<Account, "type">): boolean {
    return !NON_LEDGER_ACCOUNT_TYPES.has(account.type);
}

// Why the selected transactions can't be moved to `destination` at all,
// or null when they can. `accountsById` must cover the transactions'
// current (source) accounts.
export function bulkMoveBlockReason(
    transactions: readonly BulkMoveTransaction[],
    destination: BulkMoveAccount,
    accountsById: ReadonlyMap<string, BulkMoveAccount>
): string | null {
    if (!destination.isActive) {
        return `"${destination.name}" is inactive.`;
    }

    if (!isLedgerAccount(destination)) {
        return `Transactions can't be moved into a ${destination.type === AccountType.LOAN ? "loan" : "investment"} account.`;
    }

    for (const transaction of transactions) {
        const source = accountsById.get(transaction.accountId);

        if (!source) {
            continue;
        }

        if (!isLedgerAccount(source)) {
            return `Transactions in "${source.name}" can't be moved - its balance comes from the ${source.type === AccountType.LOAN ? "loan" : "investment"} itself.`;
        }

        if (source.currencyId !== destination.currencyId) {
            return `"${destination.name}" uses a different currency than "${source.name}" - amounts would be reinterpreted.`;
        }
    }

    if (
        transactions.length > 0 &&
        transactions.every(
            transaction => transaction.accountId === destination.id
        )
    ) {
        return `The selected transactions are already in "${destination.name}".`;
    }

    return null;
}

// The destination choices for the dialog: every active account the
// selected transactions can be moved to (see bulkMoveBlockReason) - the
// selection's own single account is therefore never offered.
export function accountsForBulkMove(
    accounts: readonly BulkMoveAccount[],
    transactions: readonly BulkMoveTransaction[]
): BulkMoveAccount[] {
    const accountsById = new Map(
        accounts.map(account => [account.id, account])
    );

    return accounts.filter(
        account =>
            bulkMoveBlockReason(transactions, account, accountsById) === null
    );
}

function transactionsLabel(count: number): string {
    return `${count} transaction${count === 1 ? "" : "s"}`;
}

// Runs the one atomic update (TransactionService.moveToAccount). One
// success toast, or one error toast - in which case nothing moved.
export async function runBulkAccountMove(
    service: {
        moveToAccount: (
            transactionIds: readonly string[],
            accountId: string
        ) => Promise<{ moved: number }>;
    },
    transactionIds: readonly string[],
    account: Pick<Account, "id" | "name">,
    notify: {
        success: (message: string) => unknown;
        error: (message: string) => unknown;
    }
): Promise<{ moved: boolean }> {
    try {
        const { moved } = await service.moveToAccount(
            transactionIds,
            account.id
        );

        notify.success(`${transactionsLabel(moved)} moved to ${account.name}.`);

        return { moved: true };
    } catch (error) {
        console.error("Failed to move transactions:", error);

        notify.error(
            `Failed to move transactions - none were moved. ${getErrorMessage(
                error,
                "Please try again."
            )}`
        );

        return { moved: false };
    }
}
