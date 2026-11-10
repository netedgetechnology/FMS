import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import { OverdraftService } from "@/modules/loans/services/OverdraftService";

import { TransactionService } from "../services";
import type { Transaction } from "../types";
import type { TransactionFormValues } from "../validation";

import { TransactionForm } from "./TransactionForm";
import { sideOf } from "./transactionFormTyping";

export interface EditTransactionDialogProps {
    transaction: Transaction | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => Promise<void> | void;
}

export function getDefaultValues(
    transaction: Transaction
): Partial<TransactionFormValues> {
    return {
        accountId: transaction.accountId,
        categoryId: transaction.categoryId ?? "",
        subcategoryId: transaction.subcategoryId ?? "",
        payee: transaction.payee,
        description: transaction.originalNarration ?? "",
        type: transaction.type,
        transferDirection: transaction.transferDirection ?? null,
        amount: Number(transaction.amount ?? 0),
        transactionDate: transaction.transactionDate,
        referenceNumber: transaction.referenceNumber ?? "",
        notes: transaction.notes ?? "",
        tags: transaction.tags ?? "",
        status: transaction.status ?? "CLEARED",
        paymentMethod: transaction.paymentMethod ?? null,
        upiReference: transaction.upiReference ?? "",
        bankTransactionReference:
            transaction.bankTransactionReference ?? "",
        cardReference: transaction.cardReference ?? "",
    };
}

export function EditTransactionDialog({
    transaction,
    open,
    onOpenChange,
    onSuccess,
}: EditTransactionDialogProps) {
    const service = new TransactionService();

    const [loading, setLoading] = useState(false);

    // Facts about the transaction being edited, read when it opens: the
    // bank statement's Debit/Credit side of an imported transaction (the
    // form derives a Transfer's direction from it) and the overdraft
    // movement it is linked as. Kept WITH the id they were read for, so a
    // value read for a previously edited transaction is never applied to
    // this one. Read-only; a failure only means the form falls back to
    // the stored side / shows no link warning.
    const [facts, setFacts] = useState<{
        transactionId: string;
        statementSide: "income" | "expense" | null;
        linkedMovementKind: string | null;
    } | null>(null);

    useEffect(() => {
        if (!open) {
            setLoading(false);
        }
    }, [open]);

    useEffect(() => {
        let cancelled = false;

        if (!open || !transaction) {
            return;
        }

        const transactionId = transaction.id;

        Promise.all([
            service.getStatementSide(transactionId).catch(error => {
                console.error("Failed to read the statement side:", error);
                return null;
            }),
            new OverdraftService()
                .getLinkByTransactionId(transactionId)
                .catch(error => {
                    console.error("Failed to read the overdraft link:", error);
                    return null;
                }),
        ]).then(([statementSide, link]) => {
            if (!cancelled) {
                setFacts({
                    transactionId,
                    statementSide,
                    linkedMovementKind: link?.entryKind ?? null,
                });
            }
        });

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, transaction?.id]);

    const currentFacts =
        facts && transaction && facts.transactionId === transaction.id
            ? facts
            : null;

    async function handleSubmit(values: TransactionFormValues) {
        if (!transaction) {
            return;
        }

        try {
            setLoading(true);

            const { description, ...rest } = values;

            await service.update({
                id: transaction.id,
                ...rest,
                originalNarration: description,
                // Not a form field - never user-editable on the manual
                // Edit dialog. TransactionService.update now preserves
                // every field this request omits, so this is redundant,
                // but carried through explicitly to keep the imported
                // transaction's Mapping Name (sourceStatement) obvious.
                sourceStatement: transaction.sourceStatement,
            });

            await onSuccess?.();

            toast.success("Transaction updated successfully.");

            onOpenChange(false);
        } catch (error) {
            console.error(
                "Failed to update transaction:",
                error
            );

            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to update transaction. Please try again."
            );
        } finally {
            setLoading(false);
        }
    }

    if (!transaction) {
        return null;
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
                <DialogHeader className="shrink-0 px-7 pb-4 pt-5">
                    <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">
                        Edit Transaction
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        Update the transaction details.
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100 px-7 py-4">
                    <TransactionForm
                        // A fresh form per transaction - nothing carries
                        // over from the previous one.
                        key={transaction.id}
                        defaultValues={getDefaultValues(transaction)}
                        loading={loading}
                        submitLabel="Save Changes"
                        onSubmit={handleSubmit}
                        onCancel={() => onOpenChange(false)}
                        statementSide={currentFacts?.statementSide ?? null}
                        linkedMovementKind={currentFacts?.linkedMovementKind ?? null}
                        originalSide={sideOf(
                            transaction.type,
                            transaction.transferDirection ?? null
                        )}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}
