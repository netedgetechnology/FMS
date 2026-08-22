import { useState } from "react";
import { toast } from "sonner";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import { BudgetService } from "../services";
import type { Budget } from "../types";

export interface DeleteBudgetDialogProps {
    budget: Budget | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => Promise<void> | void;
}

export function DeleteBudgetDialog({
    budget,
    open,
    onOpenChange,
    onSuccess,
}: DeleteBudgetDialogProps) {
    const service = new BudgetService();

    const [loading, setLoading] = useState(false);

    async function handleDelete() {
        if (!budget) {
            return;
        }

        try {
            setLoading(true);

            await service.delete(budget.id);

            await onSuccess?.();

            toast.success(
                "Budget deleted successfully."
            );

            onOpenChange(false);
        } catch (error) {
            console.error(
                "Failed to delete budget:",
                error
            );

            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to delete budget."
            );
        } finally {
            setLoading(false);
        }
    }

    if (!budget) {
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
                        Delete Budget
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm leading-6 text-slate-500">
                        Are you sure you want to delete this budget? This action cannot be undone.
                    </DialogDescription>
                </DialogHeader>

                <div className="border-t border-slate-100 px-7 py-5">
                    <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <div className="text-sm font-medium text-slate-900">
                            {budget.name}
                        </div>

                        <div className="mt-1 text-xs text-slate-500">
                            {formatBudgetPeriod(
                                budget.periodType
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-7 py-5">
                    <button
                        type="button"
                        disabled={loading}
                        onClick={() =>
                            onOpenChange(false)
                        }
                        className="h-9 rounded-lg border border-slate-300 bg-white px-5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                    >
                        Cancel
                    </button>

                    <button
                        type="button"
                        disabled={loading}
                        onClick={handleDelete}
                        className="h-9 rounded-lg bg-red-600 px-5 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
                    >
                        {loading
                            ? "Deleting..."
                            : "Delete Budget"}
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function formatBudgetPeriod(
    periodType: Budget["periodType"]
) {
    switch (periodType) {
        case "MONTHLY":
            return "Monthly";
        case "QUARTERLY":
            return "Quarterly";
        case "YEARLY":
            return "Yearly";
        case "CUSTOM":
            return "Custom";
        default:
            return periodType;
    }
}
