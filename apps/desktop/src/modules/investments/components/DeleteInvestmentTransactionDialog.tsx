import { useState } from "react";
import type { ReactElement } from "react";
import { toast } from "sonner";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import {
    InvestmentTransactionService,
} from "../services";

import type {
    InvestmentTransaction,
} from "../types";

export interface DeleteInvestmentTransactionDialogProps {
    transaction: InvestmentTransaction;
    onSuccess?: () => Promise<void> | void;
    trigger?: ReactElement;
}

export function DeleteInvestmentTransactionDialog({
    transaction,
    onSuccess,
    trigger,
}: DeleteInvestmentTransactionDialogProps) {
    const service =
        new InvestmentTransactionService();

    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    async function handleDelete() {
        try {
            setLoading(true);

            await service.delete(
                transaction.id
            );

            await onSuccess?.();

            toast.success(
                "Investment transaction deleted successfully."
            );

            setOpen(false);
        } catch (error) {
            console.error(
                "Failed to delete investment transaction:",
                error
            );

            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to delete investment transaction. Please try again."
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <AlertDialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!loading) {
                    setOpen(nextOpen);
                }
            }}
        >
            <AlertDialogTrigger
                render={
                    trigger ?? (
                        <button
                            type="button"
                            className="h-8 rounded-lg border border-red-200 bg-white px-3 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
                        >
                            Delete
                        </button>
                    )
                }
            >
                {trigger ? null : "Delete"}
            </AlertDialogTrigger>

            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        Delete transaction?
                    </AlertDialogTitle>

                    <AlertDialogDescription>
                        This will permanently remove this
                        investment transaction. This action
                        cannot be undone.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <AlertDialogFooter>
                    <AlertDialogCancel
                        disabled={loading}
                    >
                        Cancel
                    </AlertDialogCancel>

                    <AlertDialogAction
                        type="button"
                        disabled={loading}
                        onClick={() => {
                            void handleDelete();
                        }}
                        className="bg-red-600 text-white hover:bg-red-700"
                    >
                        {loading
                            ? "Deleting..."
                            : "Delete Transaction"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
