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

import { InvestmentForm } from "./InvestmentForm";
import { InvestmentService } from "../services";
import type { Investment } from "../types";

import {
    Pencil,
} from "lucide-react";
import type { InvestmentFormValues } from "../validation";

export interface EditInvestmentDialogProps {
    investment: Investment;
    onSuccess?: () => Promise<void> | void;
    trigger?: ReactElement;
}

export function EditInvestmentDialog({
    investment,
    onSuccess,
    trigger,
}: EditInvestmentDialogProps) {
    const service = new InvestmentService();

    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    const defaultValues: Partial<InvestmentFormValues> = {
        accountId: investment.accountId ?? "",
        name: investment.name,
        investmentType: investment.investmentType,
        symbol: investment.symbol ?? "",
        isin: investment.isin ?? "",
        currencyId: investment.currencyId,
        brokerInstitutionId:
            investment.brokerInstitutionId ?? "",
        brokerInstitutionName: "",
        quantity: investment.quantity,
        averageCost: investment.averageCost,
        currentPrice: investment.currentPrice,
        currentValue: investment.currentValue,
        purchaseDate: investment.purchaseDate ?? "",
        status: investment.status,
        notes: investment.notes ?? "",
    };

    async function handleSubmit(
        values: InvestmentFormValues
    ) {
        try {
            setLoading(true);

            await service.update({
                id: investment.id,
                ...values,
            });

            await onSuccess?.();

            toast.success(
                "Investment updated successfully."
            );

            setOpen(false);
        } catch (error) {
            console.error(
                "Failed to update investment:",
                error
            );

            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to update investment. Please try again."
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={setOpen}
        >
            <DialogTrigger
                render={
                    trigger ?? (
                        <button
    type="button"
    title="Edit investment"
    aria-label="Edit investment"
    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50"
>
    <Pencil className="h-3.5 w-3.5" />
</button>
                    )
                }
            >
                {trigger ? null : "Edit"}
            </DialogTrigger>

            <DialogContent
                showCloseButton
                className="
                    flex
                    w-[820px]
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
                        Edit Investment
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        Update the investment details and current holding information.
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100 px-7 py-5">
                    <InvestmentForm
                        key={investment.id}
                        defaultValues={defaultValues}
                        loading={loading}
                        submitLabel="Save Changes"
                        onSubmit={handleSubmit}
                        onCancel={() => setOpen(false)}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}


