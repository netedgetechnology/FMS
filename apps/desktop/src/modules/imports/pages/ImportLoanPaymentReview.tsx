import { useState } from "react";
import { Landmark } from "lucide-react";

import { formatMoney, useDisplaySettings } from "@/core/formatting";
import { LinkTransactionToEmiDialog } from "@/modules/loans/components/LinkTransactionToEmiDialog";
import type { LoanImportPaymentForReview } from "@/modules/loans/services/LoanImportPaymentService";
import { TransactionRepository } from "@/modules/transactions/repositories/TransactionRepository";
import type { Transaction } from "@/modules/transactions/types";

// ---------------------------------------------------------------------
// After a confirmed import: the debits that looked like a loan EMI but
// were NOT applied automatically (ambiguous, an earlier EMI unpaid, an
// amount that is not exactly what remains, ...). Each can be linked to a
// loan EMI right here, through the same Link to Loan EMI dialog as on
// Transactions - the imported transaction itself becomes the payment, no
// new transaction is created. A link made here is also what later
// imports learn from (see loanImportMatching.ts).
// ---------------------------------------------------------------------

export interface ImportLoanPaymentReviewProps {
    items: readonly LoanImportPaymentForReview[];
    onLinked: (transactionId: string) => void;
}

export function ImportLoanPaymentReview({
    items,
    onLinked,
}: ImportLoanPaymentReviewProps) {
    const { defaultCurrency } = useDisplaySettings();
    const [linking, setLinking] = useState<Transaction | null>(null);
    const [loadingId, setLoadingId] = useState<string | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    if (items.length === 0) {
        return null;
    }

    const openLink = async (transactionId: string) => {
        setLoadError(null);
        setLoadingId(transactionId);

        try {
            const transaction =
                await new TransactionRepository().getById(transactionId);

            if (!transaction) {
                setLoadError("That transaction no longer exists.");
                return;
            }

            setLinking(transaction);
        } catch (error) {
            console.error("Failed to load transaction for loan link:", error);
            setLoadError("The transaction could not be loaded.");
        } finally {
            setLoadingId(null);
        }
    };

    return (
        <div
            data-testid="import-loan-review"
            className="mt-5 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
            <div className="font-medium">
                Loan payments that need your attention
            </div>

            <ul className="mt-2 space-y-2">
                {items.map((item, index) => {
                    const transactionId = item.transactionId;

                    return (
                        <li
                            key={transactionId ?? `unchecked-${index}`}
                            className="flex flex-wrap items-start justify-between gap-3"
                        >
                            <div className="min-w-0 flex-1">
                                {transactionId && (
                                    <div>
                                        {formatMoney(item.amount, {
                                            currency: defaultCurrency,
                                            locale: "en-IN",
                                            showDecimals: true,
                                        })}{" "}
                                        on {item.transactionDate}
                                        {item.loanNames.length > 0 &&
                                            ` (${item.loanNames.join(", ")})`}
                                    </div>
                                )}
                                <div className={transactionId ? "text-xs text-amber-800" : undefined}>
                                    {item.reason}
                                </div>
                            </div>

                            {/* An import that could not be checked at all
                                names no transaction - those are linked
                                from Transactions. */}
                            {transactionId && (
                                <button
                                    type="button"
                                    onClick={() => void openLink(transactionId)}
                                    disabled={loadingId !== null}
                                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-60"
                                >
                                    <Landmark size={14} />
                                    Link to Loan EMI
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>

            {loadError && (
                <div className="mt-2 text-xs text-red-600">{loadError}</div>
            )}

            <LinkTransactionToEmiDialog
                transaction={linking}
                open={linking !== null}
                onOpenChange={open => {
                    if (!open) {
                        setLinking(null);
                    }
                }}
                onSuccess={() => {
                    if (linking) {
                        onLinked(linking.id);
                    }
                }}
            />
        </div>
    );
}
