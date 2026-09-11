import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useAccounts } from "@/modules/accounts/hooks";

import {
    isGoalEligibleAccountType,
    roleForGoalMode,
} from "../constants";
import { GoalAccountLinkRepository } from "../repositories";
import type {
    FinancialGoal,
    GoalAccountLink,
} from "../types";

interface ManageGoalAccountLinksDialogProps {
    open: boolean;
    goal: FinancialGoal | null;
    onClose: () => void;
    /** Called after any link is added or removed, so the page can refresh actuals. */
    onChanged: () => Promise<void> | void;
}

export function ManageGoalAccountLinksDialog({
    open,
    goal,
    onClose,
    onChanged,
}: ManageGoalAccountLinksDialogProps) {
    const repository = useMemo(
        () => new GoalAccountLinkRepository(),
        []
    );

    const { accounts, loading: accountsLoading } =
        useAccounts();

    const [links, setLinks] = useState<
        GoalAccountLink[]
    >([]);
    const [loadingLinks, setLoadingLinks] =
        useState(false);
    const [busyAccountId, setBusyAccountId] =
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

    const linkedAccountIds = new Set(
        links.map(link => link.accountId)
    );

    const role = roleForGoalMode(goal.goalMode);

    const eligibleAccounts = role
        ? accounts.filter(
              account =>
                  isGoalEligibleAccountType(
                      account.type,
                      role
                  ) &&
                  account.isActive &&
                  account.currencyId ===
                      goal.currencyId
          )
        : [];

    async function handleAdd(accountId: string) {
        setBusyAccountId(accountId);
        try {
            const link: GoalAccountLink = {
                id: crypto.randomUUID(),
                goalId: goal!.id,
                accountId,
                isActive: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };

            await repository.create({
                id: link.id,
                goalId: link.goalId,
                accountId: link.accountId,
            });

            setLinks(prev => [...prev, link]);
            await onChanged();
            toast.success("Account linked.");
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to link account."
            );
        } finally {
            setBusyAccountId(null);
        }
    }

    async function handleRemove(
        link: GoalAccountLink
    ) {
        setBusyAccountId(link.accountId);
        try {
            await repository.softDelete(link.id);
            setLinks(prev =>
                prev.filter(l => l.id !== link.id)
            );
            await onChanged();
            toast.success("Account unlinked.");
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to unlink account."
            );
        } finally {
            setBusyAccountId(null);
        }
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manage-goal-accounts-title"
        >
            <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl">
                <div className="border-b border-slate-100 px-6 py-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2
                                id="manage-goal-accounts-title"
                                className="text-xl font-bold text-slate-900"
                            >
                                Manage Linked Accounts
                            </h2>

                            <p className="mt-1 text-sm text-slate-500">
                                {goal.name} -{" "}
                                {role === "LIABILITY"
                                    ? "outstanding debt is calculated from the accounts linked below."
                                    : "current amount is the sum of the accounts linked below."}
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
                                No accounts linked yet.
                            </p>
                        ) : (
                            <ul className="space-y-2">
                                {links.map(link => {
                                    const account =
                                        accounts.find(
                                            a =>
                                                a.id ===
                                                link.accountId
                                        );

                                    return (
                                        <li
                                            key={link.id}
                                            className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2.5"
                                        >
                                            <span className="text-sm font-medium text-slate-800">
                                                {account?.name ??
                                                    "Account no longer exists"}
                                            </span>

                                            <button
                                                type="button"
                                                onClick={() =>
                                                    void handleRemove(
                                                        link
                                                    )
                                                }
                                                disabled={
                                                    busyAccountId ===
                                                    link.accountId
                                                }
                                                className="rounded-lg border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                                            >
                                                {busyAccountId ===
                                                link.accountId
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
                            Add an account
                        </p>

                        {accountsLoading ? (
                            <p className="text-sm text-slate-400">
                                Loading accounts...
                            </p>
                        ) : (
                            <ul className="space-y-2">
                                {eligibleAccounts
                                    .filter(
                                        account =>
                                            !linkedAccountIds.has(
                                                account.id
                                            )
                                    )
                                    .map(account => (
                                        <li
                                            key={
                                                account.id
                                            }
                                            className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-2.5"
                                        >
                                            <span className="text-sm text-slate-700">
                                                {
                                                    account.name
                                                }
                                                <span className="ml-1.5 text-xs text-slate-400">
                                                    (
                                                    {
                                                        account.type
                                                    }
                                                    )
                                                </span>
                                            </span>

                                            <button
                                                type="button"
                                                onClick={() =>
                                                    void handleAdd(
                                                        account.id
                                                    )
                                                }
                                                disabled={
                                                    busyAccountId ===
                                                    account.id
                                                }
                                                className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                                            >
                                                {busyAccountId ===
                                                account.id
                                                    ? "..."
                                                    : "Link"}
                                            </button>
                                        </li>
                                    ))}

                                {eligibleAccounts.filter(
                                    account =>
                                        !linkedAccountIds.has(
                                            account.id
                                        )
                                ).length === 0 && (
                                    <p className="text-sm text-slate-400">
                                        No more eligible
                                        accounts in this
                                        currency.
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
