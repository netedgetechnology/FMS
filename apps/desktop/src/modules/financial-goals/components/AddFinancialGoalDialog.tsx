import { useState } from "react";

import {
    FinancialGoalForm,
} from "./FinancialGoalForm";

import type {
    CreateFinancialGoalRequest,
} from "../types";

interface AddFinancialGoalDialogProps {
    open: boolean;
    onClose: () => void;
    onCreate: (
        request: CreateFinancialGoalRequest
    ) => Promise<void>;
}

export function AddFinancialGoalDialog({
    open,
    onClose,
    onCreate,
}: AddFinancialGoalDialogProps) {
    const [submitting, setSubmitting] =
        useState(false);

    if (!open) {
        return null;
    }

    const handleSubmit = async (
        request: CreateFinancialGoalRequest
    ) => {
        setSubmitting(true);

        try {
            await onCreate(request);
            onClose();
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-financial-goal-title"
        >
            <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
                <div className="border-b border-slate-100 px-6 py-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2
                                id="add-financial-goal-title"
                                className="text-xl font-bold text-slate-900"
                            >
                                Add Financial Goal
                            </h2>

                            <p className="mt-1 text-sm text-slate-500">
                                Create a goal to track your financial progress.
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={onClose}
                            disabled={submitting}
                            aria-label="Close"
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                        >
                            ×
                        </button>
                    </div>
                </div>

                <div className="p-6">
                    <FinancialGoalForm
                        onSubmit={handleSubmit}
                        onCancel={onClose}
                        submitting={submitting}
                    />
                </div>
            </div>
        </div>
    );
}
