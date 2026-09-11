import { toast } from "sonner";
import { useState } from "react";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import { FinancialPlanService } from "../services";
import { canRestorePlan } from "../services";
import type { FinancialPlan } from "../types";

export interface ArchiveFinancialPlanDialogProps {
    plan: FinancialPlan | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => Promise<void> | void;
}

/**
 * Confirms an archive (Active/Completed -> Archived) or a restore
 * (Archived -> Active). Only the plan's status changes - components,
 * dates, target and taxonomy are untouched. Nothing is deleted.
 */
export function ArchiveFinancialPlanDialog({
    plan,
    open,
    onOpenChange,
    onSuccess,
}: ArchiveFinancialPlanDialogProps) {
    const service = new FinancialPlanService();
    const [loading, setLoading] = useState(false);

    if (!plan) {
        return null;
    }

    const restoring = canRestorePlan(plan);
    const nextStatus = restoring
        ? "ACTIVE"
        : "ARCHIVED";

    async function handleConfirm() {
        try {
            setLoading(true);

            await service.setStatus(
                plan!.id,
                nextStatus
            );

            await onSuccess?.();

            toast.success(
                restoring
                    ? "Financial plan restored."
                    : "Financial plan archived."
            );

            onOpenChange(false);
        } catch (error) {
            console.error(
                "Failed to change plan status:",
                error
            );
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to change plan status."
            );
        } finally {
            setLoading(false);
        }
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
                        {restoring
                            ? "Restore Financial Plan"
                            : "Archive Financial Plan"}
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm leading-6 text-slate-500">
                        {restoring
                            ? "This moves the plan back to Active. Its components and settings are unchanged."
                            : "This moves the plan to Archived and out of the default list. Nothing is deleted and you can restore it later."}
                    </DialogDescription>
                </DialogHeader>

                <div className="border-t border-slate-100 px-7 py-5">
                    <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <div className="text-sm font-medium text-slate-900">
                            {plan.name}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                            {plan.status} → {nextStatus}
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
                        onClick={handleConfirm}
                        className="h-9 rounded-lg bg-slate-900 px-5 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
                    >
                        {loading
                            ? "Saving..."
                            : restoring
                              ? "Restore Plan"
                              : "Archive Plan"}
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
