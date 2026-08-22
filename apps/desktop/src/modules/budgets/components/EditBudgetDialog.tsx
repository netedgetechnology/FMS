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
import type { BudgetFormValues } from "../validation";

import { BudgetForm } from "./BudgetForm";

export interface EditBudgetDialogProps {
    budget: Budget | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => Promise<void> | void;
}

function getDefaultValues(
    budget: Budget
): Partial<BudgetFormValues> {
    return {
        name: budget.name,
        categoryId: budget.categoryId ?? "",
        businessEntityId:
            budget.businessEntityId ?? "",
        amount: budget.amount,
        periodType: budget.periodType,
        startDate: budget.startDate,
        endDate: budget.endDate ?? "",
        currencyId: budget.currencyId,
        alertThreshold:
            budget.alertThreshold,
        isActive: budget.isActive,
    };
}

export function EditBudgetDialog({
    budget,
    open,
    onOpenChange,
    onSuccess,
}: EditBudgetDialogProps) {
    const service = new BudgetService();

    const [loading, setLoading] = useState(false);

    async function handleSubmit(
        values: BudgetFormValues
    ) {
        if (!budget) {
            return;
        }

        try {
            setLoading(true);

            await service.update({
                id: budget.id,
                ...values,
                categoryId:
                    values.categoryId || null,
                businessEntityId:
                    values.businessEntityId || null,
                endDate:
                    values.endDate || null,
            });

            await onSuccess?.();

            toast.success(
                "Budget updated successfully."
            );

            onOpenChange(false);
        } catch (error) {
            console.error(
                "Failed to update budget:",
                error
            );

            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to update budget."
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
                    flex
                    w-[760px]
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
                        Edit Budget
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        Update the budget details.
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100 px-7 py-5">
                    <BudgetForm
                        defaultValues={getDefaultValues(
                            budget
                        )}
                        loading={loading}
                        submitLabel="Save Changes"
                        onSubmit={handleSubmit}
                        onCancel={() =>
                            onOpenChange(false)
                        }
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}
