import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import { TransactionService } from "../services";
import type { Transaction } from "../types";
import type { TransactionFormValues } from "../validation";

import { TransactionForm } from "./TransactionForm";

export interface EditTransactionDialogProps {
    transaction: Transaction | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => Promise<void> | void;
}

function getDefaultValues(
    transaction: Transaction
): Partial<TransactionFormValues> {
    return {
        accountId: transaction.accountId,
        categoryId: transaction.categoryId ?? "",
        subcategoryId: transaction.subcategoryId ?? "",
        payee: transaction.payee,
        type: transaction.type,
        amount: Number(transaction.amount ?? 0),
        transactionDate: transaction.transactionDate,
        referenceNumber: transaction.referenceNumber ?? "",
        notes: transaction.notes ?? "",
        tags: transaction.tags ?? "",
        status: transaction.status ?? "CLEARED",
        paymentMethod: transaction.paymentMethod ?? null,
        upiReference: transaction.upiReference ?? "",
        bankTransactionReference:
            transaction.bankTransactionReference ?? "",
        cardReference: transaction.cardReference ?? "",
    };
}

export function EditTransactionDialog({
    transaction,
    open,
    onOpenChange,
    onSuccess,
}: EditTransactionDialogProps) {
    const service = new TransactionService();

    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open) {
            setLoading(false);
        }
    }, [open]);

    async function handleSubmit(values: TransactionFormValues) {
        if (!transaction) {
            return;
        }

        try {
            setLoading(true);

            await service.update({
                id: transaction.id,
                ...values,
            });

            await onSuccess?.();

            toast.success("Transaction updated successfully.");

            onOpenChange(false);
        } catch (error) {
            console.error(
                "Failed to update transaction:",
                error
            );

            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to update transaction. Please try again."
            );
        } finally {
            setLoading(false);
        }
    }

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
                    flex
                    w-[780px]
                    max-w-[calc(100vw-48px)]
                    max-h-[calc(100vh-48px)]
                    flex-col
                    gap-0
                    overflow-hidden
                    rounded-[28px]
                    border border-slate-100
                    bg-white
                    p-0
                    shadow-lg
                "
            >
                <DialogHeader className="shrink-0 px-7 pb-4 pt-5">
                    <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">
                        Edit Transaction
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        Update the transaction details.
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100 px-7 py-4">
                    <TransactionForm
                        defaultValues={getDefaultValues(transaction)}
                        loading={loading}
                        submitLabel="Save Changes"
                        onSubmit={handleSubmit}
                        onCancel={() => onOpenChange(false)}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}
