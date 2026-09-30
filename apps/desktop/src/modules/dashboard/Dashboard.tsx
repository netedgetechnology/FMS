import {
    useEffect,
    useRef,
    useState,
} from "react";

import {
    Landmark,
    Percent,
    TrendingDown,
    TrendingUp,
    Wallet,
} from "lucide-react";

import { DashboardHeader } from "./components/widgets/DashboardHeader";
import { DashboardStatCard } from "./components/cards/DashboardStatCard";
import { CashFlowCard } from "./components/charts/CashFlowCard";
import { ExpenseBreakdownCard } from "./components/charts/ExpenseBreakdownCard";
import { RecentTransactionsCard } from "./components/tables/RecentTransactionsCard";
import { AccountsSummaryCard } from "./components/tables/AccountsSummaryCard";
import { BudgetOverviewCard } from "./components/widgets/BudgetOverviewCard";
import { GoalsProgressCard } from "./components/widgets/GoalsProgressCard";
import { UpcomingEMICard } from "./components/widgets/UpcomingEMICard";
import { InvestmentSummaryCard } from "./components/widgets/InvestmentSummaryCard";

import {
    DashboardService,
    DEFAULT_DASHBOARD_RANGE_SELECTION,
    formatBalanceAsOfLabel,
    resolveDashboardRangeSelection,
    type DashboardRangeSelection,
} from "./services";
import { useMoneyFormatter } from "@/core/formatting";
import { LatestRequestGuard } from "@/core/async/LatestRequestGuard";
import type { DashboardSummary } from "./types";



/**
 * Replaces the old single "Cash Balance" tile with two stacked values in
 * the same tile slot (no new tile is added to the stat-card grid):
 * Bank Balance (CURRENT + SAVINGS accounts) and Cash On Hand (CASH +
 * WALLET accounts) - see DashboardService's BANK_ACCOUNT_TYPES /
 * CASH_ON_HAND_ACCOUNT_TYPES for the exact classification.
 */
function BankAndCashOnHandCard({
    loading,
    bankBalance,
    cashOnHand,
    asOfLabel,
    formatMoney,
}: {
    loading: boolean;
    bankBalance: number;
    cashOnHand: number;
    /** "As of DD Mon YYYY" for a historical period; null for current figures. */
    asOfLabel: string | null;
    formatMoney: (value: number) => string;
}) {
    return (
        <div className="h-[156px] rounded-3xl bg-white px-5 py-5 shadow-[0_6px_24px_rgba(15,23,42,0.05)]">

            <div className="flex justify-between">

                <div>
                    <div className="text-caption font-medium text-slate-500">
                        Bank Balance
                    </div>

                    <div className="mt-2 text-card-value amount leading-none tracking-[-0.02em] text-[#0F172A]">
                        {loading ? "Loading..." : formatMoney(bankBalance)}
                    </div>

                    {asOfLabel && !loading && (
                        <div className="mt-1 text-small text-slate-400">
                            {asOfLabel}
                        </div>
                    )}
                </div>

                <div
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-sm"
                    style={{ backgroundColor: "#EEF4FF" }}
                >
                    <Wallet size={20} style={{ color: "#2563EB" }} />
                </div>

            </div>

            <div
                className={
                    asOfLabel && !loading
                        ? "mt-2 border-t border-slate-100 pt-2"
                        : "mt-4 border-t border-slate-100 pt-3"
                }
            >
                <div className="text-caption font-medium text-slate-500">
                    Cash On Hand
                </div>

                <div className="mt-2 text-card-value amount leading-none tracking-[-0.02em] text-[#0F172A]">
                    {loading ? "Loading..." : formatMoney(cashOnHand)}
                </div>
            </div>

        </div>
    );
}

