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
    return (
        <div className="min-h-full bg-slate-50">

            <div className="w-full space-y-5 px-0 py-0">

                <DashboardHeader />

                <section className="grid gap-6 grid-cols-1 md:grid-cols-2 xl:grid-cols-5 2xl:grid-cols-5">

                    <DashboardStatCard
                        title="Cash Balance"
                        value="₹54,320.00"
                        change="14.2%"
                        positive
                        icon={Wallet}
                        iconBackground="#EEF4FF"
                        iconColor="#2563EB"
                    />

                    <DashboardStatCard
                        title="Income"
                        value="₹82,150.00"
                        change="18.7%"
                        positive
                        icon={TrendingUp}
                        iconBackground="#ECFDF3"
                        iconColor="#16A34A"
                    />

                    <DashboardStatCard
                        title="Expenses"
                        value="₹27,830.00"
                        change="6.4%"
                        positive={false}
                        icon={TrendingDown}
                        iconBackground="#FEF2F2"
                        iconColor="#EF4444"
                    />

                    <DashboardStatCard
                        title="Net Worth"
                        value="₹2,45,680.00"
                        change="12.4%"
                        positive
                        icon={Landmark}
                        iconBackground="#F3E8FF"
                        iconColor="#7C3AED"
                    />

                    <DashboardStatCard
                        title="Savings Rate"
                        value="34.1%"
                        change="5.2%"
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









