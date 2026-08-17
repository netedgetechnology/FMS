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
    AddInvestmentTransactionDialog,
    EditInvestmentDialog,
    DeleteInvestmentDialog,
    EditInvestmentTransactionDialog,
    DeleteInvestmentTransactionDialog,
} from "../components";

import {
    InvestmentService,
    InvestmentTransactionService,
} from "../services";

import {
    Investment,
    InvestmentStatus,
    InvestmentTransaction,
} from "../types";

import {
    List,
    Pencil,
    RefreshCw,
    Trash2,
} from "lucide-react";

export default function InvestmentsPage() {
    const [investments, setInvestments] =
        useState<Investment[]>([]);

    const [loading, setLoading] =
        useState(true);

    const [error, setError] =
        useState<string | null>(null);

    const [selectedInvestmentId, setSelectedInvestmentId] =
        useState<string | null>(null);

    const [transactions, setTransactions] =
        useState<InvestmentTransaction[]>([]);

    const [transactionsLoading, setTransactionsLoading] =
        useState(false);

    const [transactionsError, setTransactionsError] =
        useState<string | null>(null);

    const loadTransactions = useCallback(
        async (investmentId: string) => {
            try {
                setTransactionsLoading(true);
                setTransactionsError(null);

                const service =
                    new InvestmentTransactionService();

                const result =
                    await service.getAllByInvestmentId(
                        investmentId
                    );

                setTransactions(result);
            } catch (error) {
                console.error(
                    "Failed to load investment transactions:",
                    error
                );

                setTransactionsError(
                    error instanceof Error
                        ? error.message
                        : "Failed to load investment transactions."
                );
            } finally {
                setTransactionsLoading(false);
            }
        },
        []
    );
    const handleTransactionsToggle = useCallback(
        async (investmentId: string) => {
            if (selectedInvestmentId === investmentId) {
                setSelectedInvestmentId(null);
                setTransactions([]);
                setTransactionsError(null);
                return;
            }

            setSelectedInvestmentId(investmentId);
            await loadTransactions(investmentId);
        },
        [
            selectedInvestmentId,
            loadTransactions,
        ]
    );

    const [portfolioCalculations, setPortfolioCalculations] =
        useState<
            Record<
                string,
                {
                    totalCost: number;
                    currentValue: number;
                    realizedGainLoss: number;
                    income: number;
                }
            >
        >({});

    const loadPortfolioCalculations = useCallback(
        async (investmentList: Investment[]) => {
            const service =
                new InvestmentTransactionService();

            const results =
                await Promise.all(
                    investmentList.map(
                        async (investment) => {
                            const calculation =
                                await service.getPortfolioCalculation(
                                    investment.id
                                );

                            return [
                                investment.id,
                                {
                                    totalCost:
                                        calculation.totalCost,

                                    currentValue:
                                        calculation.currentValue,

                                    realizedGainLoss:
                                        calculation.realizedGainLoss,

                                    income:
                                        calculation.income,
                                },
                            ] as const;
                        }
                    )
                );

            setPortfolioCalculations(
                Object.fromEntries(results)
            );
        },
        []
    );

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

                await loadPortfolioCalculations(
                    result
                );


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

                setPortfolioCalculations({});
            } finally {
                setLoading(false);
            }
        },
        [
            loadPortfolioCalculations,
        ]
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

        let investedCost = 0;
        let currentValue = 0;
        let realizedGainLoss = 0;
        let income = 0;

        for (const investment of investments) {
            const calculation =
                portfolioCalculations[
                    investment.id
                ];

            if (!calculation) {
                continue;
            }

            investedCost +=
                calculation.totalCost;

            currentValue +=
                calculation.currentValue;

            realizedGainLoss +=
                calculation.realizedGainLoss;

            income +=
                calculation.income;
        }

        const unrealizedGainLoss =
            currentValue - investedCost;

        const totalReturn =
            unrealizedGainLoss +
            realizedGainLoss +
            income;

        return {
            totalInvestments:
                investments.length,

            activeInvestments:
                activeInvestments.length,

            investedCost,

            currentValue,

            unrealizedGainLoss,

            realizedGainLoss,

            income,

            totalReturn,
        };
    }, [
        investments,
        portfolioCalculations,
    ]);

    return (
        <div className="min-h-full bg-slate-50/70">
            <div className="w-full space-y-4">
                <PageHeader
                    title="Investments"
                    subtitle="Track your investments, holdings and portfolio value."
                    actions={
                        <AddInvestmentDialog
                            onSuccess={loadInvestments}
                        />
                    }
                />

                <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
                        <SummaryCard
                            label="Total Investments"
                            value={summary.totalInvestments.toString()}
                        />

                        <SummaryCard
                            label="Active Investments"
                            value={summary.activeInvestments.toString()}
                        />

                        <SummaryCard
                            label="Invested Cost"
                            value={formatAmount(
                                summary.investedCost
                            )}
                        />

                        <SummaryCard
                            label="Current Value"
                            value={formatAmount(
                                summary.currentValue
                            )}
                        />

                        <SummaryCard
                            label="Unrealized Gain/Loss"
                            value={formatAmount(
                                summary.unrealizedGainLoss
                            )}
                            valueClassName={
                                summary.unrealizedGainLoss >= 0
                                    ? "text-emerald-600"
                                    : "text-red-600"
                            }
                        />

                        <SummaryCard
                            label="Realized Gain/Loss"
                            value={formatAmount(
                                summary.realizedGainLoss
                            )}
                            valueClassName={
                                summary.realizedGainLoss >= 0
                                    ? "text-emerald-600"
                                    : "text-red-600"
                            }
                        />
                        <SummaryCard
                            label="Dividend/Interest Income"
                            value={formatAmount(
                                summary.income
                            )}
                            valueClassName={
                                summary.income >= 0
                                    ? "text-emerald-600"
                                    : "text-red-600"
                            }
                        />

                        <SummaryCard
                            label="Total Return"
                            value={formatAmount(
                                summary.totalReturn
                            )}
                            valueClassName={
                                summary.totalReturn >= 0
                                    ? "text-emerald-600"
                                    : "text-red-600"
                            }
                        />
                    </div>
                </div>

                <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                        <div>
                            <h2 className="text-sm font-semibold text-slate-900">
                                Investments
                            </h2>

                            <p className="mt-1 text-xs text-slate-500">
                                Your current investment holdings.
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={() =>
                                void loadInvestments()
                            }
                            disabled={loading}
                            title="Refresh investments"
                            aria-label="Refresh investments"
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <RefreshCw
                                className={`h-3.5 w-3.5 ${
                                    loading ? "animate-spin" : ""
                                }`}
                            />
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
                            <table className="w-full min-w-[900px] text-left">
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

                                        <TableHeader>
                                            Actions
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
                                                    <td className="px-4 py-3">
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
                                                            "â€”"}
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

                                                    <td className="px-4 py-3">
                                                        <StatusBadge
                                                            status={
                                                                investment.status
                                                            }
                                                        />
                                                    </td>

                                                                                                    <td className="px-3 py-3">
                                                        <div className="flex flex-nowrap items-center gap-1.5">
                                                            <button
    type="button"
    onClick={() =>
        void handleTransactionsToggle(
            investment.id
        )
    }
    title={
        selectedInvestmentId === investment.id
            ? "Hide transactions"
            : "View transactions"
    }
    aria-label={
        selectedInvestmentId === investment.id
            ? "Hide transactions"
            : "View transactions"
    }
    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50"