function TopSpendingCategoriesCard({
    data,
    formatMoney,
}: {
    data: {
        name: string;
        amount: number;
        percentage: number;
    }[];
    formatMoney: (value: number) => string;
}) {
    return (
        <div className="h-full rounded-[20px] border border-slate-200/80 bg-white p-5 shadow-[0_4px_20px_rgba(15,23,42,0.05)]">

            <div className="mb-5">
                <h2 className="text-[20px] font-semibold text-slate-900">
                    Top Spending Categories
                </h2>

                <p className="mt-1 text-[14px] text-slate-500">
                    Where your money is going
                </p>
            </div>

            <div className="space-y-5">
                {data.length === 0 ? (
                    <div className="py-8 text-center text-sm text-slate-500">
                        No spending data available
                    </div>
                ) : (
                    data.map((item) => (
                        <div key={item.name}>
                            <div className="mb-2 flex items-center justify-between gap-3">
                                <span className="truncate text-[14px] font-medium text-slate-700">
                                    {item.name}
                                </span>

                                <span className="whitespace-nowrap text-[14px] font-semibold text-slate-900">
                                    {formatMoney(item.amount)}
                                </span>
                            </div>

                            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                                <div
                                    className="h-full rounded-full bg-blue-500"
                                    style={{
                                        width: `${Math.min(
                                            item.percentage,
                                            100
                                        )}%`,
                                    }}
                                />
                            </div>

                            <div className="mt-1 text-right text-[12px] text-slate-400">
                                {item.percentage}% of expenses
                            </div>
                        </div>
                    ))
                )}
            </div>

        </div>
    );
}

