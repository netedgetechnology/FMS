import {
    Cell,
    Pie,
    PieChart,
    ResponsiveContainer,
} from "recharts";

import { Card } from "@/components/ui/card";

const portfolio = [
    {
        name: "Mutual Funds",
        value: 45,
        amount: "₹84,000",
        color: "#2563EB",
    },
    {
        name: "Stocks",
        value: 30,
        amount: "₹56,000",
        color: "#8B5CF6",
    },
    {
        name: "PPF",
        value: 15,
        amount: "₹28,000",
        color: "#10B981",
    },
    {
        name: "Gold",
        value: 10,
        amount: "₹18,750",
        color: "#F59E0B",
    },
];

export function InvestmentSummaryCard() {

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
                            ₹1.87L
                        </div>

                        <div className="mt-1 text-xs text-emerald-600">
                            +11.3% this month
                        </div>

                    </div>

                </div>

                <div className="space-y-5">

                    {portfolio.map((item) => (

                        <div
                            key={item.name}
                            className="flex items-center justify-between"
                        >

                            <div className="flex items-center gap-3">

                                <span
                                    className="h-3 w-3 rounded-full"
                                    style={{
                                        backgroundColor: item.color,
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
                                    {item.amount}
                                </div>

                            </div>

                        </div>

                    ))}

                </div>

            </div>

        </Card>

    );

}

