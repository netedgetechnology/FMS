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

import { getErrorMessage } from "@/core/errors";

import { LoanService } from "../services";
import type { Loan } from "../types";

import { Trash2 } from "lucide-react";

export interface DeleteLoanDialogProps {
    loan: Loan;
    onSuccess?: () => Promise<void> | void;
    trigger?: ReactElement;
}

export function DeleteLoanDialog({
    loan,
    onSuccess,
    trigger,
}: DeleteLoanDialogProps) {
    const service = new LoanService();

    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    async function handleDelete() {
        try {
            setLoading(true);

            await service.delete(loan.id);
            await onSuccess?.();

            toast.success("Loan deleted successfully.");

            setOpen(false);
        } catch (error) {
            console.error("Failed to delete loan:", error);

            toast.error(
                getErrorMessage(
                    error,
                    "Failed to delete loan. Please try again."
                )
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
    title="Delete loan"
    aria-label="Delete loan"
    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
>
    <span className="inline-flex items-center gap-1.5">
        <Trash2 className="h-3.5 w-3.5" />
        Delete
    </span>
</button>
                    )
                }
            >
                {trigger ? null : "Delete"}
            </AlertDialogTrigger>

            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        Delete loan?
                    </AlertDialogTitle>

                    <AlertDialogDescription>
                        <span className="font-medium text-slate-700">
                            {loan.name}
                        </span>{" "}
                        will be permanently removed from your Loans
                        records. This action can&apos;t be undone.
                        <br />
                        <br />
                        If this loan has any recorded EMI payments,
                        every one of them must be reversed from the
                        loan&apos;s EMI schedule first - deletion is
                        blocked while any payment history remains.
                        <br />
                        <br />
                        Linked bank transactions are never deleted by
                        this action.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <AlertDialogFooter>
                    <AlertDialogCancel disabled={loading}>
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
                        {loading ? "Deleting..." : "Delete Loan"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
