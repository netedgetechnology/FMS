import {
    Cell,
    Pie,
    PieChart,
    ResponsiveContainer,
} from "recharts";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const data = [
    { name: "Housing", value: 35, amount: "₹10,560", color: "#2563EB" },
    { name: "Food", value: 22, amount: "₹5,566", color: "#16A34A" },
    { name: "Transport", value: 15, amount: "₹3,340", color: "#F59E0B" },
    { name: "Utilities", value: 10, amount: "₹2,228", color: "#8B5CF6" },
    { name: "Shopping", value: 18, amount: "₹4,187", color: "#EF4444" },
];

export function ExpenseBreakdownCard() {
    return (
        <Card className="rounded-2xl  bg-white p-5 shadow-sm">

            <div className="mb-7 flex items-center justify-between">

                <div>

                    <h2 className="text-2xl font-bold text-slate-900">
                        Expense Breakdown
                    </h2>

                    <p className="mt-1 text-sm text-slate-500">
                        Spending by category
                    </p>

                </div>

                <Button
                    variant="outline"
                    className="rounded-xl"
                >
                    This Month
                </Button>

            </div>

            <div className="grid grid-cols-[260px_1fr] items-center gap-5">

                <div className="h-64">

                    <ResponsiveContainer width="100%" height="100%">

                        <PieChart>

                            <Pie
                                data={data}
                                dataKey="value"
                                innerRadius={58}
                                outerRadius={90}
                                paddingAngle={3}
                            >

                                {data.map((item) => (
                                    <Cell
                                        key={item.name}
                                        fill={item.color}
                                    />
                                ))}

                            </Pie>

                        </PieChart>

                    </ResponsiveContainer>

                </div>

                <div className="space-y-4">

                    {data.map((item) => (

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

                                <span className="text-sm font-medium text-slate-700">
                                    {item.name}
                                </span>

                            </div>

                            <div className="text-right">

                                <div className="font-semibold">
                                    {item.value}%
                                </div>

                                <div className="text-xs text-slate-500">
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

