import { useState } from "react";
import type { ReactElement } from "react";
import { toast } from "sonner";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";

import { InvestmentTransactionForm } from "./InvestmentTransactionForm";

import {
    InvestmentTransactionService,
} from "../services";

import type {
    InvestmentTransaction,
} from "../types";

import type {
    InvestmentTransactionFormValues,
} from "../validation";

export interface EditInvestmentTransactionDialogProps {
    transaction: InvestmentTransaction;
    onSuccess?: () => Promise<void> | void;
    trigger?: ReactElement;
}

export function EditInvestmentTransactionDialog({
    transaction,
    onSuccess,
    trigger,
}: EditInvestmentTransactionDialogProps) {
    const service =
        new InvestmentTransactionService();

    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    const defaultValues:
        Partial<InvestmentTransactionFormValues> = {
        transactionType:
            transaction.transactionType,

        transactionDate:
            transaction.transactionDate,

        quantity:
            transaction.quantity,

        price:
            transaction.price,

        amount:
            transaction.amount,

        fees:
            transaction.fees,

        taxes:
            transaction.taxes,

        referenceNumber:
            transaction.referenceNumber ?? "",

        notes:
            transaction.notes ?? "",
    };

    async function handleSubmit(
        values: InvestmentTransactionFormValues
    ) {
        try {
            setLoading(true);

            await service.update({
                id: transaction.id,
                ...values,
            });

            await onSuccess?.();

            toast.success(
                "Investment transaction updated successfully."
            );

            setOpen(false);
        } catch (error) {
            console.error(
                "Failed to update investment transaction:",
                error
            );

            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to update investment transaction. Please try again."
            );

            throw error;
        } finally {
            setLoading(false);
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!loading) {
                    setOpen(nextOpen);
                }
            }}
        >
            <DialogTrigger
                render={
                    trigger ?? (
                        <button
                            type="button"
                            className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                        >
                            Edit
                        </button>
                    )
                }
            >
                {trigger ? null : "Edit"}
            </DialogTrigger>

            <DialogContent
                showCloseButton
                className="
                    flex
                    w-[820px]
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
                        Edit Investment Transaction
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        Update the transaction details and save the changes.
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100 px-7 py-5">
                    <InvestmentTransactionForm
                        key={transaction.id}
                        defaultValues={defaultValues}
                        loading={loading}
                        submitLabel="Save Changes"
                        onSubmit={handleSubmit}
                        onCancel={() => setOpen(false)}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}

