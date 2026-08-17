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
    Plus,
} from "lucide-react";

import {
    InvestmentTransactionService,
} from "../services";

import type {
    InvestmentTransactionFormValues,
} from "../validation";

export interface AddInvestmentTransactionDialogProps {
    investmentId: string;
    onSuccess?: () => Promise<void> | void;
    trigger?: ReactElement;
}

export function AddInvestmentTransactionDialog({
    investmentId,
    onSuccess,
    trigger,
}: AddInvestmentTransactionDialogProps) {
    const service =
        new InvestmentTransactionService();

    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [submitError, setSubmitError] =
        useState<string | null>(null);

    async function handleSubmit(
        values: InvestmentTransactionFormValues
    ) {
        try {
            setLoading(true);
            setSubmitError(null);

            await service.create({
                investmentId,
                ...values,
            });

            await onSuccess?.();

            toast.success(
                "Investment transaction added successfully."
            );

            setOpen(false);
        } catch (error) {
            console.error(
                "Failed to create investment transaction:",
                error
            );

            const message =
                error instanceof Error
                    ? error.message
                    : "Failed to add investment transaction. Please try again.";

            setSubmitError(message);

            toast.error(message);
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
    title="Add transaction"
    aria-label="Add transaction"
    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white shadow-sm transition-colors hover:bg-slate-800"
>
    <Plus className="h-3.5 w-3.5" />
</button>
                    )
                }
            >
                {trigger ? null : <Plus className="h-3.5 w-3.5" />}
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
                        Add Investment Transaction
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        Record a buy, sell, dividend, interest or other investment transaction.
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100 px-7 py-5">
                    {submitError && (
                        <div
                            role="alert"
                            className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2"
                        >
                            <p className="text-xs leading-4 text-red-600">
                                {submitError}
                            </p>
                        </div>
                    )}

                    <InvestmentTransactionForm
                        loading={loading}
                        submitLabel="Add Transaction"
                        onSubmit={handleSubmit}
                        onCancel={() => setOpen(false)}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}





