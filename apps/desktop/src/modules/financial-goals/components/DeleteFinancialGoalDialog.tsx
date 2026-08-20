import { useState } from "react";

import type {
    FinancialGoal,
} from "../types";

interface DeleteFinancialGoalDialogProps {
    open: boolean;
    goal: FinancialGoal | null;
    onClose: () => void;
    onDelete: (id: string) => Promise<void>;
}

export function DeleteFinancialGoalDialog({
    open,
    goal,
    onClose,
    onDelete,
}: DeleteFinancialGoalDialogProps) {
    const [deleting, setDeleting] = useState(false);

    if (!open || !goal) {
        return null;
    }

    const handleDelete = async () => {
        setDeleting(true);

        try {
            await onDelete(goal.id);
            onClose();
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-financial-goal-title"
        >
            <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
                <div className="border-b border-slate-100 px-6 py-5">
                    <h2
                        id="delete-financial-goal-title"
                        className="text-xl font-bold text-slate-900"
                    >
                        Delete Financial Goal
                    </h2>

                    <p className="mt-1 text-sm text-slate-500">
                        This action will remove the goal from your active financial goals.
                    </p>
                </div>

                <div className="space-y-4 p-6">
                    <div className="rounded-xl bg-slate-50 p-4">
                        <p className="text-sm text-slate-500">
                            Goal
                        </p>

                        <p className="mt-1 font-semibold text-slate-900">
                            {goal.name}
                        </p>
                    </div>

                    <p className="text-sm leading-6 text-slate-600">
                        Are you sure you want to delete this financial goal?
                        Your recorded financial data will not be permanently
                        removed from the database.
                    </p>

                    <div className="flex justify-end gap-3 border-t border-slate-100 pt-5">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={deleting}
                            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                            Cancel
                        </button>

                        <button
                            type="button"
                            onClick={() => void handleDelete()}
                            disabled={deleting}
                            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {deleting ? "Deleting..." : "Delete Goal"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
