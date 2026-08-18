import { useState } from "react";
import { toast } from "sonner";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import {
    BusinessEntityService,
} from "../services";

import {
    BusinessEntity,
} from "../types";

export interface DeleteBusinessEntityDialogProps {
    entity: BusinessEntity | null;

    open: boolean;

    onOpenChange(
        open: boolean
    ): void;

    onSuccess?: () => Promise<void> | void;
}

export function DeleteBusinessEntityDialog({
    entity,
    open,
    onOpenChange,
    onSuccess,
}: DeleteBusinessEntityDialogProps) {
    const service =
        new BusinessEntityService();

    const [loading, setLoading] =
        useState(false);

    async function handleDelete() {
        if (!entity) {
            return;
        }

        try {
            setLoading(true);

            await service.delete(
                entity.id
            );

            await onSuccess?.();

            toast.success(
                "Business entity deleted successfully."
            );

            onOpenChange(false);
        } catch (error) {
            console.error(
                "Failed to delete business entity:",
                error
            );

            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to delete business entity. Please try again."
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={
                loading
                    ? undefined
                    : onOpenChange
            }
        >
            <DialogContent
                showCloseButton={!loading}
                className="
                    w-[440px]
                    max-w-[calc(100vw-48px)]
                    rounded-[24px]
                    border
                    border-slate-100
                    bg-white
                    p-0
                    shadow-lg
                "
            >
                <DialogHeader className="px-6 pb-2 pt-6">
                    <DialogTitle className="text-lg font-semibold text-slate-900">
                        Delete Business Entity
                    </DialogTitle>

                    <DialogDescription className="pt-1 text-sm leading-6 text-slate-500">
                        Are you sure you want to delete{" "}
                        <span className="font-medium text-slate-700">
                            {entity?.name ?? "this business entity"}
                        </span>
                        ? This will remove it from the active business entity list.
                    </DialogDescription>
                </DialogHeader>

                <DialogFooter className="border-t border-slate-100 px-6 py-4">
                    <button
                        type="button"
                        disabled={loading}
                        onClick={() =>
                            onOpenChange(false)
                        }
                        className="h-9 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Cancel
                    </button>

                    <button
                        type="button"
                        disabled={loading}
                        onClick={handleDelete}
                        className="h-9 rounded-lg bg-red-600 px-4 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {loading
                            ? "Deleting..."
                            : "Delete Business Entity"}
                    </button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
