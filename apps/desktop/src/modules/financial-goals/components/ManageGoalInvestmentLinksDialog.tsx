import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useInvestments } from "@/modules/investments/hooks";

import { isGoalEligibleInvestmentStatus } from "../constants";
import { GoalInvestmentLinkRepository } from "../repositories";
import type {
    FinancialGoal,
    GoalInvestmentLink,
} from "../types";

interface ManageGoalInvestmentLinksDialogProps {
    open: boolean;
    goal: FinancialGoal | null;
    onClose: () => void;
    /** Called after any link is added or removed, so the page can refresh actuals. */
    onChanged: () => Promise<void> | void;
}

export function ManageGoalInvestmentLinksDialog({
    open,
    goal,
    onClose,
    onChanged,
}: ManageGoalInvestmentLinksDialogProps) {
    const repository = useMemo(
        () => new GoalInvestmentLinkRepository(),
        []
    );

    const {
        investments,
        loading: investmentsLoading,
    } = useInvestments();

    const [links, setLinks] = useState<
        GoalInvestmentLink[]
    >([]);
    const [loadingLinks, setLoadingLinks] =
        useState(false);
    const [busyInvestmentId, setBusyInvestmentId] =
        useState<string | null>(null);

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

    const linkedInvestmentIds = new Set(
        links.map(link => link.investmentId)
    );

    const eligibleInvestments = investments.filter(
        investment =>
            isGoalEligibleInvestmentStatus(
                investment.status
            ) &&
            investment.currencyId === goal.currencyId
    );

    async function handleAdd(investmentId: string) {
        setBusyInvestmentId(investmentId);
        try {
            const link: GoalInvestmentLink = {
                id: crypto.randomUUID(),
                goalId: goal!.id,
                investmentId,
                isActive: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };

            await repository.create({
                id: link.id,
                goalId: link.goalId,
                investmentId: link.investmentId,
            });

            setLinks(prev => [...prev, link]);
            await onChanged();
            toast.success("Investment linked.");
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to link investment."
            );
        } finally {
            setBusyInvestmentId(null);
        }
    }

    async function handleRemove(
        link: GoalInvestmentLink
    ) {
        setBusyInvestmentId(link.investmentId);
        try {
            await repository.softDelete(link.id);
            setLinks(prev =>
                prev.filter(l => l.id !== link.id)
            );
            await onChanged();
            toast.success("Investment unlinked.");
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to unlink investment."
            );
        } finally {
            setBusyInvestmentId(null);
        }
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manage-goal-investments-title"
        >
            <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl">
                <div className="border-b border-slate-100 px-6 py-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2
                                id="manage-goal-investments-title"
                                className="text-xl font-bold text-slate-900"
                            >
                                Manage Linked
                                Investments
                            </h2>

                            <p className="mt-1 text-sm text-slate-500">
                                {goal.name} - current
                                amount is the sum of the
                                current value of the
                                investments linked below.
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
                                No investments linked
                                yet.
                            </p>
                        ) : (
                            <ul className="space-y-2">
                                {links.map(link => {
                                    const investment =
                                        investments.find(
                                            i =>
                                                i.id ===
                                                link.investmentId
                                        );

                                    return (
                                        <li
                                            key={link.id}
                                            className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2.5"
                                        >
                                            <span className="text-sm font-medium text-slate-800">
                                                {investment?.name ??
                                                    "Investment no longer exists"}
                                            </span>

                                            <button
                                                type="button"
                                                onClick={() =>
                                                    void handleRemove(
                                                        link
                                                    )
                                                }
                                                disabled={
                                                    busyInvestmentId ===
                                                    link.investmentId
                                                }
                                                className="rounded-lg border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                                            >
                                                {busyInvestmentId ===
                                                link.investmentId
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
                            Add an investment
                        </p>

                        {investmentsLoading ? (
                            <p className="text-sm text-slate-400">
                                Loading investments...
                            </p>
                        ) : (
                            <ul className="space-y-2">
                                {eligibleInvestments
                                    .filter(
                                        investment =>
                                            !linkedInvestmentIds.has(
                                                investment.id
                                            )
                                    )
                                    .map(investment => (
                                        <li
                                            key={
                                                investment.id
                                            }
                                            className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-2.5"
                                        >
                                            <span className="text-sm text-slate-700">
                                                {
                                                    investment.name
                                                }
                                            </span>

                                            <button
                                                type="button"
                                                onClick={() =>
                                                    void handleAdd(
                                                        investment.id
                                                    )
                                                }
                                                disabled={
                                                    busyInvestmentId ===
                                                    investment.id
                                                }
                                                className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                                            >
                                                {busyInvestmentId ===
                                                investment.id
                                                    ? "..."
                                                    : "Link"}
                                            </button>
                                        </li>
                                    ))}

                                {eligibleInvestments.filter(
                                    investment =>
                                        !linkedInvestmentIds.has(
                                            investment.id
                                        )
                                ).length === 0 && (
                                    <p className="text-sm text-slate-400">
                                        No more eligible
                                        active
                                        investments in
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
