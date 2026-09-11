import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useLoans } from "@/modules/loans/hooks";

import { isGoalEligibleLoanStatus } from "../constants";
import { GoalLoanLinkRepository } from "../repositories";
import type {
    FinancialGoal,
    GoalLoanLink,
} from "../types";

interface ManageGoalLoanLinksDialogProps {
    open: boolean;
    goal: FinancialGoal | null;
    onClose: () => void;
    /** Called after any link is added or removed, so the page can refresh actuals. */
    onChanged: () => Promise<void> | void;
}

export function ManageGoalLoanLinksDialog({
    open,
    goal,
    onClose,
    onChanged,
}: ManageGoalLoanLinksDialogProps) {
    const repository = useMemo(
        () => new GoalLoanLinkRepository(),
        []
    );

    const { loans, loading: loansLoading } =
        useLoans();

    const [links, setLinks] = useState<
        GoalLoanLink[]
    >([]);
    const [loadingLinks, setLoadingLinks] =
        useState(false);
    const [busyLoanId, setBusyLoanId] = useState<
        string | null
    >(null);

    useEffect(() => {
        if (!open || !goal) {
            return;
        }

        let active = true;

        async function load() {
            setLoadingLinks(true);
            try {
                const result =
                    await repository.listByGoal(
                        goal!.id
                    );
                if (active) {
                    setLinks(result);
                }
            } finally {
                if (active) {
                    setLoadingLinks(false);
                }
            }
        }

        void load();

        return () => {
            active = false;
        };
    }, [open, goal, repository]);

    if (!open || !goal) {
        return null;
    }

    const linkedLoanIds = new Set(
        links.map(link => link.loanId)
    );

    const eligibleLoans = loans.filter(
        loan =>
            isGoalEligibleLoanStatus(loan.status) &&
            loan.currencyId === goal.currencyId
    );

    async function handleAdd(loanId: string) {
        setBusyLoanId(loanId);
        try {
            const link: GoalLoanLink = {
                id: crypto.randomUUID(),
                goalId: goal!.id,
                loanId,
                isActive: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };

            await repository.create({
                id: link.id,
                goalId: link.goalId,
                loanId: link.loanId,
            });

            setLinks(prev => [...prev, link]);
            await onChanged();
            toast.success("Loan linked.");
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to link loan."
            );
        } finally {
            setBusyLoanId(null);
        }
    }

    async function handleRemove(link: GoalLoanLink) {
        setBusyLoanId(link.loanId);
        try {
            await repository.softDelete(link.id);
            setLinks(prev =>
                prev.filter(l => l.id !== link.id)
            );
            await onChanged();
            toast.success("Loan unlinked.");
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to unlink loan."
            );
        } finally {
            setBusyLoanId(null);
        }
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manage-goal-loans-title"
        >
            <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl">
                <div className="border-b border-slate-100 px-6 py-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2
                                id="manage-goal-loans-title"
                                className="text-xl font-bold text-slate-900"
                            >
                                Manage Linked Loans
                            </h2>

                            <p className="mt-1 text-sm text-slate-500">
                                {goal.name} -
                                outstanding debt is
                                calculated from the loans
                                linked below.
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Close"
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                            ×
                        </button>
                    </div>
                </div>

                <div className="space-y-5 p-6">
                    <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Currently linked
                        </p>

                        {loadingLinks ? (
                            <p className="text-sm text-slate-400">
                                Loading...
                            </p>
                        ) : links.length === 0 ? (
                            <p className="text-sm text-slate-400">
                                No loans linked yet.
                            </p>
                        ) : (
                            <ul className="space-y-2">
                                {links.map(link => {
                                    const loan =
                                        loans.find(
                                            l =>
                                                l.id ===
                                                link.loanId
                                        );

                                    return (
                                        <li
                                            key={link.id}
                                            className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2.5"
                                        >
                                            <span className="text-sm font-medium text-slate-800">
                                                {loan?.name ??
                                                    "Loan no longer exists"}
                                            </span>

                                            <button
                                                type="button"
                                                onClick={() =>
                                                    void handleRemove(
                                                        link
                                                    )
                                                }
                                                disabled={
                                                    busyLoanId ===
                                                    link.loanId
                                                }
                                                className="rounded-lg border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                                            >
                                                {busyLoanId ===
                                                link.loanId
                                                    ? "..."
                                                    : "Unlink"}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>

                    <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Add a loan
                        </p>

                        {loansLoading ? (
                            <p className="text-sm text-slate-400">
                                Loading loans...
                            </p>
                        ) : (
                            <ul className="space-y-2">
                                {eligibleLoans
                                    .filter(
                                        loan =>
                                            !linkedLoanIds.has(
                                                loan.id
                                            )
                                    )
                                    .map(loan => (
                                        <li
                                            key={loan.id}
                                            className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-2.5"
                                        >
                                            <span className="text-sm text-slate-700">
                                                {
                                                    loan.name
                                                }
                                            </span>

                                            <button
                                                type="button"
                                                onClick={() =>
                                                    void handleAdd(
                                                        loan.id
                                                    )
                                                }
                                                disabled={
                                                    busyLoanId ===
                                                    loan.id
                                                }
                                                className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                                            >
                                                {busyLoanId ===
                                                loan.id
                                                    ? "..."
                                                    : "Link"}
                                            </button>
                                        </li>
                                    ))}

                                {eligibleLoans.filter(
                                    loan =>
                                        !linkedLoanIds.has(
                                            loan.id
                                        )
                                ).length === 0 && (
                                    <p className="text-sm text-slate-400">
                                        No more eligible
                                        active loans in
                                        this currency.
                                    </p>
                                )}
                            </ul>
                        )}
                    </div>

                    <div className="flex justify-end border-t border-slate-100 pt-5">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
                        >
                            Done
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
