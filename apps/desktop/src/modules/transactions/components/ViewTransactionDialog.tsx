import {
    signedTransactionAmount,
    useDateFormatter,
} from "@/core/formatting";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import type { Transaction } from "../types";

export interface ViewTransactionDialogProps {
    transaction: Transaction | null;
    accountName?: string;
    categoryName?: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

function formatType(type: Transaction["type"]): string {
    return type
        .toLowerCase()
        .replace("_", " ")
        .replace(/\b\w/g, char => char.toUpperCase());
}


function formatAmount(amount: number): string {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2,
        signDisplay: "exceptZero",
    }).format(Number(amount ?? 0));
}

function Detail({
    label,
    value,
}: {
    label: string;
    value: string;
}) {
    return (
        <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                {label}
            </div>

            <div className="text-sm text-slate-800">
                {value || "—"}
            </div>
        </div>
    );
}

export function ViewTransactionDialog({
    transaction,
    accountName,
    categoryName,
    open,
    onOpenChange,
}: ViewTransactionDialogProps) {
    const formatDate = useDateFormatter();
    if (!transaction) {
        return null;
    }

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
        >
            <DialogContent
                showCloseButton
                className="
                    w-[680px]
                    max-w-[calc(100vw-48px)]
                    rounded-[28px]
                    border
                    border-slate-100
                    bg-white
                    p-0
                    shadow-lg
                "
            >
                <DialogHeader className="px-7 pb-5 pt-6">
                    <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">
                        Transaction Details
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        View transaction information.
                    </DialogDescription>
                </DialogHeader>

                <div className="border-t border-slate-100 px-7 py-6">
                    <div className="grid grid-cols-2 gap-x-8 gap-y-6">
                        <Detail
                            label="Payee"
                            value={transaction.payee}
                        />

                        <Detail
                            label="Amount"
                            value={formatAmount(
                                signedTransactionAmount(
                                    transaction.amount,
                                    transaction.type
                                )
                            )}
                        />

                        <Detail
                            label="Account"
                            value={accountName || transaction.accountId}
                        />

                        <Detail
                            label="Category"
                            value={
                                transaction.categoryId
                                    ? categoryName || transaction.categoryId
                                    : "None"
                            }
                        />

                        <Detail
                            label="Transaction Type"
                            value={formatType(transaction.type)}
                        />

                        <Detail
                            label="Transaction Date"
                            value={formatDate(transaction.transactionDate)}
                        />

                        <Detail
                            label="Reference Number"
                            value={transaction.referenceNumber || "—"}
                        />

                        <Detail
                            label="Created"
                            value={formatDate(transaction.createdAt)}
                        />

                        <div className="col-span-2 space-y-1">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                                Notes
                            </div>

                            <div className="whitespace-pre-wrap text-sm text-slate-800">
                                {transaction.notes || "—"}
                            </div>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}




