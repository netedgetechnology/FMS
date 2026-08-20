import { useState } from "react";
import { toast } from "sonner";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import { FinancialPlanService } from "../services";
import type { FinancialPlanFormValues } from "../validation";

import type { Currency } from "@/modules/currencies/types";

import { FinancialPlanForm } from "./FinancialPlanForm";

export interface AddFinancialPlanDialogProps {
    currencies: Currency[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => Promise<void> | void;
}

export function AddFinancialPlanDialog({
    currencies,
    open,
    onOpenChange,
    onSuccess,
}: AddFinancialPlanDialogProps) {
    const service = new FinancialPlanService();

    const [loading, setLoading] = useState(false);

    async function handleSubmit(
        values: FinancialPlanFormValues
    ) {
        try {
            setLoading(true);

            await service.create(values);

            await onSuccess?.();

            toast.success(
                "Financial plan created successfully."
            );

            onOpenChange(false);
        } catch (error) {
            console.error(
                "Failed to create financial plan:",
                error
            );

            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to create financial plan."
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
                        Add Financial Plan
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        Create a financial plan to organize your financial objectives.
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100 px-7 py-5">
                    <FinancialPlanForm
                        currencies={currencies}
                        loading={loading}
                        submitLabel="Create Plan"
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

