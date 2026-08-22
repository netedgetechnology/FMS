import {
    useEffect,
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

import { DashboardService } from "./services";
import type { DashboardSummary } from "./types";

function formatCurrency(
    value: number
): string {
    return new Intl.NumberFormat(
        "en-IN",
        {
            style: "currency",
            currency: "INR",
            maximumFractionDigits: 2,
        }
    ).format(value);
}

function TopSpendingCategoriesCard() {
    return (
        <div className="rounded-[20px] border border-slate-200/80 bg-white p-5 shadow-[0_4px_20px_rgba(15,23,42,0.05)]">
            <h2 className="text-xl font-bold">
                Top Spending Categories
            </h2>

            <p className="mt-1 text-sm text-slate-500">
                Coming in next sprint
            </p>
        </div>
    );
}

export default function Dashboard() {
    const [summary, setSummary] =
        useState<DashboardSummary | null>(
            null
        );

    const [loading, setLoading] =
        useState(true);

    const [error, setError] =
        useState<string | null>(null);

    useEffect(() => {
        let mounted = true;

        const loadDashboard =
            async () => {
                try {
                    setLoading(true);
                    setError(null);

                    const service =
                        new DashboardService();

                    const data =
                        await service.getSummary();

                    if (mounted) {
                        setSummary(data);
                    }
                } catch (err) {
                    console.error(
                        "Failed to load dashboard:",
                        err
                    );

                    if (mounted) {
                        setError(
                            err instanceof Error
                                ? err.message
                                : "Failed to load dashboard."
                        );
                    }
                } finally {
                    if (mounted) {
                        setLoading(false);
                    }
                }
            };

        void loadDashboard();

        return () => {
            mounted = false;
        };
    }, []);

    const dashboardSummary =
        summary ?? {
            cashBalance: 0,
            income: 0,
            expenses: 0,
            netWorth: 0,
            savingsRate: 0,
        };

    return (
        <div className="min-h-full bg-slate-50">

            <div className="w-full space-y-5 px-0 py-0">

                <DashboardHeader />

                {error && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
                        Unable to load dashboard data:{" "}
                        {error}
                    </div>
                )}

                <section className="grid gap-6 grid-cols-1 md:grid-cols-2 xl:grid-cols-5 2xl:grid-cols-5">

                    <DashboardStatCard
                        title="Cash Balance"
                        value={
                            loading
                                ? "Loading..."
                                : formatCurrency(
                                      dashboardSummary.cashBalance
                                  )
                        }
                        change={null}
                        positive
                        icon={Wallet}
                        iconBackground="#EEF4FF"
                        iconColor="#2563EB"
                    />

                    <DashboardStatCard
                        title="Income"
                        value={
                            loading
                                ? "Loading..."
                                : formatCurrency(
                                      dashboardSummary.income
                                  )
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
                                : formatCurrency(
                                      dashboardSummary.expenses
                                  )
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
                                : formatCurrency(
                                      dashboardSummary.netWorth
                                  )
                        }
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
                        <CashFlowCard />
                    </div>

                    <div className="xl:col-span-4">
                        <ExpenseBreakdownCard />
                    </div>

                    <div className="xl:col-span-3">
                        <RecentTransactionsCard />
                    </div>

                </section>

                <section className="grid gap-5 xl:grid-cols-12">

                    <div className="xl:col-span-5">
                        <AccountsSummaryCard />
                    </div>

                    <div className="xl:col-span-3">
                        <TopSpendingCategoriesCard />
                    </div>

                    <div className="xl:col-span-4">
                        <UpcomingEMICard />
                    </div>

                </section>

                <section className="grid gap-5 xl:grid-cols-12">

                    <div className="xl:col-span-4">
                        <BudgetOverviewCard />
                    </div>

                    <div className="xl:col-span-3">
                        <GoalsProgressCard />
                    </div>

                    <div className="xl:col-span-4">
                        <InvestmentSummaryCard />
                    </div>

                </section>

            </div>

        </div>
    );
}
