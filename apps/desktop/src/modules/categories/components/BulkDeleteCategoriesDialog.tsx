import { useRef, useState } from "react";
import { toast } from "sonner";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import { CategoryService } from "../services";
import { Category } from "../types";
import { runBulkCategoryDelete } from "../utils";

// Mirrors BulkDeleteTransactionsDialog, with the single-category
// DeleteCategoryDialog's soft-delete semantics and wording.

export interface BulkDeleteCategoriesDialogProps {
    categories: Category[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Called with every id actually deleted - also after a partial failure. */
    onDeleted?: (deletedIds: string[]) => Promise<void> | void;
}

export function BulkDeleteCategoriesDialog({
    categories,
    open,
    onOpenChange,
    onDeleted,
}: BulkDeleteCategoriesDialogProps) {
    const [loading, setLoading] = useState(false);

    // Blocks a second click before the disabled state has rendered.
    const inFlight = useRef(false);

    const count = categories.length;
    const noun = count === 1 ? "Category" : "Categories";

    async function handleDelete() {
        if (count === 0 || inFlight.current) {
            return;
        }

        inFlight.current = true;

        try {
            setLoading(true);

            const outcome = await runBulkCategoryDelete(
                new CategoryService(),
                categories,
                toast
            );

            if (outcome.deletedIds.length > 0) {
                await onDeleted?.(outcome.deletedIds);
            }

            if (!outcome.failed) {
                onOpenChange(false);
            }
        } finally {
            inFlight.current = false;
            setLoading(false);
        }
    }

    if (count === 0) {
        return null;
    }

    return (
        <Dialog
            open={open}
            onOpenChange={open => {
                if (!loading) {
                    onOpenChange(open);
                }
            }}
        >
            <DialogContent
                showCloseButton={!loading}
                className="
                    w-[480px]
                    max-w-[calc(100vw-48px)]
                    rounded-[24px]
                    border
                    border-slate-100
                    bg-white
                    p-0
                    shadow-lg
                "
            >
                <DialogHeader className="px-7 pb-5 pt-6">
                    <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">
                        Delete {count} {noun}
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm leading-6 text-slate-500">
                        This will remove {count} selected{" "}
                        {count === 1 ? "category" : "categories"} from the
                        active category list. Existing records are not
                        modified.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-7 py-5">
                    <button
                        type="button"
                        disabled={loading}
                        onClick={() => onOpenChange(false)}
                        className="
                            h-9
                            rounded-lg
                            border
                            border-slate-300
                            bg-white
                            px-5
                            text-sm
                            font-medium
                            text-slate-700
                            shadow-sm
                            transition-colors
                            hover:border-slate-400
                            hover:bg-slate-50
                            disabled:cursor-not-allowed
                            disabled:opacity-50
                        "
                    >
                        Cancel
                    </button>

                    <button
                        type="button"
                        disabled={loading}
                        onClick={handleDelete}
                        className="
                            h-9
                            rounded-lg
                            bg-red-600
                            px-5
                            text-sm
                            font-medium
                            text-white
                            shadow-sm
                            transition-colors
                            hover:bg-red-700
                            disabled:cursor-not-allowed
                            disabled:opacity-50
                        "
                    >
                        {loading
                            ? "Deleting..."
                            : `Delete ${count} ${noun}`}
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
