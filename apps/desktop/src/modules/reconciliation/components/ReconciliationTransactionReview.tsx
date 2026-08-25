import { useEffect, useState } from "react";

import type { Transaction } from "@/modules/transactions/types";

import {
    ReconciliationService,
} from "../services";

interface ReconciliationTransactionReviewProps {
    accountId: string;
    statementDate: string;
}

export function ReconciliationTransactionReview({
    accountId,
    statementDate,
}: ReconciliationTransactionReviewProps) {
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
                            {transaction.transactionDate}
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
                            className="text-sm underline"
                        >
                            {transaction.reconciled
                                ? "Unmark"
                                : "Reconcile"}
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}

