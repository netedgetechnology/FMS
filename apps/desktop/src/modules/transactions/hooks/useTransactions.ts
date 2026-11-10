import { useCallback, useEffect, useRef, useState } from "react";

import {
    InitialLoadTracker,
    reportBackgroundRefreshFailure,
} from "@/core/async/InitialLoadTracker";
import { LatestRequestGuard } from "@/core/async/LatestRequestGuard";

import { TransactionService } from "../services";
import { Transaction } from "../types";

// The list order TransactionRepository.getAll() returns: newest
// transaction_date first, then newest created_at.
function compareListOrder(a: Transaction, b: Transaction): number {
    return (
        b.transactionDate.localeCompare(a.transactionDate) ||
        b.createdAt.localeCompare(a.createdAt)
    );
}

/**
 * The list with one saved transaction swapped in place - no reload. Its
 * position only moves when its date changed (to where getAll() would put
 * it); every other row keeps its order. An id not in the list leaves the
 * list unchanged.
 */
export function replaceTransactionInList(
    transactions: readonly Transaction[],
    updated: Transaction
): Transaction[] {
    const index = transactions.findIndex(item => item.id === updated.id);

    if (index === -1) {
        return [...transactions];
    }

    const next = [...transactions];
    const previous = next[index]!;

    next[index] = updated;

    if (previous.transactionDate === updated.transactionDate) {
        return next;
    }

    // Array.prototype.sort is stable, so equal rows keep their order.
    return next.sort(compareListOrder);
}

/**
 * The list with saved transactions swapped in place (see
 * replaceTransactionInList) and any not yet in it - newly added - put
 * where getAll() would put them.
 */
export function upsertTransactionsInList(
    transactions: readonly Transaction[],
    saved: readonly Transaction[]
): Transaction[] {
    let next = [...transactions];
    const added: Transaction[] = [];

    for (const transaction of saved) {
        if (next.some(item => item.id === transaction.id)) {
            next = replaceTransactionInList(next, transaction);
        } else {
            added.push(transaction);
        }
    }

    return added.length === 0 ? next : [...added, ...next].sort(compareListOrder);
}

/**
 * After a save has succeeded: reads the saved rows back as stored (the
 * service may have resolved type / transfer direction) and puts them in
 * the list in place. Never throws - the save itself already succeeded, so
 * a failed read-back must not be reported as a failed save: it falls back
 * to a background refresh() instead, as does a row that can't be found.
 */
export async function applySavedTransactions(
    service: Pick<TransactionService, "getByIds">,
    ids: readonly string[],
    upsert: (saved: readonly Transaction[]) => void,
    refresh: () => Promise<void> | void
): Promise<void> {
    if (ids.length === 0) {
        return;
    }

    try {
        const saved = await service.getByIds(ids);

        upsert(saved);

        if (saved.length !== new Set(ids).size) {
            await refresh();
        }
    } catch (error) {
        console.error("Failed to read saved transactions back:", error);
        await refresh();
    }
}

/** The list without the given (deleted) transactions; order unchanged. */
export function removeTransactionsFromList(
    transactions: readonly Transaction[],
    ids: Iterable<string>
): Transaction[] {
    const removed = new Set(ids);

    return transactions.filter(transaction => !removed.has(transaction.id));
}

export function useTransactions() {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // See LatestRequestGuard / InitialLoadTracker: a stale load never
    // wins, and only the first load blanks the list - a refresh keeps the
    // rows (and the page's search, filters, page and scroll) on screen.
    const requestGuard = useRef(new LatestRequestGuard());
    const loadTracker = useRef(new InitialLoadTracker());

    const refresh = useCallback(async () => {
        const requestId = requestGuard.current.start();

        try {
            if (loadTracker.current.showsLoading()) {
                setLoading(true);
            }
            setError(null);

            const service = new TransactionService();
            const data = await service.getAll();

            if (requestGuard.current.isStale(requestId)) {
                return;
            }

            setTransactions(data);
            loadTracker.current.markLoaded();
        } catch (err) {
            if (requestGuard.current.isStale(requestId)) {
                return;
            }

            if (loadTracker.current.hasLoaded) {
                reportBackgroundRefreshFailure("transactions", err);
                return;
            }

            console.error("Failed to load transactions:", err);
            setError("Unable to load transactions. Please try again.");
        } finally {
            if (!requestGuard.current.isStale(requestId)) {
                setLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    // In-place updates after a mutation whose saved rows are known - no
    // reload at all. Each also supersedes a background refresh still in
    // flight, so an older list can never overwrite the change (never the
    // first load: the list would be left with only these rows).
    const supersedeRefresh = useCallback(() => {
        if (loadTracker.current.hasLoaded) {
            requestGuard.current.start();
        }
    }, []);

    // Updates one row after an edit.
    const replaceTransaction = useCallback((updated: Transaction) => {
        supersedeRefresh();
        setTransactions(previous =>
            replaceTransactionInList(previous, updated)
        );
    }, [supersedeRefresh]);

    // Inserts new rows / replaces changed ones (add, bulk change, move).
    const upsertTransactions = useCallback((saved: readonly Transaction[]) => {
        supersedeRefresh();
        setTransactions(previous => upsertTransactionsInList(previous, saved));
    }, [supersedeRefresh]);

    // Drops deleted rows.
    const removeTransactions = useCallback((ids: Iterable<string>) => {
        supersedeRefresh();
        const removed = [...ids];
        setTransactions(previous => removeTransactionsFromList(previous, removed));
    }, [supersedeRefresh]);

    return {
        transactions,
        loading,
        error,
        refresh,
        replaceTransaction,
        upsertTransactions,
        removeTransactions,
    };
}
