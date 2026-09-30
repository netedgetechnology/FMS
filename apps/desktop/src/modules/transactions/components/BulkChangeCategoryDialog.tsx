import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

import type { Account } from "@/modules/accounts/types";
import { useCategoryContextMappings } from "@/modules/categories/hooks";
import type { Category } from "@/modules/categories/types";

import {
    categoriesForBulkChange,
    runBulkCategoryChange,
    TransactionService,
} from "../services";
import type { Transaction } from "../types";

// Same shape as BulkDeleteTransactionsDialog. Only the category of the
// selected transactions changes - see TransactionService.changeCategory.

export interface BulkChangeCategoryDialogProps {
    /** The selected transactions. */
    transactions: Transaction[];
    categories: Category[];
    accounts: Account[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => Promise<void> | void;
}

export function BulkChangeCategoryDialog({
    transactions,
    categories,
    accounts,
    open,
    onOpenChange,
    onSuccess,
}: BulkChangeCategoryDialogProps) {
    const { mappings } = useCategoryContextMappings();

    const [categoryId, setCategoryId] = useState("");
    const [loading, setLoading] = useState(false);

    // Blocks a second click before the disabled state has rendered.
    const inFlight = useRef(false);

    const count = transactions.length;
    const noun = count === 1 ? "Transaction" : "Transactions";

    const options = useMemo(
        () =>
            categoriesForBulkChange(
                categories,
                transactions,
                mappings,
                new Map(
                    accounts.map(account => [
                        account.id,
                        account.businessEntityId ?? null,
                    ])
                )
            ),
        [categories, transactions, mappings, accounts]
    );

    const hiddenCount =
        categories.filter(category => category.isActive).length -
        options.length;

    const selectedCategory =
        options.find(category => category.id === categoryId) ?? null;

    // Each time the dialog opens, start with no category chosen.
    useEffect(() => {
        if (open) {
            setCategoryId("");
        }
    }, [open]);

    async function handleApply() {
        if (count === 0 || !selectedCategory || inFlight.current) {
            return;
        }

        inFlight.current = true;

        try {
            setLoading(true);

            const outcome = await runBulkCategoryChange(
                new TransactionService(),
                transactions.map(transaction => transaction.id),
                selectedCategory,
                toast
            );

            if (outcome.changed) {
                await onSuccess?.();
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
                        Change Category
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm leading-6 text-slate-500">
                        Set the category for {count} selected{" "}
                        {noun.toLowerCase()}. Type, amount, account and
                        every other detail stay the same.
                    </DialogDescription>
                </DialogHeader>

                <div className="px-7 pb-6">
                    <label
                        htmlFor="bulkCategoryId"
                        className="mb-2 block text-sm font-medium text-slate-700"
                    >
                        Category
                    </label>

                    <Select
                        value={categoryId}
                        onValueChange={value => setCategoryId(value ?? "")}
                        disabled={loading}
                    >
                        <SelectTrigger id="bulkCategoryId" className="w-full">
                            <SelectValue placeholder="Select category">
                                {selectedCategory?.name ?? "Select category"}
                            </SelectValue>
                        </SelectTrigger>

                        <SelectContent>
                            {options.map(category => (
                                <SelectItem
                                    key={category.id}
                                    value={category.id}
                                    label={category.name}
                                >
                                    {category.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    {hiddenCount > 0 && (
                        <p className="mt-2 text-xs text-slate-500">
                            {hiddenCount}{" "}
                            {hiddenCount === 1 ? "category is" : "categories are"}{" "}
                            not shown: mapped to a different transaction type
                            for the account or business entity of some
                            selected transactions.
                        </p>
                    )}
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-7 py-5">
                    <button
                        type="button"
                        disabled={loading}
                        onClick={() => onOpenChange(false)}
                        className="h-9 rounded-lg border border-slate-300 bg-white px-5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Cancel
                    </button>

                    <button
                        type="button"
                        disabled={loading || !selectedCategory}
                        onClick={handleApply}
                        className="h-9 cursor-pointer rounded-lg bg-slate-900 px-5 text-sm font-medium text-white shadow-sm transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {loading ? "Applying..." : "Apply"}
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
