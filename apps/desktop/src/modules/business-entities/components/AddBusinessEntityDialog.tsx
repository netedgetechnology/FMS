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

import { BusinessEntityForm } from "./BusinessEntityForm";

import { BusinessEntityService } from "../services";
import { BusinessEntityFormValues } from "../validation";

export interface AddBusinessEntityDialogProps {
    onSuccess?: () => Promise<void> | void;

    defaultValues?: Partial<
        BusinessEntityFormValues
    >;

    trigger?: ReactElement;
}

export function AddBusinessEntityDialog({
    onSuccess,
    defaultValues,
    trigger,
}: AddBusinessEntityDialogProps) {
    const service =
        new BusinessEntityService();

    const [open, setOpen] =
        useState(false);

    const [loading, setLoading] =
        useState(false);

    async function handleSubmit(
        values: BusinessEntityFormValues
    ) {
        try {
            setLoading(true);

            await service.create(values);

            await onSuccess?.();

            toast.success(
                "Business entity created successfully."
            );

            setOpen(false);
        } catch (error) {
            console.error(
                "Failed to create business entity:",
                error
            );

            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to create business entity. Please try again."
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
                            Add Business Entity
                        </button>
                    )
                }
            >
                Add Business Entity
            </DialogTrigger>

            <DialogContent
                showCloseButton
                className="
                    flex
                    w-[780px]
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
                <DialogHeader
                    className="shrink-0 px-7 pb-4 pt-5"
                >
                    <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">
                        Add Business Entity
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        Add a business entity for managing business finances.
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100 px-7 py-4">
                    <BusinessEntityForm
                        defaultValues={
                            defaultValues
                        }
                        loading={loading}
                        submitLabel="Create Business Entity"
                        onSubmit={
                            handleSubmit
                        }
                        onCancel={() =>
                            setOpen(false)
                        }
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}
