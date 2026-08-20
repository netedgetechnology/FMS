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
import type { FinancialPlan } from "../types";
import type { FinancialPlanFormValues } from "../validation";

import type { Currency } from "@/modules/currencies/types";

import { FinancialPlanForm } from "./FinancialPlanForm";

export interface EditFinancialPlanDialogProps {
    plan: FinancialPlan | null;
    currencies: Currency[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => Promise<void> | void;
}

function getDefaultValues(
    plan: FinancialPlan
): Partial<FinancialPlanFormValues> {
    return {
        name: plan.name,
        planCategory:
            plan.planCategory ?? "CORE_PERSONAL_FINANCE",
        planSubcategory:
            plan.planSubcategory ?? plan.planType ?? "SAVINGS",
        planType:
            plan.planSubcategory ?? plan.planType ?? "SAVINGS",
        startDate: plan.startDate,
        endDate: plan.endDate ?? "",
        currencyId: plan.currencyId,
        targetAmount: plan.targetAmount,
        notes: plan.notes ?? "",
        status: plan.status,
    };
}

export function EditFinancialPlanDialog({
    plan,
    currencies,
    open,
    onOpenChange,
    onSuccess,
}: EditFinancialPlanDialogProps) {
    const service = new FinancialPlanService();

    const [loading, setLoading] = useState(false);

    async function handleSubmit(
        values: FinancialPlanFormValues
    ) {
        if (!plan) {
            return;
        }

        try {
            setLoading(true);

            await service.update({
                id: plan.id,
                ...values,
            });

            await onSuccess?.();

            toast.success(
                "Financial plan updated successfully."
            );

            onOpenChange(false);
        } catch (error) {
            console.error(
                "Failed to update financial plan:",
                error
            );

            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to update financial plan."
            );
        } finally {
            setLoading(false);
        }
    }

    if (!plan) {
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
                        Edit Financial Plan
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        Update the financial plan details.
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100 px-7 py-5">
                    <FinancialPlanForm
                        currencies={currencies}
                        defaultValues={getDefaultValues(plan)}
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

