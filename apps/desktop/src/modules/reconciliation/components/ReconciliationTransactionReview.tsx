import { useDateFormatter } from "@/core/formatting";
import { useEffect, useState } from "react";

import type { Transaction } from "@/modules/transactions/types";

import {
    ReconciliationService,
} from "../services";

interface ReconciliationTransactionReviewProps {
    accountId: string;
    statementDate: string;
}

/**
 * The reconciled state is a status, not an action - "Unmark" read as
 * a confusing action label where a user expects to see what the
 * transaction currently *is*. The toggle itself (marking/unmarking a
 * transaction as reconciled) is unchanged; only this display label
 * differs. Exported so this is unit testable without rendering the
 * component (this repo has no jsdom / component-render setup - see
 * DeletePlanComponentDialog.test.ts for the same convention).
 */
export function getReconciliationDisplayLabel(
    reconciled: boolean
): string {
    return reconciled ? "Reconciled" : "Reconcile";
}

export function ReconciliationTransactionReview({
    accountId,
    statementDate,
}: ReconciliationTransactionReviewProps) {
    const formatDate = useDateFormatter();
    const [transactions, setTransactions] =
        useState<Transaction[]>([]);

    const [loading, setLoading] =
        useState(true);

    const [error, setError] =
        useState<string | null>(null);

    const [updatingId, setUpdatingId] =
        useState<string | null>(null);

    const service =
        new ReconciliationService();

    const loadTransactions = async () => {
        setLoading(true);
        setError(null);

        try {
            const result =
                await service.getTransactionsForReview(
                    accountId,
                    statementDate
                );

            setTransactions(result);
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Unable to load transactions."
            );
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadTransactions();
    }, [accountId, statementDate]);

    const handleToggle = async (
        transaction: Transaction
    ) => {
        setUpdatingId(transaction.id);
        setError(null);

        try {
            await service.markTransactionReconciled(
                transaction.id,
                !transaction.reconciled
            );

            await loadTransactions();
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Unable to update transaction."
            );
        } finally {
            setUpdatingId(null);
        }
    };

    if (loading) {
        return (
            <div className="text-sm text-muted-foreground">
                Loading transactions...
            </div>
        );
    }

    if (error) {
        return (
            <div className="text-sm text-destructive">
                {error}
            </div>
        );
    }

    if (transactions.length === 0) {
        return (
            <div className="text-sm text-muted-foreground">
                No transactions found for this account
                up to the statement date.
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {transactions.map(transaction => (
                <div
                    key={transaction.id}
                    className="flex items-center justify-between gap-4 rounded-md border p-3"
                >
                    <div className="min-w-0">
                        <div className="font-medium">
                            Transaction
                        </div>

                        <div className="text-sm text-muted-foreground">
                            {formatDate(transaction.transactionDate)}
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <span className="text-sm font-medium">
                            {new Intl.NumberFormat(
                                "en-IN",
                                {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                }
                            ).format(
                                transaction.amount
                            )}
                        </span>

                        {transaction.reconciled ? (
                            // A status, not an action label - see
                            // getReconciliationDisplayLabel. Still
                            // calls the same handleToggle to unmark
                            // internally; only the label/styling
                            // changed from a plain "Unmark" action
                            // link to a reconciled-state pill.
                            <button
                                type="button"
                                disabled={
                                    updatingId ===
                                    transaction.id
                                }
                                onClick={() =>
                                    void handleToggle(
                                        transaction
                                    )
                                }
                                title="Reconciled - click to unmark"
                                aria-label="Reconciled. Click to unmark."
                                className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"
                            >
                                {getReconciliationDisplayLabel(
                                    true
                                )}
                            </button>
                        ) : (
                            // A matching action pill for the
                            // unreconciled state - same shape/size as
                            // the reconciled status pill, blue instead
                            // of green to read as an action rather
                            // than a state. Same handleToggle call as
                            // before; only the label/styling changed
                            // from a plain underlined text link.
                            <button
                                type="button"
                                disabled={
                                    updatingId ===
                                    transaction.id
                                }
                                onClick={() =>
                                    void handleToggle(
                                        transaction
                                    )
                                }
                                title="Reconcile this transaction"
                                aria-label="Reconcile this transaction."
                                className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
                            >
                                {getReconciliationDisplayLabel(
                                    false
                                )}
                            </button>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}


