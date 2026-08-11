import {
    useCallback,
    useEffect,
    useMemo,
    useState,
} from "react";

import {
    EmptyState,
    PageHeader,
} from "@/components/common";

import {
    AddInvestmentDialog,
} from "../components";

import { InvestmentService } from "../services";

import {
    Investment,
    InvestmentStatus,
} from "../types";

export default function InvestmentsPage() {
    const [investments, setInvestments] =
        useState<Investment[]>([]);

    const [loading, setLoading] =
        useState(true);

    const [error, setError] =
        useState<string | null>(null);

    const loadInvestments = useCallback(
        async () => {
            try {
                setLoading(true);
                setError(null);

                const service =
                    new InvestmentService();

                const result =
                    await service.getAll();

                setInvestments(result);
            } catch (error) {
                console.error(
                    "Failed to load investments:",
                    error
                );

                setError(
                    error instanceof Error
                        ? error.message
                        : "Failed to load investments."
                );
            } finally {
                setLoading(false);
            }
        },
        []
    );

    useEffect(() => {
        void loadInvestments();
    }, [loadInvestments]);

    const summary = useMemo(() => {
        const activeInvestments =
            investments.filter(
                (investment) =>
                    investment.status ===
                    InvestmentStatus.ACTIVE
            );

        const totalCost =
            investments.reduce(
                (sum, investment) =>
                    sum +
                    investment.quantity *
                        investment.averageCost,
                0
            );

        const currentValue =
            investments.reduce(
                (sum, investment) =>
                    sum + investment.currentValue,
                0
            );

        const gainLoss =
            currentValue - totalCost;

        return {
            totalInvestments:
                investments.length,

            activeInvestments:
                activeInvestments.length,

            totalCost,

            currentValue,

            gainLoss,
        };
    }, [investments]);

    return (
        <div className="min-h-full bg-slate-50">
            <div className="w-full space-y-6">
                <PageHeader
                    title="Investments"
                    subtitle="Track your investments, holdings and portfolio value."
                    actions={
                        <AddInvestmentDialog
                            onSuccess={loadInvestments}
                        />
                    }
                />

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
                    <SummaryCard
                        label="Total Investments"
                        value={summary.totalInvestments.toString()}
                    />

                    <SummaryCard
                        label="Active Investments"
                        value={summary.activeInvestments.toString()}
                    />

                    <SummaryCard
                        label="Total Cost"
                        value={formatAmount(
                            summary.totalCost
                        )}
                    />

                    <SummaryCard
                        label="Current Value"
                        value={formatAmount(
                            summary.currentValue
                        )}
                    />

                    <SummaryCard
                        label="Gain / Loss"
                        value={formatAmount(
                            summary.gainLoss
                        )}
                        valueClassName={
                            summary.gainLoss >= 0
                                ? "text-emerald-600"
                                : "text-red-600"
                        }
                    />
                </div>

                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                        <div>
                            <h2 className="text-sm font-semibold text-slate-900">
                                Investments
                            </h2>

                            <p className="mt-0.5 text-xs text-slate-500">
                                Your current investment holdings.
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={() =>
                                void loadInvestments()
                            }
                            disabled={loading}
                            className="h-9 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Refresh
                        </button>
                    </div>

                    {loading ? (
                        <div className="px-6 py-14 text-center text-sm text-slate-500">
                            Loading investments...
                        </div>
                    ) : error ? (
                        <div className="px-6 py-14 text-center">
                            <p className="text-sm font-medium text-red-600">
                                {error}
                            </p>

                            <button
                                type="button"
                                onClick={() =>
                                    void loadInvestments()
                                }
                                className="mt-4 h-9 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800"
                            >
                                Try Again
                            </button>
                        </div>
                    ) : investments.length === 0 ? (
                        <div className="px-6 py-14 text-center">
                            <EmptyState
                                title="No investments yet"
                                description="Add your first investment to start tracking your portfolio."
                            />

                            <div className="mt-5">
                                <AddInvestmentDialog
                                    onSuccess={loadInvestments}
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[1050px] text-left">
                                <thead>
                                    <tr className="border-b border-slate-100 bg-slate-50/70">
                                        <TableHeader>
                                            Investment
                                        </TableHeader>

                                        <TableHeader>
                                            Type
                                        </TableHeader>

                                        <TableHeader>
                                            Symbol
                                        </TableHeader>

                                        <TableHeader align="right">
                                            Quantity
                                        </TableHeader>

                                        <TableHeader align="right">
                                            Avg. Cost
                                        </TableHeader>

                                        <TableHeader align="right">
                                            Current Price
                                        </TableHeader>

                                        <TableHeader align="right">
                                            Current Value
                                        </TableHeader>

                                        <TableHeader align="right">
                                            Gain / Loss
                                        </TableHeader>

                                        <TableHeader>
                                            Status
                                        </TableHeader>
                                    </tr>
                                </thead>

                                <tbody>
                                    {investments.map(
                                        (investment) => {
                                            const cost =
                                                investment.quantity *
                                                investment.averageCost;

                                            const gainLoss =
                                                investment.currentValue -
                                                cost;

                                            return (
                                                <tr
                                                    key={
                                                        investment.id
                                                    }
                                                    className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/50"
                                                >
                                                    <td className="px-5 py-4">
                                                        <div className="font-medium text-slate-900">
                                                            {
                                                                investment.name
                                                            }
                                                        </div>

                                                        {investment.isin && (
                                                            <div className="mt-0.5 text-xs text-slate-400">
                                                                {
                                                                    investment.isin
                                                                }
                                                            </div>
                                                        )}
                                                    </td>

                                                    <td className="px-5 py-4 text-sm text-slate-600">
                                                        {
                                                            investment.investmentType
                                                        }
                                                    </td>

                                                    <td className="px-5 py-4 text-sm font-medium text-slate-700">
                                                        {investment.symbol ||
                                                            "—"}
                                                    </td>

                                                    <td className="px-5 py-4 text-right text-sm text-slate-700">
                                                        {formatNumber(
                                                            investment.quantity
                                                        )}
                                                    </td>

                                                    <td className="px-5 py-4 text-right text-sm text-slate-700">
                                                        {formatAmount(
                                                            investment.averageCost
                                                        )}
                                                    </td>

                                                    <td className="px-5 py-4 text-right text-sm text-slate-700">
                                                        {formatAmount(
                                                            investment.currentPrice
                                                        )}
                                                    </td>

                                                    <td className="px-5 py-4 text-right text-sm font-medium text-slate-900">
                                                        {formatAmount(
                                                            investment.currentValue
                                                        )}
                                                    </td>

                                                    <td
                                                        className={`px-5 py-4 text-right text-sm font-medium ${
                                                            gainLoss >=
                                                            0
                                                                ? "text-emerald-600"
                                                                : "text-red-600"
                                                        }`}
                                                    >
                                                        {formatAmount(
                                                            gainLoss
                                                        )}
                                                    </td>

                                                    <td className="px-5 py-4">
                                                        <StatusBadge
                                                            status={
                                                                investment.status
                                                            }
                                                        />
                                                    </td>
                                                </tr>
                                            );
                                        }
                                    )}
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
    valueClassName = "text-slate-900",
}: {
    label: string;
    value: string;
    valueClassName?: string;
}) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="text-xs font-medium text-slate-500">
                {label}
            </div>

            <div
                className={`mt-2 text-xl font-semibold tracking-tight ${valueClassName}`}
            >
                {value}
            </div>
        </div>
    );
}

function TableHeader({
    children,
    align = "left",
}: {
    children: React.ReactNode;
    align?: "left" | "right";
}) {
    return (
        <th
            className={`px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 ${
                align === "right"
                    ? "text-right"
                    : "text-left"
            }`}
        >
            {children}
        </th>
    );
}

function StatusBadge({
    status,
}: {
    status: InvestmentStatus;
}) {
    const label =
        status === InvestmentStatus.ON_HOLD
            ? "On Hold"
            : status === InvestmentStatus.CLOSED
                ? "Closed"
                : "Active";

    return (
        <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
            {label}
        </span>
    );
}

function formatNumber(
    value: number
): string {
    return new Intl.NumberFormat(
        undefined,
        {
            maximumFractionDigits: 4,
        }
    ).format(value);
}

function formatAmount(
    value: number
): string {
    return new Intl.NumberFormat(
        undefined,
        {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }
    ).format(value);
}