>
    <List className="h-3.5 w-3.5" />
</button>

                                                            <AddInvestmentTransactionDialog
                                                                investmentId={
                                                                    investment.id
                                                                }
                                                                onSuccess={
                                                                    async () => {
                                                                        await loadInvestments();

                                                                        if (
                                                                            selectedInvestmentId ===
                                                                            investment.id
                                                                        ) {
                                                                            await loadTransactions(
                                                                                investment.id
                                                                            );
                                                                        }
                                                                    }
                                                                }
                                                            />

                                                            <EditInvestmentDialog
                                                                investment={
                                                                    investment
                                                                }
                                                                onSuccess={
                                                                    loadInvestments
                                                                }
                                                            />

                                                            <DeleteInvestmentDialog
                                                                investment={
                                                                    investment
                                                                }
                                                                onSuccess={
                                                                    async () => {
                                                                        if (
                                                                            selectedInvestmentId ===
                                                                            investment.id
                                                                        ) {
                                                                            setSelectedInvestmentId(
                                                                                null
                                                                            );
                                                                            setTransactions(
                                                                                []
                                                                            );
                                                                        }

                                                                        await loadInvestments();
                                                                    }
                                                                }
                                                            />
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        }
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {selectedInvestmentId && (
                        <TransactionHistory
                            transactions={transactions}
                            loading={transactionsLoading}
                            error={transactionsError}
                            onRefresh={async () => {
                                await loadInvestments();
                                await loadTransactions(
                                    selectedInvestmentId
                                );
                            }}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

function TransactionHistory({
    transactions,
    loading,
    error,
    onRefresh,
}: {
    transactions: InvestmentTransaction[];
    loading: boolean;
    error: string | null;
    onRefresh(): void | Promise<void>;
}) {
    return (
        <div className="border-t border-slate-200 bg-slate-50/40">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                        Transaction History
                    </h2>

                    <p className="mt-1 text-xs text-slate-500">
                        Transactions recorded for this investment.
                    </p>
                </div>

                <button
                    type="button"
                    onClick={() => void onRefresh()}
                    disabled={loading}
                    title="Refresh transactions"
                    aria-label="Refresh transactions"
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <RefreshCw
                        className={`h-3.5 w-3.5 ${
                            loading ? "animate-spin" : ""
                        }`}
                    />
                </button>
            </div>

            {loading ? (
                <div className="px-6 py-10 text-center text-sm text-slate-500">
                    Loading transactions...
                </div>
            ) : error ? (
                <div className="px-6 py-10 text-center">
                    <p className="text-sm font-medium text-red-600">
                        {error}
                    </p>

                    <button
                        type="button"
                        onClick={() => void onRefresh()}
                        className="mt-4 h-8 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800"
                    >
                        Try Again
                    </button>
                </div>
            ) : transactions.length === 0 ? (
                <div className="px-6 py-10 text-center text-sm text-slate-500">
                    No transactions recorded for this investment yet.
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] text-left">
                        <thead>
                            <tr className="border-b border-slate-100 bg-white">
                                <TableHeader>
                                    Date
                                </TableHeader>

                                <TableHeader>
                                    Type
                                </TableHeader>

                                <TableHeader align="right">
                                    Quantity
                                </TableHeader>

                                <TableHeader align="right">
                                    Price
                                </TableHeader>

                                <TableHeader align="right">
                                    Amount
                                </TableHeader>

                                <TableHeader align="right">
                                    Fees
                                </TableHeader>

                                <TableHeader align="right">
                                    Taxes
                                </TableHeader>

                                <TableHeader>
                                    Reference
                                </TableHeader>

                                <TableHeader align="right">
                                    Actions
                                </TableHeader>
                            </tr>
                        </thead>

                        <tbody>
                            {transactions.map(
                                (transaction) => (
                                    <tr
                                        key={transaction.id}
                                        className="border-b border-slate-100 last:border-b-0 hover:bg-white"
                                    >
                                        <td className="px-4 py-2 text-sm text-slate-600">
                                            {transaction.transactionDate}
                                        </td>

                                        <td className="px-4 py-2.5">
                                            <TransactionTypeBadge
                                                type={
                                                    transaction.transactionType
                                                }
                                            />
                                        </td>

                                        <td className="px-5 py-3 text-right text-sm text-slate-700">
                                            {formatNumber(
                                                transaction.quantity
                                            )}
                                        </td>

                                        <td className="px-5 py-3 text-right text-sm text-slate-700">
                                            {formatAmount(
                                                transaction.price
                                            )}
                                        </td>

                                        <td className="px-5 py-3 text-right text-sm font-medium text-slate-900">
                                            {formatAmount(
                                                transaction.amount
                                            )}
                                        </td>

                                        <td className="px-5 py-3 text-right text-sm text-slate-600">
                                            {formatAmount(
                                                transaction.fees
                                            )}
                                        </td>

                                        <td className="px-5 py-3 text-right text-sm text-slate-600">
                                            {formatAmount(
                                                transaction.taxes
                                            )}
                                        </td>

                                        <td className="px-4 py-2 text-sm text-slate-500">
                                            {
                                                transaction.referenceNumber ||
                                                "â€”"
                                            }
                                        </td>

                                        <td className="px-4 py-2 text-right">
                                            <div className="flex flex-nowrap items-center justify-end gap-1.5">
                                                <EditInvestmentTransactionDialog
    transaction={transaction}
    trigger={
        <button
            type="button"
            title="Edit transaction"
            aria-label="Edit transaction"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50"
        >
            <Pencil className="h-3.5 w-3.5" />
        </button>
    }
    onSuccess={async () => {
        await onRefresh();
    }}
/>

                                                <DeleteInvestmentTransactionDialog
    transaction={transaction}
    trigger={
        <button
            type="button"
            title="Delete transaction"
            aria-label="Delete transaction"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-red-200 bg-white text-red-600 transition-colors hover:bg-red-50"
        >
            <Trash2 className="h-3.5 w-3.5" />
        </button>
    }
    onSuccess={async () => {
        await onRefresh();
    }}
/>
                                            </div>
                                        </td>
                                    </tr>
                                )
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function TransactionTypeBadge({
    type,
}: {
    type: string;
}) {
    return (
        <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
            {type}
        </span>
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
        <div className="flex min-h-[118px] flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-medium text-slate-500">
                {label}
            </div>

            <div
                className={`mt-auto pt-3 text-lg font-semibold tracking-tight ${valueClassName}`}
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

















































