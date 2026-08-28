import {
    Cell,
    Pie,
    PieChart,
    ResponsiveContainer,
} from "recharts";

import { Card } from "@/components/ui/card";

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

function formatCurrency(value: number) {
    return `₹${value.toLocaleString("en-IN", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    })}`;
}

export function InvestmentSummaryCard({
    data,
}: InvestmentSummaryCardProps) {
    const portfolio = data.allocation.map(
        (item, index) => ({
            ...item,
            color:
                allocationColors[
                    index % allocationColors.length
                ],
        })
    );

    return (
        <Card className="rounded-[20px] border border-slate-200/80 bg-white p-5 shadow-[0_4px_20px_rgba(15,23,42,0.05)]">

            <div className="mb-6 flex items-center justify-between">

                <div>

                    <h2 className="text-xl font-bold">
                        Investment Summary
                    </h2>

                    <p className="text-sm text-slate-500">
                        Portfolio Allocation
                    </p>

                </div>

                <button className="text-sm font-semibold text-blue-600">
                    View all
                </button>

            </div>

            <div className="grid grid-cols-[220px_1fr] items-center gap-5">

                <div className="relative h-56">

                    <ResponsiveContainer>

                        <PieChart>

                            <Pie
                                data={portfolio}
                                dataKey="value"
                                innerRadius={58}
                                outerRadius={86}
                                stroke="none"
                                paddingAngle={3}
                            >
                                {portfolio.map((item) => (
                                    <Cell
                                        key={item.name}
                                        fill={item.color}
                                    />
                                ))}
                            </Pie>

                        </PieChart>

                    </ResponsiveContainer>

                    <div className="absolute inset-0 flex flex-col items-center justify-center">

                        <div className="text-3xl font-bold text-slate-900">
                            {formatCurrency(data.totalValue)}
                        </div>

                        <div
                            className={`mt-1 text-xs ${
                                data.monthlyChangePercentage >= 0
                                    ? "text-emerald-600"
                                    : "text-red-500"
                            }`}
                        >
                            {data.monthlyChangePercentage >= 0
                                ? "+"
                                : ""}
                            {data.monthlyChangePercentage.toFixed(1)}%
                            {" "}this month
                        </div>

                    </div>

                </div>

                <div className="space-y-5">

                    {portfolio.length === 0 ? (
                        <div className="py-8 text-center text-sm text-slate-500">
                            No investment data available
                        </div>
                    ) : (
                        portfolio.map((item) => (

                            <div
                                key={item.name}
                                className="flex items-center justify-between"
                            >

                                <div className="flex items-center gap-3">

                                    <span
                                        className="h-3 w-3 rounded-full"
                                        style={{
                                            backgroundColor:
                                                item.color,
                                        }}
                                    />

                                    <div>

                                        <div className="font-semibold">
                                            {item.name}
                                        </div>

                                        <div className="text-sm text-slate-500">
                                            {item.value}%
                                        </div>

                                    </div>

                                </div>

                                <div className="text-right">

                                    <div className="font-bold">
                                        {formatCurrency(item.amount)}
                                    </div>

                                </div>

                            </div>

                        ))
                    )}

                </div>

            </div>

        </Card>
    );
}
