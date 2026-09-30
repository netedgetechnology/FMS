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

import {
    accountsForBulkMove,
    runBulkAccountMove,
    TransactionService,
} from "../services";
import type { Transaction } from "../types";

// Same shape as BulkChangeCategoryDialog. Only the account of the
// selected transactions changes - see TransactionService.moveToAccount.

export interface BulkMoveToAccountDialogProps {
    /** The selected transactions. */
    transactions: Transaction[];
    accounts: Account[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => Promise<void> | void;
}

export function BulkMoveToAccountDialog({
    transactions,
    accounts,
    open,
    onOpenChange,
    onSuccess,
}: BulkMoveToAccountDialogProps) {
    const [accountId, setAccountId] = useState("");
    const [loading, setLoading] = useState(false);

    // Blocks a second click before the disabled state has rendered.
    const inFlight = useRef(false);

    const count = transactions.length;
    const noun = count === 1 ? "transaction" : "transactions";

    // Active ledger accounts in the selection's currency, other than the
    // selection's own account (see accountsForBulkMove).
    const options = useMemo(
        () => accountsForBulkMove(accounts, transactions),
        [accounts, transactions]
    );

    const selectedAccount =
        options.find(account => account.id === accountId) ?? null;

    // Each time the dialog opens, start with no account chosen.
    useEffect(() => {
        if (open) {
            setAccountId("");
        }
    }, [open]);

    async function handleConfirm() {
        if (count === 0 || !selectedAccount || inFlight.current) {
            return;
        }

        inFlight.current = true;

        try {
            setLoading(true);

            const outcome = await runBulkAccountMove(
                new TransactionService(),
                transactions.map(transaction => transaction.id),
                selectedAccount,
                toast
            );

            if (outcome.moved) {
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
                        Move to Account
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm leading-6 text-slate-500">
                        Move {count} selected {noun} to another account.
                        This only corrects which account they belong to -
                        it is not a transfer. Date, amount, category, type
                        and every other detail stay the same.
                    </DialogDescription>
                </DialogHeader>

                <div className="px-7 pb-6">
                    <label
                        htmlFor="bulkMoveAccountId"
                        className="mb-2 block text-sm font-medium text-slate-700"
                    >
                        Destination account
                    </label>

                    <Select
                        value={accountId}
                        onValueChange={value => setAccountId(value ?? "")}
                        disabled={loading || options.length === 0}
                    >
                        <SelectTrigger id="bulkMoveAccountId" className="w-full">
                            <SelectValue placeholder="Select account">
                                {selectedAccount?.name ?? "Select account"}
                            </SelectValue>
                        </SelectTrigger>

                        <SelectContent>
                            {options.map(account => (
                                <SelectItem
                                    key={account.id}
                                    value={account.id}
                                    label={account.name}
                                >
                                    {account.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    {options.length === 0 && (
                        <p className="mt-2 text-xs text-slate-500">
                            No account can take these transactions: the
                            destination must be another active bank, cash,
                            wallet or credit card account in the same
                            currency, and loan or investment accounts can't
                            be moved to or from.
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
                        disabled={loading || !selectedAccount}
                        onClick={handleConfirm}
                        className="h-9 cursor-pointer rounded-lg bg-slate-900 px-5 text-sm font-medium text-white shadow-sm transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {loading ? "Moving..." : "Move"}
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
