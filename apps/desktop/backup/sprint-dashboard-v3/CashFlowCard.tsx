import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const data = [
    { month: "Jan", income: 8200, expense: 5200 },
    { month: "Feb", income: 9100, expense: 6100 },
    { month: "Mar", income: 8600, expense: 5800 },
    { month: "Apr", income: 10400, expense: 7100 },
    { month: "May", income: 11200, expense: 6500 },
    { month: "Jun", income: 12100, expense: 7200 },
];

export function CashFlowCard() {
    return (
        <Card className="rounded-[20px] border border-slate-200/80 bg-white p-5 shadow-[0_4px_20px_rgba(15,23,42,0.05)]">

            <div className="mb-7 flex items-center justify-between">

                <div>

                    <h2 className="text-2xl font-bold text-slate-900">
                        Cash Flow
                    </h2>

                    <p className="mt-1 text-sm text-slate-500">
                        Income vs Expenses
                    </p>

                </div>

                <Button
                    variant="outline"
                    className="rounded-xl"
                >
                    Monthly
                </Button>

            </div>

            <div className="h-[300px]">

                <ResponsiveContainer width="100%" height="100%">

                    <AreaChart data={data}>

                        <defs>

                            <linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#16A34A" stopOpacity={0.25} />
                                <stop offset="95%" stopColor="#16A34A" stopOpacity={0.03} />
                            </linearGradient>

                            <linearGradient id="expenseFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#EF4444" stopOpacity={0.18} />
                                <stop offset="95%" stopColor="#EF4444" stopOpacity={0.02} />
                            </linearGradient>

                        </defs>

                        <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="#E5E7EB"
                        />

                        <XAxis
                            dataKey="month"
                            tickLine={false}
                            axisLine={false}
                        />

                        <YAxis
                            tickLine={false}
                            axisLine={false}
                        />

                        <Tooltip />

                        <Area
                            type="monotone"
                            dataKey="income"
                            stroke="#16A34A"
                            strokeWidth={3}
                            fill="url(#incomeFill)"
                        />

                        <Area
                            type="monotone"
                            dataKey="expense"
                            stroke="#EF4444"
                            strokeWidth={3}
                            fill="url(#expenseFill)"
                        />

                    </AreaChart>

                </ResponsiveContainer>

            </div>

        </Card>
    );
}


