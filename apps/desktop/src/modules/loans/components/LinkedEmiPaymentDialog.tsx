import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { formatMoney, useDisplaySettings } from "@/core/formatting";
import type { Transaction } from "@/modules/transactions/types";

import {
    LoanTransactionLinkService,
    type TransactionLinkDetails,
} from "../services/LoanTransactionLinkService";
import { OVERDRAFT_ENTRY_KIND_LABELS } from "../types";
import { emiPaymentErrorMessage } from "./emiPaymentErrorMessage";

// ---------------------------------------------------------------------
// Transactions -> the green Link to Loan EMI icon: what the transaction
// is linked to, and Unlink. Unlink removes only the loan EMI payment
// (see LoanTransactionLinkService.unlink) - the transaction is kept
// exactly as it is and can be linked again.
// ---------------------------------------------------------------------

export interface LinkedEmiPaymentDialogProps {
    transaction: Transaction | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onUnlinked?: () => Promise<void> | void;
}

/** The popup's body: which loan, which EMI, and the amount paid. */
export function LinkedEmiDetails({
    details,
    currency,
}: {
    details: TransactionLinkDetails;
    currency: string;
}) {
    return (
        <div
            data-testid="linked-emi-details"
            className="space-y-1 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700"
        >
            <div className="font-medium text-slate-900">
                Linked to {details.loanName}
            </div>
            {details.overdraftEntryKind && (
                <div>
                    Overdraft{" "}
                    {OVERDRAFT_ENTRY_KIND_LABELS[details.overdraftEntryKind].toLowerCase()}
                </div>
            )}
            {details.installmentNumber !== null && (
                <div>EMI #{details.installmentNumber}</div>
            )}
            <div>
                {details.overdraftEntryKind ? "Amount" : "Payment"}:{" "}
                {formatMoney(details.amount, {
                    currency,
                    locale: "en-IN",
                    showDecimals: true,
                })}
            </div>
        </div>
    );
}

export function LinkedEmiPaymentDialog({
    transaction,
    open,
    onOpenChange,
    onUnlinked,
}: LinkedEmiPaymentDialogProps) {
    const { defaultCurrency } = useDisplaySettings();

    const [details, setDetails] = useState<TransactionLinkDetails | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [unlinking, setUnlinking] = useState(false);

    // Blocks a second click before the disabled state has rendered.
    const inFlight = useRef(false);

    useEffect(() => {
        if (!open || !transaction) {
            return;
        }

        let cancelled = false;

        setDetails(null);
        setLoadError(null);

        new LoanTransactionLinkService()
            .getLinkDetails(transaction.id)
            .then(loaded => {
                if (!cancelled) {
                    if (loaded) {
                        setDetails(loaded);
                    } else {
                        setLoadError("This transaction is not linked to a loan any more.");
                    }
                }
            })
            .catch(error => {
                if (!cancelled) {
                    setLoadError(
                        emiPaymentErrorMessage(
                            error,
                            "The loan EMI details could not be loaded."
                        )
                    );
                }
            });

        return () => {
            cancelled = true;
        };
    }, [open, transaction]);

    async function handleUnlink() {
        if (!transaction || !details || inFlight.current) {
            return;
        }

        inFlight.current = true;

        try {
            setUnlinking(true);

            await new LoanTransactionLinkService().unlink(transaction.id);

            toast.success("Unlinked. The transaction is kept and can be linked again.");

            await onUnlinked?.();
            onOpenChange(false);
        } catch (error) {
            toast.error(
                emiPaymentErrorMessage(
                    error,
                    "The transaction could not be unlinked."
                )
            );
        } finally {
            inFlight.current = false;
            setUnlinking(false);
        }
    }

    if (!transaction) {
        return null;
    }

    return (
        <Dialog
            open={open}
            onOpenChange={next => {
                if (!unlinking) {
                    onOpenChange(next);
                }
            }}
        >
            <DialogContent
                showCloseButton={!unlinking}
                className="
                    w-[420px]
                    max-w-[calc(100vw-48px)]
                    rounded-[24px]
                    border
                    border-slate-100
                    bg-white
                    p-0
                    shadow-lg
                "
            >
                <DialogHeader className="px-7 pb-4 pt-6">
                    <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">
                        {details?.overdraftEntryKind
                            ? "Linked to Overdraft"
                            : "Linked to Loan EMI"}
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm leading-6 text-slate-500">
                        {transaction.payee || "This transaction"} is recorded
                        as{" "}
                        {details?.overdraftEntryKind
                            ? "an overdraft movement."
                            : "a loan EMI payment."}
                    </DialogDescription>
                </DialogHeader>

                <div className="px-7 pb-6">
                    {loadError ? (
                        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                            {loadError}
                        </div>
                    ) : !details ? (
                        <div className="text-sm text-slate-500">Loading...</div>
                    ) : (
                        <LinkedEmiDetails
                            details={details}
                            currency={defaultCurrency}
                        />
                    )}
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-7 py-5">
                    <button
                        type="button"
                        disabled={unlinking}
                        onClick={() => onOpenChange(false)}
                        className="h-9 rounded-lg border border-slate-300 bg-white px-5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Close
                    </button>

                    <button
                        type="button"
                        disabled={!details || unlinking}
                        onClick={handleUnlink}
                        className="h-9 cursor-pointer rounded-lg bg-slate-900 px-5 text-sm font-medium text-white shadow-sm transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {unlinking ? "Unlinking..." : "Unlink"}
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
