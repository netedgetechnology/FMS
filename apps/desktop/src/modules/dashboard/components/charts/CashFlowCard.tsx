import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import { ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";

const data = [

    { day: "1 May", income: 600, expense: 300 },
    { day: "6 May", income: 1800, expense: 900 },
    { day: "11 May", income: 5600, expense: 1800 },
    { day: "16 May", income: 11800, expense: 6100 },
    { day: "21 May", income: 9600, expense: 5000 },
    { day: "26 May", income: 7800, expense: 3900 },
    { day: "31 May", income: 8200, expense: 4500 },

];

const currency = (value: number) => {

    if (value === 0) {
        return "₹0";
    }

    return `₹${value / 1000}k`;

};

export function CashFlowCard() {

    return (

        <Card
            className="rounded-[20px] bg-white p-6 shadow-sm"
        >

            <div
                className="flex items-start justify-between"
            >

                <div>

                    <h2
                        className="text-card-title text-slate-900"
                    >
                        Cash Flow Overview
                    </h2>

                    <div
                        className="mt-5 flex items-center gap-7"
                    >

                        <div
                            className="flex items-center gap-2"
                        >

                            <span
                                className="h-2.5 w-2.5 rounded-full bg-emerald-500"
                            />

                            <span
                                className="text-secondary text-slate-600"
                            >
                                Income
                            </span>

                        </div>

                        <div
                            className="flex items-center gap-2"
                        >

                            <span
                                className="h-2.5 w-2.5 rounded-full bg-red-500"
                            />

                            <span
                                className="text-secondary text-slate-600"
                            >
                                Expenses
                            </span>

                        </div>

                    </div>

                </div>

                <button
                    className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-5 text-body font-medium text-slate-700"
                >

                    This Month

                    <ChevronDown size={16} />

                </button>

            </div>

            <div
                className="mt-8 h-[215px]"
            >

                <ResponsiveContainer
                    width="100%"
                    height="100%"
                >

                    <AreaChart
                        data={data}
                        margin={{
                            top: 12,
                            left: -8,
                            right: 6,
                            bottom: 0,
                        }}
                    >

                        <defs>

                            <linearGradient
                                id="incomeFill"
                                x1="0"
                                y1="0"
                                x2="0"
                                y2="1"
                            >

                                <stop
                                    offset="0%"
                                    stopColor="#22C55E"
                                    stopOpacity={0.08}
                                />

                                <stop
                                    offset="100%"
                                    stopColor="#22C55E"
                                    stopOpacity={0}
                                />

                            </linearGradient>

                            <linearGradient
                                id="expenseFill"
                                x1="0"
                                y1="0"
                                x2="0"
                                y2="1"
                            >

                                <stop
                                    offset="0%"
                                    stopColor="#EF4444"
                                    stopOpacity={0.08}
                                />

                                <stop
                                    offset="100%"
                                    stopColor="#EF4444"
                                    stopOpacity={0}
                                />

                            </linearGradient>
                        </defs>

                        <CartesianGrid
                            stroke="#F1F5F9"
                            strokeDasharray="4 4"
                            vertical={false}
                        />

                        <XAxis
                            dataKey="day"
                            axisLine={false}
                            tickLine={false}
                            tickMargin={14}
                            tick={{
                                fill: "#94A3B8",
                                fontSize: 11,
                            }}
                        />

                        <YAxis
                            domain={[0, 15000]}
                            ticks={[0, 5000, 10000, 15000]}
                            axisLine={false}
                            tickLine={false}
                            tickMargin={12}
                            width={44}
                            tickFormatter={currency}
                            tick={{
                                fill: "#CBD5E1",
                                fontSize: 11,
                            }}
                        />

                        <Tooltip
                            cursor={{
                                stroke: "#E2E8F0",
                                strokeDasharray: "4 4",
                            }}
                            contentStyle={{
                                border: "1px solid #E2E8F0",
                                borderRadius: 12,
                                boxShadow: "0 12px 30px rgba(15,23,42,.08)",
                                background: "#FFFFFF",
                            }}
                        />

                        <Area
                            type="monotone"
                            dataKey="income"
                            stroke="#22C55E"
                            strokeWidth={2.5}
                            fill="url(#incomeFill)"
                            dot={false}
                            activeDot={{
                                r: 4,
                                stroke: "#22C55E",
                                strokeWidth: 2,
                                fill: "#FFFFFF",
                            }}
                        />

                        <Area
                            type="monotone"
                            dataKey="expense"
                            stroke="#EF4444"
                            strokeWidth={2.5}
                            fill="url(#expenseFill)"
                            dot={false}
                            activeDot={{
                                r: 4,
                                stroke: "#EF4444",
                                strokeWidth: 2,
                                fill: "#FFFFFF",
                            }}
                        />

                    </AreaChart>

                </ResponsiveContainer>

            </div>

        </Card>

    );

}





