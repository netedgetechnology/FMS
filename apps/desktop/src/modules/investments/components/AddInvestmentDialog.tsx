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
import type { InvestmentFormValues } from "../validation";

export interface AddInvestmentDialogProps {
    onSuccess?: () => Promise<void> | void;
    defaultValues?: Partial<InvestmentFormValues>;
    trigger?: ReactElement;
    title?: string;
    description?: string;
}

export function AddInvestmentDialog({
    onSuccess,
    defaultValues,
    trigger,
    title = "Add Investment",
    description = "Add an investment and track its holding, cost and current value.",
}: AddInvestmentDialogProps) {
    const service = new InvestmentService();

    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    async function handleSubmit(
        values: InvestmentFormValues
    ) {
        try {
            setLoading(true);

            await service.create(values);
            await onSuccess?.();

            toast.success(
                "Investment created successfully."
            );

            setOpen(false);
        } catch (error) {
            console.error(
                "Failed to create investment:",
                error
            );

            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to create investment. Please try again."
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
                            className="h-10 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md active:scale-[0.98]"
                        >
                            Add Investment
                        </button>
                    )
                }
            >
                Add Investment
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
                        {title}
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        {description}
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100 px-7 py-5">
                    <InvestmentForm
                        defaultValues={defaultValues}
                        loading={loading}
                        submitLabel="Create Investment"
                        onSubmit={handleSubmit}
                        onCancel={() => setOpen(false)}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}

