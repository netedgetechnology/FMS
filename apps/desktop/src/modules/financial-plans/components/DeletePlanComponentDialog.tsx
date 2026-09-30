import { useState } from "react";
import type { ReactElement } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

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

import { FinancialPlanComponentService } from "../services";
import { getPlanComponentTypeLabel } from "../constants";
import type { FinancialPlanComponentView } from "../types";

export interface DeletePlanComponentDialogProps {
    component: FinancialPlanComponentView;
    onSuccess?: () => Promise<void> | void;
    disabled?: boolean;
    trigger?: ReactElement;
}

/** The component's display name, as shown throughout the manage-components UI. */
export function getPlanComponentDisplayTitle(
    component: Pick<
        FinancialPlanComponentView,
        "label" | "sourceName"
    >
): string {
    return (
        component.label ||
        component.sourceName ||
        "Unknown source"
    );
}

/**
 * Copy for the delete-confirmation dialog. Kept pure and exported so the
 * "identifies the correct component / source type" requirement is unit
 * testable without rendering the dialog.
 */
export function getPlanComponentDeleteConfirmationCopy(
    component: Pick<
        FinancialPlanComponentView,
        "label" | "sourceName" | "componentType"
    >
): { title: string; sourceTypeLabel: string } {
    return {
        title: getPlanComponentDisplayTitle(component),
        sourceTypeLabel: getPlanComponentTypeLabel(
            component.componentType
        ).toLowerCase(),
    };
}

export function DeletePlanComponentDialog({
    component,
    onSuccess,
    disabled,
    trigger,
}: DeletePlanComponentDialogProps) {
    const service = new FinancialPlanComponentService();

    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    const { title, sourceTypeLabel } =
        getPlanComponentDeleteConfirmationCopy(component);

    async function handleDelete() {
        if (loading) {
            return;
        }

        try {
            setLoading(true);

            await service.delete(component.id);

            await onSuccess?.();

            toast.success(
                "Component removed from the financial plan."
            );

            setOpen(false);
        } catch (error) {
            console.error(
                "Failed to delete plan component:",
                error
            );

            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to remove component. Please try again."
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <AlertDialog
            open={open}
            onOpenChange={nextOpen => {
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
                            disabled={disabled}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                            aria-label="Delete component"
                        />
                    )
                }
            >
                {trigger ? null : (
                    <Trash2 size={13} />
                )}
            </AlertDialogTrigger>

            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        Delete Component?
                    </AlertDialogTitle>

                    <AlertDialogDescription>
                        Are you sure you want to remove{" "}
                        <span className="font-semibold text-slate-900">
                            {title}
                        </span>{" "}
                        from this financial plan?
                        <br />
                        <br />
                        This will remove the component from
                        the plan but will not delete the
                        underlying {sourceTypeLabel} or its
                        transactions.
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
                        {loading
                            ? "Deleting..."
                            : "Delete Component"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
