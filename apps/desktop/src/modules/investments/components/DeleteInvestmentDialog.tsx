import { useState } from "react";
import type { ReactElement } from "react";
import { toast } from "sonner";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import { InvestmentService } from "../services";
import type { Investment } from "../types";

import {
    Trash2,
} from "lucide-react";

export interface DeleteInvestmentDialogProps {
    investment: Investment;
    onSuccess?: () => Promise<void> | void;
    trigger?: ReactElement;
}

export function DeleteInvestmentDialog({
    investment,
    onSuccess,
    trigger,
}: DeleteInvestmentDialogProps) {
    const service = new InvestmentService();

    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    async function handleDelete() {
        try {
            setLoading(true);

            await service.delete(investment.id);
            await onSuccess?.();

            toast.success("Investment deleted successfully.");

            setOpen(false);
        } catch (error) {
            console.error(
                "Failed to delete investment:",
                error
            );

            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to delete investment. Please try again."
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <AlertDialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!loading) {
                    setOpen(nextOpen);
                }
            }}
        >
            <AlertDialogTrigger
                render={
                    trigger ?? (
                        <button
    type="button"
    title="Delete investment"
    aria-label="Delete investment"
    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-red-200 bg-white text-red-600 transition-colors hover:bg-red-50"
>
    <Trash2 className="h-3.5 w-3.5" />
</button>
                    )
                }
            >
                {trigger ? null : "Delete"}
            </AlertDialogTrigger>

            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        Delete investment?
                    </AlertDialogTitle>

                    <AlertDialogDescription>
                        This will remove{" "}
                        <span className="font-medium text-slate-700">
                            {investment.name}
                        </span>{" "}
                        from your investment list. This action canâ€™t be
                        undone from the investment screen.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <AlertDialogFooter>
                    <AlertDialogCancel disabled={loading}>
                        Cancel
                    </AlertDialogCancel>

                    <AlertDialogAction
                        type="button"
                        disabled={loading}
                        onClick={() => {
                            void handleDelete();
                        }}
                        className="bg-red-600 text-white hover:bg-red-700"
                    >
                        {loading ? "Deleting..." : "Delete Investment"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}


