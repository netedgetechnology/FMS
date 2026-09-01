import { useMoneyFormatter } from "@/core/formatting";

import {
    Cell,
    Pie,
    PieChart,
    ResponsiveContainer,
} from "recharts";



import { Card } from "@/components/ui/card";

import { CardViewAllLink } from "../common/CardViewAllLink";

interface BudgetOverviewCardProps {
    data: {
        totalBudget: number;
        spent: number;
        remaining: number;
        percentage: number;
    };
}



export function BudgetOverviewCard({
    data,
}: BudgetOverviewCardProps) {
    const formatMoney = useMoneyFormatter();

    const percentage = Math.min(
        Math.max(data.percentage, 0),
        100
    );

    const chartData = [
        {
            value: percentage,
            color: "#2563eb",
        },
        {
            value: 100 - percentage,
            color: "#dbeafe",
        },
    ];

    return (
        <Card className="h-full rounded-[20px] border border-slate-200/80 bg-white p-5 shadow-[0_4px_20px_rgba(15,23,42,0.05)]">

            <div className="mb-6 flex items-center justify-between">

                <h2 className="text-card-title">
                    Budget Overview
                </h2>

                <CardViewAllLink to="/budgets" />

            </div>

            <div className="grid grid-cols-[170px_1fr] gap-5">

                <div className="relative h-44">

                    <ResponsiveContainer>

                        <PieChart>

                            <Pie
                                data={chartData}
                                innerRadius={48}
                                outerRadius={66}
                                stroke="none"
                                dataKey="value"
                            >
                                {chartData.map((entry, index) => (
                                    <Cell
                                        key={index}
                                        fill={entry.color}
                                    />
                                ))}
                            </Pie>

                        </PieChart>

                    </ResponsiveContainer>

                    <div className="absolute inset-0 flex flex-col items-center justify-center">

                        <div className="text-card-value percent">
                            {percentage}%
                        </div>

                        <div className="text-small text-slate-500">
                            of total budget
                        </div>

                    </div>

                </div>

                <div className="space-y-5">

                    <div className="flex justify-between">
                        <span className="text-secondary text-slate-500">
                            Total Budget
                        </span>

                        <span className="text-body amount font-semibold">
                            {formatMoney(data.totalBudget)}
                        </span>
                    </div>

                    <div className="flex justify-between">
                        <span className="text-secondary text-slate-500">
                            Spent
                        </span>

                        <span className="text-body amount font-semibold text-red-500">
                            {formatMoney(data.spent)}
                        </span>
                    </div>

                    <div className="flex justify-between">
                        <span className="text-secondary text-slate-500">
                            Remaining
                        </span>

                        <span className="text-body amount font-semibold text-emerald-600">
                            {formatMoney(data.remaining)}
                        </span>
                    </div>

                </div>

            </div>

        </Card>
    );
}


