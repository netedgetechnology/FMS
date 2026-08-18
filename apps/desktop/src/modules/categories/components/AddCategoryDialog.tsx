import { useState } from "react";
import { toast } from "sonner";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import { CategoryForm } from "./CategoryForm";
import { CategoryService } from "../services";
import { CategoryFormValues } from "../validation";
import { Category } from "../types";

interface AddCategoryDialogProps {
    categories: Category[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => Promise<void> | void;
}

export function AddCategoryDialog({
    categories,
    open,
    onOpenChange,
    onSuccess,
}: AddCategoryDialogProps) {
    const [loading, setLoading] = useState(false);

    async function handleSubmit(values: CategoryFormValues) {
        try {
            setLoading(true);

            const service = new CategoryService();

            await service.create({
                parentId: values.parentId || null,
                name: values.name,
                categoryType: values.categoryType,
                financeScope: values.financeScope,
                businessEntityId: values.businessEntityId || null,
                description: values.description || null,
                isActive: values.isActive,
            });

            await onSuccess?.();

            toast.success("Category created successfully.");
            onOpenChange(false);
        } catch (error) {
            console.error("Failed to create category:", error);

            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to create category. Please try again."
            );
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
                        Add Category
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        Create an income, expense or transfer category.
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100 px-7 py-4">
                    <CategoryForm
                        categories={categories}
                        loading={loading}
                        submitLabel="Create Category"
                        onSubmit={handleSubmit}
                        onCancel={() => onOpenChange(false)}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}
