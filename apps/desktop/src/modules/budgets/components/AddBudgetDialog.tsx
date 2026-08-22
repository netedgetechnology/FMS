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
import type { BudgetFormValues } from "../validation";

import { BudgetForm } from "./BudgetForm";

export interface AddBudgetDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => Promise<void> | void;
}

export function AddBudgetDialog({
    open,
    onOpenChange,
    onSuccess,
}: AddBudgetDialogProps) {
    const service = new BudgetService();

    const [loading, setLoading] = useState(false);

    async function handleSubmit(
        values: BudgetFormValues
    ) {
        try {
            setLoading(true);

            await service.create({
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
                "Budget created successfully."
            );

            onOpenChange(false);
        } catch (error) {
            console.error(
                "Failed to create budget:",
                error
            );

            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to create budget."
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
                        Add Budget
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        Create a budget to track planned spending.
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100 px-7 py-5">
                    <BudgetForm
                        loading={loading}
                        submitLabel="Create Budget"
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
