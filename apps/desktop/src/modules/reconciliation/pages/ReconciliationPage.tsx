import {
    CalendarCheck,
    CheckCircle2,
    Plus,
} from "lucide-react";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/common";
import { AccountRepository } from "@/modules/accounts/repositories/AccountRepository";
import { Account } from "@/modules/accounts/types";

import {
    ReconciliationDialog,
    ReconciliationTransactionReview,
} from "../components";
import { ReconciliationService } from "../services";
import { Reconciliation } from "../types";

export default function ReconciliationPage() {
    const [reconciliations, setReconciliations] =
        useState<Reconciliation[]>([]);

    const [accounts, setAccounts] =
        useState<Account[]>([]);

    const [loading, setLoading] =
        useState(true);

    const [error, setError] =
        useState<string | null>(null);

    const [selectedAccountId, setSelectedAccountId] =
        useState<string>("");

    const [dialogOpen, setDialogOpen] =
        useState(false);

    const [
        selectedReconciliation,
        setSelectedReconciliation,
    ] = useState<Reconciliation | null>(null);

    const service = useMemo(
        () => new ReconciliationService(),
        []
    );

    const accountRepository = useMemo(
        () => new AccountRepository(),
        []
    );

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const [
                reconciliationResult,
                accountResult,
            ] = await Promise.all([
                service.getAll(),
                accountRepository.getAll(),
            ]);

            setReconciliations(
                reconciliationResult
            );

            console.table(
                accountResult.map(account => ({
                    id: account.id,
                    name: account.name,
                    type: account.type,
                    institution: account.institutionName,
                }))
            );

            setAccounts(accountResult);

            if (
                !selectedAccountId &&
                accountResult.length > 0
            ) {
                setSelectedAccountId(
                    accountResult[0].id
                );
            }
        } catch (loadError) {
            console.error(
                "Failed to load reconciliation data:",
                loadError
            );

            setError(
                loadError instanceof Error
                    ? loadError.message
                    : "Failed to load reconciliation data."
            );
        } finally {
            setLoading(false);
        }
    }, [
        accountRepository,
        selectedAccountId,
        service,
    ]);

    useEffect(() => {
        void loadData();
    }, [loadData]);


    const filteredReconciliations =
        useMemo(() => {
            if (!selectedAccountId) {
                return reconciliations;
            }

            return reconciliations.filter(
                reconciliation =>
                    reconciliation.accountId ===
                    selectedAccountId
            );
        }, [
            reconciliations,
            selectedAccountId,
        ]);

    const openCount =
        filteredReconciliations.filter(
            item => item.status === "OPEN"
        ).length;

    const completedCount =
        filteredReconciliations.filter(
            item => item.status === "COMPLETED"
        ).length;

    async function handleComplete(
        reconciliation: Reconciliation
    ) {
        if (
            reconciliation.status !== "OPEN"
        ) {
            return;
        }


        try {
            await service.complete({
                id: reconciliation.id,
            });

            toast.success(
                "Reconciliation completed."
            );

            await loadData();
        } catch (completeError) {
            console.error(
                "Failed to complete reconciliation:",
                completeError
            );

            toast.error(
                completeError instanceof Error
                    ? completeError.message
                    : "Unable to complete reconciliation."
            );
        }
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title="Reconciliation"
                subtitle="Compare your account statements with FinanceOS balances."
                actions={
                    <button
                        type="button"
                        onClick={() =>
                            setDialogOpen(true)
                        }
                        disabled={
                            loading ||
                            accounts.length === 0
                        }
                        className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <Plus size={16} />
                        New Reconciliation
                    </button>
                }
            />

            <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <SummaryCard
                    label="Open"
                    value={String(openCount)}
                />

                <SummaryCard
                    label="Completed"
                    value={String(
                        completedCount
                    )}
                />

                <SummaryCard
                    label="History"
                    value={String(
                        filteredReconciliations.length
                    )}
                />
            </section>

            <section className="rounded-2xl border border-slate-100 bg-white shadow-sm">
                <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 md:flex-row md:items-end md:justify-between">
                    <div>
                        <h2 className="text-base font-semibold text-slate-900">
                            Reconciliation History
                        </h2>

                        <p className="mt-1 text-sm text-slate-500">
                            Select an account to review its reconciliation history.
                        </p>
                    </div>

                    <div className="w-full md:w-72">
                        <label
                            htmlFor="reconciliation-account"
                            className="mb-2 block text-xs font-medium text-slate-500"
                        >
                            Account
                        </label>

                        <select
                            id="reconciliation-account"
                            value={selectedAccountId}
                            onChange={event =>
                                setSelectedAccountId(
                                    event.target.value
                                )
                            }
                            className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-500"
                        >
                            {accounts.length === 0 && (
                                <option value="">
                                    No accounts available
                                </option>
                            )}

                            {accounts.map(account => (
                                <option
                                    key={account.id}
                                    value={account.id}
                                >
                                    {account.name}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {loading && (
                    <div className="flex min-h-[240px] items-center justify-center">
                        <p className="text-sm text-slate-400">
                            Loading reconciliations...
                        </p>
                    </div>
                )}

                {!loading && error && (
                    <div className="flex min-h-[240px] items-center justify-center px-6 text-center">
                        <p className="text-sm text-red-500">
                            {error}
                        </p>
                    </div>
                )}

                {!loading &&
                    !error &&
                    filteredReconciliations.length ===
                        0 && (
                        <div className="px-6 py-12">
                            <EmptyState
                                title="No reconciliations yet"
                                description="Create a reconciliation to compare your statement balance with the FinanceOS account balance."
                            />
                        </div>
                    )}

                {!loading &&
                    !error &&
                    filteredReconciliations.length >
                        0 && (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[900px] text-left">
                                <thead>
                                    <tr className="border-b border-slate-100 bg-slate-50/70">
                                        <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                            Statement Date
                                        </th>

                                        <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                                            Statement Balance
                                        </th>

                                        <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                                            System Balance
                                        </th>

                                        <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                                            Difference
                                        </th>

                                        <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                            Status
                                        </th>

                                        <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                                            Action
                                        </th>
                                    </tr>
                                </thead>

                                <tbody>
                                    {filteredReconciliations.map(
                                        reconciliation => (
                                            <tr
                                                key={
                                                    reconciliation.id
                                                }
                                                className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50/70"
                                            >
                                                <td className="px-4 py-3 text-sm text-slate-700">
                                                    {formatDate(
                                                        reconciliation.statementDate
                                                    )}
                                                </td>

                                                <td className="px-4 py-3 text-right text-sm text-slate-700">
                                                    {formatAmount(
                                                        reconciliation.statementBalance
                                                    )}
                                                </td>

                                                <td className="px-4 py-3 text-right text-sm text-slate-700">
                                                    {formatAmount(
                                                        reconciliation.systemBalance
                                                    )}
                                                </td>

                                                <td
                                                    className={`px-4 py-3 text-right text-sm font-medium ${
                                                        Math.abs(
                                                            reconciliation.difference
                                                        ) <=
                                                        0.005
                                                            ? "text-emerald-600"
                                                            : "text-red-600"
                                                    }`}
                                                >
                                                    {formatAmount(
                                                        reconciliation.difference
                                                    )}
                                                </td>

                                                <td className="px-4 py-3">
                                                    <StatusBadge
                                                        status={
                                                            reconciliation.status
                                                        }
                                                    />
                                                </td>

                                                <td className="px-4 py-3 text-right">
                                                    <div className="inline-flex items-center gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                setSelectedReconciliation(
                                                                    reconciliation
                                                                )
                                                            }
                                                            className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                                                        >
                                                            Review
                                                        </button>

                                                        {reconciliation.status ===
                                                            "OPEN" && (
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                void handleComplete(
                                                                    reconciliation
                                                                )
                                                            }
                                                            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                                                        >
                                                            <CheckCircle2
                                                                size={
                                                                    14
                                                                }
                                                            />
                                                            Complete
                                                        </button>
                                                    )}

                                                    {reconciliation.status ===
                                                        "COMPLETED" && (
                                                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                                                            <CalendarCheck
                                                                size={
                                                                    14
                                                                }
                                                            />
                                                            Completed
                                                        </span>
                                                    )}
                                                    </div>
                                                </td>
                                            </tr>
                                        )
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
            </section>

            {selectedReconciliation && (
                <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                    <div className="mb-4 flex items-start justify-between gap-4">
                        <div>
                            <h2 className="text-base font-semibold text-slate-900">
                                Transaction Review
                            </h2>

                            <p className="mt-1 text-sm text-slate-500">
                                Review transactions included through the statement date.
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={() =>
                                setSelectedReconciliation(null)
                            }
                            className="text-sm font-medium text-slate-500 hover:text-slate-900"
                        >
                            Close
                        </button>
                    </div>

                    <ReconciliationTransactionReview
                        accountId={
                            selectedReconciliation.accountId
                        }
                        statementDate={
                            selectedReconciliation.statementDate
                        }
                    />
                </section>
            )}

            <ReconciliationDialog
                open={dialogOpen}
                accounts={accounts}
                onOpenChange={setDialogOpen}
                onCreated={async () => {
                    toast.success(
                        "Reconciliation created."
                    );

                    await loadData();
                }}
            />
        </div>
    );
}

function SummaryCard({
    label,
    value,
}: {
    label: string;
    value: string;
}) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="text-xs font-medium text-slate-500">
                {label}
            </div>

            <div className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
                {value}
            </div>
        </div>
    );
}

function StatusBadge({
    status,
}: {
    status: Reconciliation["status"];
}) {
    const completed =
        status === "COMPLETED";

    return (
        <span
            className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${
                completed
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-amber-200 bg-amber-50 text-amber-700"
            }`}
        >
            {completed
                ? "Completed"
                : "Open"}
        </span>
    );
}

function formatAmount(
    value: number
) {
    return new Intl.NumberFormat(
        "en-IN",
        {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }
    ).format(value);
}

function formatDate(
    value: string
) {
    if (!value) {
        return "â€”";
    }

    const date = new Date(value);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        return value;
    }

    return new Intl.DateTimeFormat(
        "en-IN",
        {
            day: "2-digit",
            month: "short",
            year: "numeric",
        }
    ).format(date);
}

