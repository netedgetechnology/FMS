import { useState } from "react";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import type { Account } from "@/modules/accounts/types";

import {
    CreateReconciliationRequest,
} from "../types";

import {
    ReconciliationService,
} from "../services";

import {
    ReconciliationForm,
} from "./ReconciliationForm";

interface ReconciliationDialogProps {
    open: boolean;
    accounts: Account[];
    onOpenChange: (open: boolean) => void;
    onCreated?: (id: string) => void;
}

export function ReconciliationDialog({
    open,
    accounts,
    onOpenChange,
    onCreated,
}: ReconciliationDialogProps) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const service = new ReconciliationService();

    const handleSubmit = async (
        request: CreateReconciliationRequest
    ) => {
        setLoading(true);
        setError(null);

        try {
            const id = await service.create(request);

            onOpenChange(false);
            onCreated?.(id);
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Unable to create reconciliation."
            );
        } finally {
            setLoading(false);
        }
    };

    const handleOpenChange = (nextOpen: boolean) => {
        if (loading) {
            return;
        }

        if (!nextOpen) {
            setError(null);
        }

        onOpenChange(nextOpen);
    };

    return (
        <Dialog
            open={open}
            onOpenChange={handleOpenChange}
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
                        New Reconciliation
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        Compare your account statement balance
                        with the FinanceOS system balance.
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100 px-7 py-5">
                    <ReconciliationForm
                        accounts={accounts}
                        onSubmit={handleSubmit}
                        onCancel={() =>
                            handleOpenChange(false)
                        }
                        loading={loading}
                        error={error}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}