export default function Dashboard() {
    const formatMoney = useMoneyFormatter();

    const [rangeSelection, setRangeSelection] =
        useState<DashboardRangeSelection>(
            DEFAULT_DASHBOARD_RANGE_SELECTION
        );

    const [summary, setSummary] =
        useState<DashboardSummary | null>(
            null
        );

    const [loading, setLoading] =
        useState(true);

    const [error, setError] =
        useState<string | null>(null);

    // Guards against a slower, still in-flight load overwriting state
    // with stale data after a newer one (from quickly switching between
    // presets / Custom (previous days) / Custom Date Range) has already
    // resolved - see LatestRequestGuard.
    const requestGuard = useRef(new LatestRequestGuard());

    useEffect(() => {
        let mounted = true;
        const requestId = requestGuard.current.start();

        const loadDashboard =
            async () => {
                try {
                    setLoading(true);
                    setError(null);

                    const service =
                        new DashboardService();

                    const data =
                        await service.getSummary(
                            resolveDashboardRangeSelection(
                                rangeSelection
                            )
                        );

                    if (
                        mounted &&
                        !requestGuard.current.isStale(
                            requestId
                        )
                    ) {
                        setSummary(data);
                    }
                } catch (err) {
                    console.error(
                        "Failed to load dashboard:",
                        err
                    );

                    if (
                        mounted &&
                        !requestGuard.current.isStale(
                            requestId
                        )
                    ) {
                        setError(
                            err instanceof Error
                                ? err.message
                                : "Failed to load dashboard."
                        );
                    }
                } finally {
                    if (
                        mounted &&
                        !requestGuard.current.isStale(
                            requestId
                        )
                    ) {
                        setLoading(false);
                    }
                }
            };

        void loadDashboard();

        return () => {
            mounted = false;
        };
    }, [rangeSelection]);

    const dashboardSummary =
        summary ?? {
            bankBalance: 0,
            cashOnHand: 0,
            income: 0,
            expenses: 0,
            netWorth: 0,
            balanceAsOf: null,
            savingsRate: 0,
            cashFlow: [],
            expenseBreakdown: [],
            recentTransactions: [],
            accounts: [],
            topSpendingCategories: [],
            upcomingEMIs: [],
            budgetOverview: {
                currencyId: null,
                currencyCode: null,
                hasOtherCurrencies: false,
                totalBudget: 0,
                actualSpending: 0,
                remaining: 0,
                percentageUsed: 0,
                overBudget: false,
                unbudgetedSpending: 0,
                uncategorizedSpending: 0,
                categories: [],
            },
            goalsProgress: [],
            investmentSummary: {
                totalValue: 0,
                monthlyChangePercentage: null,
                allocation: [],
                currencyCode: null,
                hasOtherCurrencies: false,
            },
        };

    // "As of DD Mon YYYY" under Bank Balance and Net Worth for a period
    // ending in the past (see DashboardService.resolveBalanceAsOf).
    const balanceAsOfLabel = formatBalanceAsOfLabel(
        dashboardSummary.balanceAsOf
    );

    return (
        <div className="min-h-full bg-slate-50">

            <div className="w-full space-y-5 px-0 py-0">

                <DashboardHeader
                    selection={rangeSelection}
                    onSelectionChange={setRangeSelection}
                />

                {error && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
                        Unable to load dashboard data:{" "}
                        {error}
                    </div>
                )}

                <section className="grid gap-6 grid-cols-1 md:grid-cols-2 xl:grid-cols-5 2xl:grid-cols-5">

                    <BankAndCashOnHandCard
                        loading={loading}
                        bankBalance={dashboardSummary.bankBalance}
                        cashOnHand={dashboardSummary.cashOnHand}
                        asOfLabel={balanceAsOfLabel}
                        formatMoney={formatMoney}
                    />

                    <DashboardStatCard
                        title="Income"
                        value={
                            loading
                                ? "Loading..."
                                : formatMoney(dashboardSummary.income)
                        }
                        change={null}
                        positive
                        icon={TrendingUp}
                        iconBackground="#ECFDF3"
                        iconColor="#16A34A"
                    />

                    <DashboardStatCard
                        title="Expenses"
                        value={
                            loading
                                ? "Loading..."
                                : formatMoney(dashboardSummary.expenses)
                        }
                        change={null}
                        positive={false}
                        icon={TrendingDown}
                        iconBackground="#FEF2F2"
                        iconColor="#EF4444"
                    />

                    <DashboardStatCard
                        title="Net Worth"
                        value={
                            loading
                                ? "Loading..."
                                : formatMoney(dashboardSummary.netWorth)
                        }
                        caption={balanceAsOfLabel}
                        change={null}
                        positive
                        icon={Landmark}
                        iconBackground="#F3E8FF"
                        iconColor="#7C3AED"
                    />

                    <DashboardStatCard
                        title="Savings Rate"
                        value={
                            loading
                                ? "Loading..."
                                : `${dashboardSummary.savingsRate.toFixed(
                                      1
                                  )}%`
                        }
                        change={null}
                        positive
                        icon={Percent}
                        iconBackground="#FFF7ED"
                        iconColor="#EA580C"
                    />

                </section>

                <section className="grid gap-5 xl:grid-cols-12">

                    <div className="xl:col-span-5">
                        <CashFlowCard
                        data={dashboardSummary.cashFlow}
                    />
                    </div>

                    <div className="xl:col-span-4">
                        <ExpenseBreakdownCard
                        data={dashboardSummary.expenseBreakdown}
                    />
                    </div>

                    <div className="xl:col-span-3">
                        <RecentTransactionsCard
                        data={dashboardSummary.recentTransactions}
                    />
                    </div>

                </section>

                <section className="grid gap-5 xl:grid-cols-12">

                    <div className="xl:col-span-5">
                        <AccountsSummaryCard
                        data={dashboardSummary.accounts}
                    />
                    </div>

                    <div className="xl:col-span-3">
                        <TopSpendingCategoriesCard
                            data={dashboardSummary.topSpendingCategories}
                            formatMoney={formatMoney}
                        />
                    </div>

                    <div className="xl:col-span-4">
                        <UpcomingEMICard
                        data={dashboardSummary.upcomingEMIs}
                    />
                    </div>

                </section>

                <section className="grid gap-5 xl:grid-cols-12">

                    <div className="xl:col-span-4">
                        <BudgetOverviewCard
                        data={dashboardSummary.budgetOverview}
                    />
                    </div>

                    <div className="xl:col-span-5">
                        <GoalsProgressCard
                        data={dashboardSummary.goalsProgress}
                    />
                    </div>

                    <div className="xl:col-span-3">
                        <InvestmentSummaryCard
                        data={dashboardSummary.investmentSummary}
                    />
                    </div>

                </section>

            </div>

        </div>
    );
}





















