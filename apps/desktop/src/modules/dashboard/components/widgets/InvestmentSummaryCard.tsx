import { useMoneyFormatter } from "@/core/formatting";

import {
    Pie,
    PieChart,
    ResponsiveContainer,
} from "recharts";



import { Card } from "@/components/ui/card";

import { CardViewAllLink } from "../common/CardViewAllLink";

interface InvestmentSummaryCardProps {
    data: {
        totalValue: number;
        monthlyChangePercentage: number;
        allocation: {
            name: string;
            value: number;
            amount: number;
        }[];
    };
}

const allocationColors = [
    "#2563EB",
    "#8B5CF6",
    "#10B981",
    "#F59E0B",
    "#EF4444",
    "#06B6D4",
];



export function InvestmentSummaryCard({
    data,
}: InvestmentSummaryCardProps) {
    const formatMoney = useMoneyFormatter();

    const portfolio = data.allocation.map(
        (item, index) => ({
            ...item,
            fill:
                allocationColors[
                    index % allocationColors.length
                ],
        })
    );

    const changePositive = data.monthlyChangePercentage >= 0;

    return (
        <Card className="h-full rounded-[20px] border border-slate-200/80 bg-white p-5 shadow-[0_4px_20px_rgba(15,23,42,0.05)]">

            <div className="mb-6 flex items-center justify-between">

                <div>

                    <h2 className="text-xl font-bold">
                        Investment Summary
                    </h2>

                    <p className="text-sm text-slate-500">
                        Portfolio Allocation
                    </p>

                </div>

                <CardViewAllLink to="/investments" />

            </div>

            <div className="flex flex-col items-center gap-5">

                <div className="flex flex-col items-center">

                    <div className="relative aspect-square w-[168px]">

                        <ResponsiveContainer>

                            <PieChart>

                                <Pie
                                    data={portfolio}
                                    dataKey="value"
                                    nameKey="name"
                                    innerRadius="62%"
                                    outerRadius="90%"
                                    stroke="none"
                                    paddingAngle={3}
                                    isAnimationActive={false}
                                />

                            </PieChart>

                        </ResponsiveContainer>

                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">

                            <span className="max-w-[62%] text-center text-[12px] font-bold leading-tight text-slate-900 tabular-nums break-words">
                                {formatMoney(data.totalValue)}
                            </span>

                        </div>

                    </div>

                    <div
                        className={`mt-2 whitespace-nowrap text-[11px] font-medium ${
                            changePositive
                                ? "text-emerald-600"
                                : "text-red-500"
                        }`}
                    >
                        {changePositive ? "+" : ""}
                        {data.monthlyChangePercentage.toFixed(1)}% this month
                    </div>

                </div>

                <div className="w-full space-y-4">

                    {portfolio.length === 0 ? (
                        <div className="py-8 text-center text-sm text-slate-500">
                            No investment data available
                        </div>
                    ) : (
                        portfolio.map((item, index) => (

                            <div
                                key={`${item.name}-${index}`}
                                className="flex items-center gap-3"
                            >

                                <span
                                    className="h-3 w-3 shrink-0 rounded-full"
                                    style={{
                                        backgroundColor: item.fill,
                                    }}
                                />

                                <div className="min-w-0 flex-1">

                                    <div className="truncate font-semibold">
                                        {item.name}
                                    </div>

                                    <div className="text-sm text-slate-500">
                                        {item.value}%
                                    </div>

                                </div>

                                <div className="shrink-0 text-right font-bold tabular-nums">
                                    {formatMoney(item.amount)}
                                </div>

                            </div>

                        ))
                    )}

                </div>

            </div>

        </Card>
    );
}


