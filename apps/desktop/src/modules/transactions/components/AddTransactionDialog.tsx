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

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { useMoneyFormatter } from "@/core/formatting";

import { TransactionForm } from "./TransactionForm";
import { TransactionService } from "../services";
import type { Transaction } from "../types";
import { TransactionFormValues } from "../validation";

export interface AddTransactionDialogProps {
    onSuccess?: () => Promise<void> | void;
    defaultValues?: Partial<TransactionFormValues>;
    trigger?: ReactElement;
}

export function AddTransactionDialog({
    onSuccess,
    defaultValues,
    trigger,
}: AddTransactionDialogProps) {
    const service = new TransactionService();
    const formatMoney = useMoneyFormatter();

    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    // Manual entry has no duplicate protection today - unlike statement
    // import (ImportService), TransactionService.create() never checks
    // for an existing match, so clicking "Create Transaction" twice for
    // the same account/category/date/type/amount/payee silently
    // produces two rows. This surfaces that match
    // (TransactionRepository.findManualDuplicate - deliberately not
    // findDuplicate(), which import de-duplication relies on and which
    // has different, narration-priority matching rules unsuited to
    // manual entry) as a confirmation instead of a hard block, since
    // two genuinely separate transactions can legitimately share all of
    // those fields (e.g. two identical cash gifts on the same day).
    const [duplicateOf, setDuplicateOf] =
        useState<Transaction | null>(null);
    const [pendingValues, setPendingValues] =
        useState<TransactionFormValues | null>(null);

    async function createTransaction(
        values: TransactionFormValues
    ) {
        try {
            setLoading(true);

            const { description, ...rest } = values;

            await service.create({
                ...rest,
                originalNarration: description,
            });
            await onSuccess?.();

            toast.success("Transaction created successfully.");
            setOpen(false);
        } catch (error) {
            console.error(
                "Failed to create transaction:",
                error
            );

            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to create transaction. Please try again."
            );
        } finally {
            setLoading(false);
            setDuplicateOf(null);
            setPendingValues(null);
        }
    }

    async function handleSubmit(values: TransactionFormValues) {
        try {
            setLoading(true);

            const existing = await service.findManualDuplicate(
                values.accountId,
                values.categoryId || null,
                values.transactionDate,
                values.type,
                values.amount,
                values.payee
            );

            if (existing) {
                setDuplicateOf(existing);
                setPendingValues(values);
                setLoading(false);
                return;
            }
        } catch (error) {
            // The duplicate check itself failing must never block a
            // transaction the user can otherwise save - fall through
            // and create it normally.
            console.error(
                "Failed to check for a duplicate transaction:",
                error
            );
        }

        await createTransaction(values);
    }

    return (
        <>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger
                    render={
                        trigger ?? (
                            <button
                                type="button"
                                className="h-10 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md active:scale-[0.98]"
                            >
                                Add Transaction
                            </button>
                        )
                    }
                >
                    Add Transaction
                </DialogTrigger>

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
                            Add Transaction
                        </DialogTitle>

                        <DialogDescription className="mt-1 text-sm text-slate-500">
                            Record an income, expense or transfer.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100 px-7 py-4">
                        <TransactionForm
                            defaultValues={defaultValues}
                            loading={loading}
                            submitLabel="Create Transaction"
                            onSubmit={handleSubmit}
                            onCancel={() => setOpen(false)}
                        />
                    </div>
                </DialogContent>
            </Dialog>

            <AlertDialog
                open={duplicateOf !== null}
                onOpenChange={isOpen => {
                    if (!isOpen && !loading) {
                        setDuplicateOf(null);
                        setPendingValues(null);
                    }
                }}
            >
                <AlertDialogContent className="max-w-md gap-0 overflow-hidden rounded-2xl border-0 bg-white p-0 shadow-xl ring-0">
                    <AlertDialogHeader className="px-6 pt-6 pb-5">
                        <AlertDialogTitle className="text-base font-semibold text-slate-900">
                            Possible Duplicate Transaction
                        </AlertDialogTitle>

                        <AlertDialogDescription className="mt-2 text-sm leading-6 text-slate-500">
                            {duplicateOf && (
                                <>
                                    An existing transaction already
                                    matches this account, date, type and
                                    amount:{" "}
                                    <span className="font-medium text-slate-800">
                                        {formatMoney(
                                            Number(duplicateOf.amount)
                                        )}
                                    </span>{" "}
                                    {duplicateOf.type} on{" "}
                                    {duplicateOf.transactionDate}
                                    {duplicateOf.payee
                                        ? ` for "${duplicateOf.payee}"`
                                        : ""}
                                    .
                                    <br />
                                    <br />
                                </>
                            )}
                            Save this one anyway, or cancel and review
                            it first?
                        </AlertDialogDescription>
                    </AlertDialogHeader>

                    <AlertDialogFooter className="border-0 bg-slate-50 px-6 py-4">
                        <AlertDialogCancel
                            disabled={loading}
                            className="h-9 rounded-lg border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-none hover:bg-slate-50 hover:text-slate-900"
                        >
                            Cancel
                        </AlertDialogCancel>

                        <AlertDialogAction
                            disabled={loading}
                            onClick={() => {
                                if (pendingValues) {
                                    void createTransaction(
                                        pendingValues
                                    );
                                }
                            }}
                            className="h-9 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white shadow-none hover:bg-slate-800"
                        >
                            {loading
                                ? "Saving..."
                                : "Save Anyway"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
