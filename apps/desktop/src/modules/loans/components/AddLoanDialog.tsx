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

import { LoanForm } from "./LoanForm";
import { LoanService } from "../services";
import { EMIScheduleService } from "../services/EMIScheduleService";
import type { LoanFormValues } from "../validation";

export interface AddLoanDialogProps {
    onSuccess?: () => Promise<void> | void;
    defaultValues?: Partial<LoanFormValues>;
    trigger?: ReactElement;
}

export function AddLoanDialog({
    onSuccess,
    defaultValues,
    trigger,
}: AddLoanDialogProps) {
    const service = new LoanService();
    const emiScheduleService = new EMIScheduleService();

    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    function handleOpenChange(next: boolean) {
        if (next) {
            setError(null);
        }

        setOpen(next);
    }

    async function handleSubmit(values: LoanFormValues) {
        try {
            setLoading(true);
            setError(null);

            const loanId = await service.create(values);
            await emiScheduleService.generateSchedule(loanId);
            await onSuccess?.();

            toast.success("Loan created successfully.");

            setOpen(false);
        } catch (error) {
            console.error(
                "Failed to create loan:",
                error
            );

            const message =
                error instanceof Error
                    ? error.message
                    : "Failed to create loan. Please try again.";

            setError(message);
            toast.error(message);
        } finally {
            setLoading(false);
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={handleOpenChange}
        >
            <DialogTrigger
                render={
                    trigger ?? (
                        <button
                            type="button"
                            className="h-10 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md active:scale-[0.98]"
                        >
                            Add Loan
                        </button>
                    )
                }
            >
                Add Loan
            </DialogTrigger>

            <DialogContent
                showCloseButton
                className="
                    w-[820px]
                    max-w-[calc(100vw-48px)]
                    gap-0
                    overflow-hidden
                    rounded-[28px]
                    border border-slate-100
                    bg-white
                    p-0
                    shadow-lg
                "
            >
                <DialogHeader className="px-7 pb-4 pt-5">
                    <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">
                        Add Loan
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        Add a loan, define its terms and track
                        outstanding balances.
                    </DialogDescription>
                </DialogHeader>

                {error && (
                    <div className="mx-7 mb-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
                        {error}
                    </div>
                )}

                <div className="max-h-[calc(100vh-180px)] overflow-y-auto border-t border-slate-100 px-7 py-5">
                    <LoanForm
                        defaultValues={defaultValues}
                        loading={loading}
                        submitLabel="Create Loan"
                        onSubmit={handleSubmit}
                        onCancel={() => setOpen(false)}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}

