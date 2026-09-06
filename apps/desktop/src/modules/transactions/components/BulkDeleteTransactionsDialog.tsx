import { useState } from "react";
import { toast } from "sonner";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import { TransactionService } from "../services";

export interface BulkDeleteTransactionsDialogProps {
    transactionIds: string[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => Promise<void> | void;
}

export function BulkDeleteTransactionsDialog({
    transactionIds,
    open,
    onOpenChange,
    onSuccess,
}: BulkDeleteTransactionsDialogProps) {
    const service = new TransactionService();

    const [loading, setLoading] = useState(false);

    const count = transactionIds.length;

    async function handleDelete() {
        if (count === 0) {
            return;
        }

        try {
            setLoading(true);

            for (const id of transactionIds) {
                await service.delete(id);
            }

            await onSuccess?.();

            toast.success(
                `${count} transaction${count === 1 ? "" : "s"} deleted successfully.`
            );

            onOpenChange(false);
        } catch (error) {
            console.error(
                "Failed to delete transactions:",
                error
            );

            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to delete transactions. Please try again."
            );
        } finally {
            setLoading(false);
        }
    }

    if (count === 0) {
        return null;
    }

    return (
        <Dialog
            open={open}
            onOpenChange={open => {
                if (!loading) {
                    onOpenChange(open);
                }
            }}
        >
            <DialogContent
                showCloseButton={!loading}
                className="
                    w-[480px]
                    max-w-[calc(100vw-48px)]
                    rounded-[24px]
                    border
                    border-slate-100
                    bg-white
                    p-0
                    shadow-lg
                "
            >
                <DialogHeader className="px-7 pb-5 pt-6">
                    <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">
                        Delete {count} Transaction{count === 1 ? "" : "s"}
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm leading-6 text-slate-500">
                        Are you sure you want to delete {count}{" "}
                        selected transaction{count === 1 ? "" : "s"}?
                        This action cannot be undone.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-7 py-5">
                    <button
                        type="button"
                        disabled={loading}
                        onClick={() => onOpenChange(false)}
                        className="
                            h-9
                            rounded-lg
                            border
                            border-slate-300
                            bg-white
                            px-5
                            text-sm
                            font-medium
                            text-slate-700
                            shadow-sm
                            transition-colors
                            hover:border-slate-400
                            hover:bg-slate-50
                            disabled:cursor-not-allowed
                            disabled:opacity-50
                        "
                    >
                        Cancel
                    </button>

                    <button
                        type="button"
                        disabled={loading}
                        onClick={handleDelete}
                        className="
                            h-9
                            rounded-lg
                            bg-red-600
                            px-5
                            text-sm
                            font-medium
                            text-white
                            shadow-sm
                            transition-colors
                            hover:bg-red-700
                            disabled:cursor-not-allowed
                            disabled:opacity-50
                        "
                    >
                        {loading
                            ? "Deleting..."
                            : `Delete ${count} Transaction${count === 1 ? "" : "s"}`}
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
