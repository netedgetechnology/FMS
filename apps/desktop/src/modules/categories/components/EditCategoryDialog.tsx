import { useEffect, useState } from "react";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import { CategoryForm, CategoryMappingRowInput } from "./CategoryForm";
import { CategoryContextMappingService, CategoryService } from "../services";
import { CategoryFormValues } from "../validation";
import { Category, CategoryContextMapping } from "../types";
import { planMappingWrites, validateMappingRowsForSave } from "../utils";

interface EditCategoryDialogProps {
    category: Category | null;
    categories: Category[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => Promise<void> | void;
}

export function EditCategoryDialog({
    category,
    categories,
    open,
    onOpenChange,
    onSuccess,
}: EditCategoryDialogProps) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [mappings, setMappings] = useState<CategoryContextMapping[]>([]);

    useEffect(() => {
        if (!open || !category) {
            return;
        }

        let cancelled = false;

        new CategoryContextMappingService()
            .getByCategoryId(category.id)
            .then(data => {
                if (!cancelled) {
                    setMappings(data);
                }
            })
            .catch(err => {
                console.error(
                    "Failed to load category context mappings:",
                    err
                );
            });

        return () => {
            cancelled = true;
        };
    }, [open, category?.id]);

    if (!category) {
        return null;
    }

    async function handleSubmit(
        values: CategoryFormValues,
        mappingRows: CategoryMappingRowInput[]
    ) {
        const categoryId = category?.id;

        if (!categoryId) {
            return;
        }

        try {
            setLoading(true);
            setError(null);

            validateMappingRowsForSave(mappingRows);

            const service = new CategoryService();

            await service.update({
                id: categoryId,
                parentId: values.parentId || null,
                name: values.name,
                categoryType: values.categoryType,
                businessEntityId: values.businessEntityId || null,
                description: values.description || null,
                isActive: values.isActive,
            });

            const mappingService = new CategoryContextMappingService();

            const plan = planMappingWrites(
                categoryId,
                mappings,
                mappingRows
            );

            for (const id of plan.toDeleteIds) {
                await mappingService.delete(id);
            }

            for (const request of plan.toCreate) {
                await mappingService.create(request);
            }

            for (const request of plan.toUpdate) {
                await mappingService.update(request);
            }

            await onSuccess?.();

            onOpenChange(false);
        } catch (err) {
            const message =
                err instanceof Error
                    ? err.message
                    : "Unable to update category.";

            console.error("Failed to update category:", err);
            setError(message);
        } finally {
            setLoading(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                showCloseButton
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
                        Edit Category
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        Update the category details.
                    </DialogDescription>
                </DialogHeader>

                {error && (
                    <div className="mx-7 mb-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
                        {error}
                    </div>
                )}

                <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100 px-7 py-4">
                    <CategoryForm
                        key={category.id}
                        categories={categories.filter(
                            item => item.id !== category.id
                        )}
                        mappings={mappings}
                        financeScope={category.financeScope}
                        defaultValues={{
                            parentId: category.parentId ?? "",
                            name: category.name,
                            categoryType: category.categoryType,
                            businessEntityId:
                                category.businessEntityId ?? "",
                            description: category.description ?? "",
                            isActive: category.isActive,
                        }}
                        loading={loading}
                        submitLabel="Save Changes"
                        onSubmit={handleSubmit}
                        onCancel={() => onOpenChange(false)}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}

