import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import { BusinessEntityForm } from "./BusinessEntityForm";

import {
    BusinessEntityService,
} from "../services";

import {
    BusinessEntity,
    UpdateBusinessEntityRequest,
} from "../types";

import {
    BusinessEntityFormValues,
} from "../validation";

export interface EditBusinessEntityDialogProps {
    entity: BusinessEntity | null;

    open: boolean;

    onOpenChange(
        open: boolean
    ): void;

    onSuccess?: () => Promise<void> | void;
}

export function EditBusinessEntityDialog({
    entity,
    open,
    onOpenChange,
    onSuccess,
}: EditBusinessEntityDialogProps) {
    const service =
        new BusinessEntityService();

    const [loading, setLoading] =
        useState(false);

    const [defaultValues, setDefaultValues] =
        useState<
            Partial<BusinessEntityFormValues>
        >();

    useEffect(() => {
        if (!entity) {
            setDefaultValues(undefined);
            return;
        }

        setDefaultValues({
            name: entity.name,
            legalName:
                entity.legalName ?? "",
            taxIdentifier:
                entity.taxIdentifier ?? "",
            currencyId:
                entity.currencyId,
            description:
                entity.description ?? "",
            isActive:
                entity.isActive,
        });
    }, [entity]);

    async function handleSubmit(
        values: BusinessEntityFormValues
    ) {
        if (!entity) {
            return;
        }

        try {
            setLoading(true);

            const request: UpdateBusinessEntityRequest = {
                id: entity.id,
                ...values,
            };

            await service.update(request);

            await onSuccess?.();

            toast.success(
                "Business entity updated successfully."
            );

            onOpenChange(false);
        } catch (error) {
            console.error(
                "Failed to update business entity:",
                error
            );

            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to update business entity. Please try again."
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
        >
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
                        Edit Business Entity
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        Update the business entity details.
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100 px-7 py-4">
                    {entity && (
                        <BusinessEntityForm
                            key={entity.id}
                            defaultValues={
                                defaultValues
                            }
                            loading={loading}
                            submitLabel="Save Changes"
                            onSubmit={
                                handleSubmit
                            }
                            onCancel={() =>
                                onOpenChange(false)
                            }
                        />
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
