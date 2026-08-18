import { useState } from "react";
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
} from "@/components/ui/alert-dialog";

import { CategoryService } from "../services";
import { Category } from "../types";

interface DeleteCategoryDialogProps {
    category: Category | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => Promise<void> | void;
}

export function DeleteCategoryDialog({
    category,
    open,
    onOpenChange,
    onSuccess,
}: DeleteCategoryDialogProps) {
    const [loading, setLoading] = useState(false);

    if (!category) {
        return null;
    }

    async function handleDelete() {
        const categoryId = category?.id;

        if (!categoryId) {
            return;
        }

        try {
            setLoading(true);

            const service = new CategoryService();

            await service.delete(categoryId);
            await onSuccess?.();

            toast.success("Category deleted successfully.");
            onOpenChange(false);
        } catch (error) {
            console.error("Failed to delete category:", error);

            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to delete category. Please try again."
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        Delete category?
                    </AlertDialogTitle>

                    <AlertDialogDescription>
                        This will remove{" "}
                        <span className="font-semibold text-slate-900">
                            {category.name}
                        </span>{" "}
                        from the active category list. Existing records are
                        not modified.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <AlertDialogFooter>
                    <AlertDialogCancel disabled={loading}>
                        Cancel
                    </AlertDialogCancel>

                    <AlertDialogAction
                        disabled={loading}
                        onClick={handleDelete}
                        className="bg-red-600 hover:bg-red-700"
                    >
                        {loading ? "Deleting..." : "Delete Category"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

