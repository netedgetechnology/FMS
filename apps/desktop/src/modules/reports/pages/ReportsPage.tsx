import { useEffect, useMemo, useState } from "react";

import PageHeader from "@/components/common/PageHeader";
import SectionCard from "@/components/common/SectionCard";

import {
    InvestmentReportingService,
} from "@/modules/investments/reports/services/InvestmentReportingService";

import type {
    InvestmentReport,
    InvestmentReportDateRange,
} from "@/modules/investments/reports/types";

const PAGE_SIZE = 5;

function formatMoney(value: number): string {
    return value.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function formatPercent(value: number): string {
    return `${value.toFixed(2)}%`;
}

function formatDate(value: string): string {
    if (!value) {
        return "";
    }

    const date = new Date(`${value}T00:00:00`);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    });
}

function getValueClass(value: number): string {
    if (value > 0) {
        return "text-emerald-600";
    }

    if (value < 0) {
        return "text-red-600";
    }

    return "text-slate-900";
}

export default function ReportsPage() {
    const reportingService =
        useMemo(
            () =>
                new InvestmentReportingService(),
            []
        );

    const [report, setReport] =
        useState<InvestmentReport | null>(null);

    const [fromDate, setFromDate] =
        useState("");

    const [toDate, setToDate] =
        useState("");

    const [appliedFromDate, setAppliedFromDate] =
        useState<string | undefined>();

    const [appliedToDate, setAppliedToDate] =
        useState<string | undefined>();

    const [currentPage, setCurrentPage] =
        useState(1);

    const [loading, setLoading] =
        useState(true);

    const [error, setError] =
        useState<string | null>(null);

    async function loadReport(
        dateRange?: InvestmentReportDateRange
    ) {
        try {
            setLoading(true);
            setError(null);

            const result =
                await reportingService.generateReport(
                    dateRange
                );

            setReport(result);
            setCurrentPage(1);
        } catch (err) {
            console.error(
                "FinanceOS Reports error:",
                err
            );

            setError(
                err instanceof Error
                    ? err.message
                    : "Unable to load investment report."
            );
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void loadReport();
    }, []);

    function handleApply() {
        const nextFromDate =
            fromDate.trim() || undefined;

        const nextToDate =
            toDate.trim() || undefined;

        if (
            nextFromDate &&
            nextToDate &&
            nextFromDate > nextToDate
        ) {
            setError(
                "From Date cannot be later than To Date."
            );

            return;
        }

        setAppliedFromDate(nextFromDate);
        setAppliedToDate(nextToDate);

        void loadReport({
            fromDate: nextFromDate,
            toDate: nextToDate,
        });
    }

    function handleClear() {
        setFromDate("");
        setToDate("");
        setAppliedFromDate(undefined);
        setAppliedToDate(undefined);

        void loadReport();
    }

    if (loading && !report) {
        return (
            <div className="p-6">
                <PageHeader
                    title="Reports"
                    subtitle="Financial reports and investment performance analysis."
                />

                <div className="rounded-xl bg-white p-8 text-center text-slate-500 shadow-sm">
                    Loading reports...
                </div>
            </div>
        );
    }

    if (error && !report) {
        return (
            <div className="p-6">
                <PageHeader
                    title="Reports"
                    subtitle="Financial reports and investment performance analysis."
                />

                <div className="rounded-xl bg-white p-8 text-center text-red-600 shadow-sm">
                    {error}
                </div>
            </div>
        );
    }

    if (!report) {
        return null;
    }

    const transactions =
        report.transactions;

    const totalPages =
        Math.max(
            1,
            Math.ceil(
                transactions.length /
                    PAGE_SIZE
            )
        );

    const safePage =
        Math.min(
            currentPage,
            totalPages
        );

    const startIndex =
        (safePage - 1) *
        PAGE_SIZE;

    const paginatedTransactions =
        transactions.slice(
            startIndex,
            startIndex + PAGE_SIZE
        );

    const firstEntry =
        transactions.length === 0
            ? 0
            : startIndex + 1;

    const lastEntry =
        Math.min(
            startIndex + PAGE_SIZE,
            transactions.length
        );

    const canClear =
        Boolean(
            fromDate ||
            toDate ||
            appliedFromDate ||
            appliedToDate
        );

    return (
        <div className="min-h-full bg-slate-50 p-5">
            <div className="mb-5 flex items-end justify-between gap-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-950">
                        Reports
                    </h1>

                    <p className="mt-1 text-sm text-slate-500">
                        Financial reports and investment performance analysis.
                    </p>
                </div>

                <div className="flex items-end gap-3">
                    <div>
                        <label
                            htmlFor="reports-from-date"
                            className="mb-1.5 block text-xs font-medium text-slate-600"
                        >
                            From Date
                        </label>

                        <input
                            id="reports-from-date"
                            type="date"
                            value={fromDate}
                            onChange={(event) =>
                                setFromDate(
                                    event.target.value
                                )
                            }
                            className="h-10 w-48 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-slate-400"
                        />
                    </div>

                    <div>
                        <label
                            htmlFor="reports-to-date"
                            className="mb-1.5 block text-xs font-medium text-slate-600"
                        >
                            To Date
                        </label>

                        <input
                            id="reports-to-date"
                            type="date"
                            value={toDate}
                            onChange={(event) =>
                                setToDate(
                                    event.target.value
                                )
                            }
                            className="h-10 w-48 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-slate-400"
                        />
                    </div>

                    <button
                        type="button"
                        onClick={handleApply}
                        className="h-10 rounded-lg bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
                    >
                        Apply
                    </button>

                    <button
                        type="button"
                        onClick={handleClear}
                        disabled={!canClear}
                        className="h-10 rounded-lg border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Clear
                    </button>
                </div>
            </div>

            {error && (
                <div className="mb-4 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                    {error}
                </div>
            )}

            <div className="mb-5 grid grid-cols-8 gap-3">
                <ReportStatCard
                    title="Invested Cost"
                    value={formatMoney(
                        report.portfolio.investedCost
                    )}
                />

                <ReportStatCard
                    title="Current Value"
                    value={formatMoney(
                        report.portfolio.currentValue
                    )}
                />

                <ReportStatCard
                    title="Unrealized Gain/Loss"
                    value={formatMoney(
                        report.portfolio.unrealizedGainLoss
                    )}
                    valueClassName={getValueClass(
                        report.portfolio.unrealizedGainLoss
                    )}
                />

                <ReportStatCard
                    title="Realized Gain/Loss"
                    value={formatMoney(
                        report.portfolio.realizedGainLoss
                    )}
                    valueClassName={getValueClass(
                        report.portfolio.realizedGainLoss
                    )}
                />

                <ReportStatCard
                    title="Dividend/Interest Income"
                    value={formatMoney(
                        report.portfolio.income
                    )}
                    valueClassName="text-emerald-600"
                />

                <ReportStatCard
                    title="Total Return"
                    value={formatMoney(
                        report.portfolio.totalReturn
                    )}
                    valueClassName={getValueClass(
                        report.portfolio.totalReturn
                    )}
                />

                <ReportStatCard
                    title="Return %"
                    value={formatPercent(
                        report.portfolio.returnPercentage
                    )}
                    valueClassName={getValueClass(
                        report.portfolio.returnPercentage
                    )}
                />

                <ReportStatCard
                    title="Active Investments"
                    value={String(
                        report.portfolio.activeInvestments
                    )}
                />
            </div>

            <div className="mb-5">
                <SectionCard title="Investment Performance">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-700">
                                    <th className="px-2 py-3">
                                        Investment
                                    </th>
                                    <th className="px-2 py-3">
                                        Type
                                    </th>
                                    <th className="px-2 py-3">
                                        Symbol
                                    </th>
                                    <th className="px-2 py-3 text-right">
                                        Quantity
                                    </th>
                                    <th className="px-2 py-3 text-right">
                                        Avg. Cost
                                    </th>
                                    <th className="px-2 py-3 text-right">
                                        Current Price
                                    </th>
                                    <th className="px-2 py-3 text-right">
                                        Invested Cost
                                    </th>
                                    <th className="px-2 py-3 text-right">
                                        Current Value
                                    </th>
                                    <th className="px-2 py-3 text-right">
                                        Gain/Loss
                                    </th>
                                    <th className="px-2 py-3 text-right">
                                        Return
                                    </th>
                                </tr>
                            </thead>

                            <tbody>
                                {report.investments.map(
                                    (investment) => (
                                        <tr
                                            key={
                                                investment.investmentId
                                            }
                                            className="border-b border-slate-100 last:border-0"
                                        >
                                            <td className="px-2 py-3 font-medium text-slate-900">
                                                {
                                                    investment.name
                                                }
                                            </td>

                                            <td className="px-2 py-3 text-slate-700">
                                                {
                                                    investment.investmentType
                                                }
                                            </td>

                                            <td className="px-2 py-3 text-slate-700">
                                                {
                                                    investment.symbol ??
                                                    "—"
                                                }
                                            </td>

                                            <td className="px-2 py-3 text-right text-slate-700">
                                                {
                                                    investment.quantity
                                                }
                                            </td>

                                            <td className="px-2 py-3 text-right text-slate-700">
                                                {formatMoney(
                                                    investment.averageCost
                                                )}
                                            </td>

                                            <td className="px-2 py-3 text-right text-slate-700">
                                                {formatMoney(
                                                    investment.currentPrice
                                                )}
                                            </td>

                                            <td className="px-2 py-3 text-right text-slate-700">
                                                {formatMoney(
                                                    investment.investedCost
                                                )}
                                            </td>

                                            <td className="px-2 py-3 text-right text-slate-700">
                                                {formatMoney(
                                                    investment.currentValue
                                                )}
                                            </td>

                                            <td
                                                className={`px-2 py-3 text-right font-medium ${getValueClass(
                                                    investment.unrealizedGainLoss
                                                )}`}
                                            >
                                                {formatMoney(
                                                    investment.unrealizedGainLoss
                                                )}
                                            </td>

                                            <td
                                                className={`px-2 py-3 text-right font-medium ${getValueClass(
                                                    investment.returnPercentage
                                                )}`}
                                            >
                                                {formatPercent(
                                                    investment.returnPercentage
                                                )}
                                            </td>
                                        </tr>
                                    )
                                )}
                            </tbody>
                        </table>
                    </div>
                </SectionCard>
            </div>

            <div className="mb-5">
                <SectionCard title="Transactions">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-700">
                                    <th className="px-2 py-3">
                                        Date
                                    </th>
                                    <th className="px-2 py-3">
                                        Investment
                                    </th>
                                    <th className="px-2 py-3">
                                        Type
                                    </th>
                                    <th className="px-2 py-3 text-right">
                                        Quantity
                                    </th>
                                    <th className="px-2 py-3 text-right">
                                        Price
                                    </th>
                                    <th className="px-2 py-3 text-right">
                                        Amount
                                    </th>
                                    <th className="px-2 py-3 text-right">
                                        Fees
                                    </th>
                                    <th className="px-2 py-3 text-right">
                                        Taxes
                                    </th>
                                    <th className="px-2 py-3 text-right">
                                        Net Amount
                                    </th>
                                    <th className="px-2 py-3">
                                        Reference
                                    </th>
                                </tr>
                            </thead>

                            <tbody>
                                {paginatedTransactions.map(
                                    (transaction) => (
                                        <tr
                                            key={
                                                transaction.transactionId
                                            }
                                            className="border-b border-slate-100 last:border-0"
                                        >
                                            <td className="px-2 py-2.5 text-slate-700">
                                                {formatDate(
                                                    transaction.transactionDate
                                                )}
                                            </td>

                                            <td className="px-2 py-2.5 font-medium text-slate-900">
                                                {
                                                    transaction.investmentName
                                                }
                                            </td>

                                            <td className="px-2 py-2.5 text-slate-700">
                                                {
                                                    transaction.transactionType
                                                }
                                            </td>

                                            <td className="px-2 py-2.5 text-right text-slate-700">
                                                {
                                                    transaction.quantity
                                                }
                                            </td>

                                            <td className="px-2 py-2.5 text-right text-slate-700">
                                                {formatMoney(
                                                    transaction.price
                                                )}
                                            </td>

                                            <td className="px-2 py-2.5 text-right text-slate-700">
                                                {formatMoney(
                                                    transaction.amount
                                                )}
                                            </td>

                                            <td className="px-2 py-2.5 text-right text-slate-700">
                                                {formatMoney(
                                                    transaction.fees
                                                )}
                                            </td>

                                            <td className="px-2 py-2.5 text-right text-slate-700">
                                                {formatMoney(
                                                    transaction.taxes
                                                )}
                                            </td>

                                            <td className="px-2 py-2.5 text-right font-medium text-slate-900">
                                                {formatMoney(
                                                    transaction.netAmount
                                                )}
                                            </td>

                                            <td className="px-2 py-2.5 text-slate-700">
                                                {
                                                    transaction.referenceNumber ??
                                                    "—"
                                                }
                                            </td>
                                        </tr>
                                    )
                                )}

                                {paginatedTransactions.length ===
                                    0 && (
                                    <tr>
                                        <td
                                            colSpan={10}
                                            className="px-4 py-8 text-center text-slate-500"
                                        >
                                            No transactions found for the selected date range.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                        <div className="text-xs text-slate-500">
                            Showing{" "}
                            {firstEntry} to{" "}
                            {lastEntry} of{" "}
                            {transactions.length}{" "}
                            entries
                        </div>

                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                disabled={
                                    safePage === 1
                                }
                                onClick={() =>
                                    setCurrentPage(
                                        (page) =>
                                            Math.max(
                                                1,
                                                page - 1
                                            )
                                    )
                                }
                                className="flex h-8 min-w-8 items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                ‹
                            </button>

                            {Array.from(
                                {
                                    length: totalPages,
                                },
                                (_, index) =>
                                    index + 1
                            ).map((page) => (
                                <button
                                    key={page}
                                    type="button"
                                    onClick={() =>
                                        setCurrentPage(
                                            page
                                        )
                                    }
                                    className={`flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-sm font-medium transition ${
                                        page ===
                                        safePage
                                            ? "border-slate-950 bg-slate-950 text-white"
                                            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                                    }`}
                                >
                                    {page}
                                </button>
                            ))}

                            <button
                                type="button"
                                disabled={
                                    safePage ===
                                    totalPages
                                }
                                onClick={() =>
                                    setCurrentPage(
                                        (page) =>
                                            Math.min(
                                                totalPages,
                                                page + 1
                                            )
                                    )
                                }
                                className="flex h-8 min-w-8 items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                ›
                            </button>
                        </div>
                    </div>
                </SectionCard>
            </div>

            <div className="grid grid-cols-2 gap-5">
                <SectionCard title="Dividend / Interest Income">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-700">
                                    <th className="px-2 py-3">
                                        Date
                                    </th>
                                    <th className="px-2 py-3">
                                        Investment
                                    </th>
                                    <th className="px-2 py-3">
                                        Type
                                    </th>
                                    <th className="px-2 py-3 text-right">
                                        Gross Amount
                                    </th>
                                    <th className="px-2 py-3 text-right">
                                        Fees
                                    </th>
                                    <th className="px-2 py-3 text-right">
                                        Taxes
                                    </th>
                                    <th className="px-2 py-3 text-right">
                                        Net Income
                                    </th>
                                </tr>
                            </thead>

                            <tbody>
                                {report.income.map(
                                    (income) => (
                                        <tr
                                            key={
                                                income.transactionId
                                            }
                                            className="border-b border-slate-100 last:border-0"
                                        >
                                            <td className="px-2 py-2.5 text-slate-700">
                                                {formatDate(
                                                    income.transactionDate
                                                )}
                                            </td>

                                            <td className="px-2 py-2.5 font-medium text-slate-900">
                                                {
                                                    income.investmentName
                                                }
                                            </td>

                                            <td className="px-2 py-2.5 text-slate-700">
                                                {
                                                    income.transactionType
                                                }
                                            </td>

                                            <td className="px-2 py-2.5 text-right text-slate-700">
                                                {formatMoney(
                                                    income.grossAmount
                                                )}
                                            </td>

                                            <td className="px-2 py-2.5 text-right text-slate-700">
                                                {formatMoney(
                                                    income.fees
                                                )}
                                            </td>

                                            <td className="px-2 py-2.5 text-right text-slate-700">
                                                {formatMoney(
                                                    income.taxes
                                                )}
                                            </td>

                                            <td className="px-2 py-2.5 text-right font-semibold text-emerald-600">
                                                {formatMoney(
                                                    income.netIncome
                                                )}
                                            </td>
                                        </tr>
                                    )
                                )}
                            </tbody>
                        </table>
                    </div>
                </SectionCard>

                <SectionCard title="Realized Gain / Loss">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-700">
                                    <th className="px-2 py-3">
                                        Date
                                    </th>
                                    <th className="px-2 py-3">
                                        Investment
                                    </th>
                                    <th className="px-2 py-3 text-right">
                                        Quantity
                                    </th>
                                    <th className="px-2 py-3 text-right">
                                        Sale Price
                                    </th>
                                    <th className="px-2 py-3 text-right">
                                        Sale Amount
                                    </th>
                                    <th className="px-2 py-3 text-right">
                                        Cost Basis
                                    </th>
                                    <th className="px-2 py-3 text-right">
                                        Net Proceeds
                                    </th>
                                    <th className="px-2 py-3 text-right">
                                        Gain/Loss
                                    </th>
                                </tr>
                            </thead>

                            <tbody>
                                {report.realizedGainLoss.map(
                                    (row) => (
                                        <tr
                                            key={
                                                row.transactionId
                                            }
                                            className="border-b border-slate-100 last:border-0"
                                        >
                                            <td className="px-2 py-2.5 text-slate-700">
                                                {formatDate(
                                                    row.transactionDate
                                                )}
                                            </td>

                                            <td className="px-2 py-2.5 font-medium text-slate-900">
                                                {
                                                    row.investmentName
                                                }
                                            </td>

                                            <td className="px-2 py-2.5 text-right text-slate-700">
                                                {
                                                    row.quantity
                                                }
                                            </td>

                                            <td className="px-2 py-2.5 text-right text-slate-700">
                                                {formatMoney(
                                                    row.salePrice
                                                )}
                                            </td>

                                            <td className="px-2 py-2.5 text-right text-slate-700">
                                                {formatMoney(
                                                    row.saleAmount
                                                )}
                                            </td>

                                            <td className="px-2 py-2.5 text-right text-slate-700">
                                                {formatMoney(
                                                    row.costBasis
                                                )}
                                            </td>

                                            <td className="px-2 py-2.5 text-right text-slate-700">
                                                {formatMoney(
                                                    row.netSaleProceeds
                                                )}
                                            </td>

                                            <td
                                                className={`px-2 py-2.5 text-right font-semibold ${getValueClass(
                                                    row.realizedGainLoss
                                                )}`}
                                            >
                                                {formatMoney(
                                                    row.realizedGainLoss
                                                )}
                                            </td>
                                        </tr>
                                    )
                                )}
                            </tbody>
                        </table>
                    </div>
                </SectionCard>
            </div>
        </div>
    );
}

type ReportStatCardProps = {
    title: string;
    value: string;
    valueClassName?: string;
};

function ReportStatCard({
    title,
    value,
    valueClassName = "text-slate-950",
}: ReportStatCardProps) {
    return (
        <div className="flex h-24 flex-col justify-between rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
            <div className="text-xs font-medium leading-4 text-slate-500">
                {title}
            </div>

            <div
                className={`text-lg font-bold tracking-tight ${valueClassName}`}
            >
                {value}
            </div>
        </div>
    );
}
