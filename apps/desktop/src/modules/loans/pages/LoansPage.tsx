import { useCallback, useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/common";

import { AddLoanDialog } from "../components/AddLoanDialog";
import { LoanService } from "../services";
import { Loan } from "../types";

export default function LoansPage() {
    const [loans, setLoans] = useState<Loan[]>([]);
    const [loading, setLoading] = useState(true);

    const loadLoans = useCallback(async () => {
        try {
            setLoading(true);

            const service = new LoanService();
            const result = await service.getAll();

            setLoans(result);
        } catch (error) {
            console.error("Failed to load loans:", error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadLoans();
    }, [loadLoans]);

    const summary = useMemo(() => {
        const activeLoans = loans.filter(
            loan => loan.status === "ACTIVE"
        );

        return {
            totalLoans: loans.length,
            activeLoans: activeLoans.length,
            principal: loans.reduce(
                (total, loan) => total + loan.principalAmount,
                0
            ),
            outstanding: loans.reduce(
                (total, loan) =>
                    total + loan.outstandingPrincipal,
                0
            ),
        };
    }, [loans]);

    return (
        <div className="min-h-full bg-slate-50">
            <div className="w-full space-y-6">
                <PageHeader
                    title="Loans"
                    subtitle="Manage your loans, EMI schedules and outstanding balances."
                    actions={
                        <AddLoanDialog onSuccess={loadLoans} />
                    }
                />

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <SummaryCard
                        label="Total Loans"
                        value={summary.totalLoans.toString()}
                    />

                    <SummaryCard
                        label="Active Loans"
                        value={summary.activeLoans.toString()}
                    />

                    <SummaryCard
                        label="Total Principal"
                        value={formatAmount(summary.principal)}
                    />

                    <SummaryCard
                        label="Outstanding Principal"
                        value={formatAmount(summary.outstanding)}
                    />
                </div>

                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                        <div>
                            <h2 className="text-sm font-semibold text-slate-900">
                                Loans
                            </h2>

                            <p className="mt-0.5 text-xs text-slate-500">
                                Your active and historical loans
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={() => void loadLoans()}
                            disabled={loading}
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Refresh
                        </button>
                    </div>

                    {loading ? (
                        <div className="px-6 py-12 text-center text-sm text-slate-500">
                            Loading loans...
                        </div>
                    ) : loans.length === 0 ? (
                        <div className="px-6 py-14 text-center">
                            <div className="text-sm font-medium text-slate-900">
                                No loans yet
                            </div>

                            <p className="mt-1 text-sm text-slate-500">
                                Add your first loan to start tracking
                                principal, EMI and outstanding balance.
                            </p>

                            <div className="mt-5">
                                <AddLoanDialog
                                    onSuccess={loadLoans}
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[900px]">
                                <thead>
                                    <tr className="border-b border-slate-100 bg-slate-50/70">
                                        <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500">
                                            Loan
                                        </th>

                                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">
                                            Type
                                        </th>

                                        <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">
                                            Principal
                                        </th>

                                        <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">
                                            Outstanding
                                        </th>

                                        <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">
                                            Interest
                                        </th>

                                        <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">
                                            EMI
                                        </th>

                                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">
                                            Status
                                        </th>
                                    </tr>
                                </thead>

                                <tbody>
                                    {loans.map(loan => (
                                        <tr
                                            key={loan.id}
                                            className="border-b border-slate-100 last:border-b-0"
                                        >
                                            <td className="px-6 py-4">
                                                <div className="text-sm font-semibold text-slate-900">
                                                    {loan.name}
                                                </div>

                                                <div className="mt-0.5 text-xs text-slate-500">
                                                    Started {formatDate(loan.startDate)}
                                                </div>
                                            </td>

                                            <td className="px-4 py-4 text-sm text-slate-700">
                                                {loan.loanType}
                                            </td>

                                            <td className="px-4 py-4 text-right text-sm font-medium text-slate-900">
                                                {formatAmount(
                                                    loan.principalAmount
                                                )}
                                            </td>

                                            <td className="px-4 py-4 text-right text-sm font-medium text-slate-900">
                                                {formatAmount(
                                                    loan.outstandingPrincipal
                                                )}
                                            </td>

                                            <td className="px-4 py-4 text-right text-sm text-slate-700">
                                                {loan.interestRate.toFixed(2)}%
                                            </td>

                                            <td className="px-4 py-4 text-right text-sm text-slate-700">
                                                {loan.emiAmount == null
                                                    ? "—"
                                                    : formatAmount(
                                                          loan.emiAmount
                                                      )}
                                            </td>

                                            <td className="px-4 py-4">
                                                <StatusBadge
                                                    status={loan.status}
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
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
    status: Loan["status"];
}) {
    const label = status
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/\b\w/g, character => character.toUpperCase());

    return (
        <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
            {label}
        </span>
    );
}

function formatAmount(value: number) {
    return new Intl.NumberFormat("en-IN", {
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
    }).format(value);
}

function formatDate(value: string) {
    if (!value) {
        return "—";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    }).format(date);
}
