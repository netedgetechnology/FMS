import {
    Cell,
    Pie,
    PieChart,
    ResponsiveContainer,
} from "recharts";

import {
    ChevronDown,
} from "lucide-react";

import { Card } from "@/components/ui/card";

const data = [

    {
        name: "Housing",
        value: 10560,
        color: "#2F66E8",
    },

    {
        name: "Food",
        value: 5566,
        color: "#22C55E",
    },

    {
        name: "Transportation",
        value: 3340,
        color: "#F59E0B",
    },

    {
        name: "Utilities",
        value: 2228,
        color: "#8B5CF6",
    },

    {
        name: "Entertainment",
        value: 1949,
        color: "#EF4444",
    },

    {
        name: "Others",
        value: 4187,
        color: "#60A5FA",
    },

];

const total = data.reduce(
    (sum, item) => sum + item.value,
    0,
);

export function ExpenseBreakdownCard() {

    return (

        <Card
            className="rounded-[20px] bg-white p-6 shadow-sm"
        >

            <div
                className="flex items-start justify-between"
            >

                <div>

                    <h2
                        className="text-[20px] font-semibold text-slate-900"
                    >
                        Expense Breakdown
                    </h2>

                </div>

                <button
                    className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700"
                >

                    This Month

                    <ChevronDown size={16} />

                </button>

            </div>

            <div
                className="mt-5 grid grid-cols-[175px_1fr] items-center gap-2"
            >

                <div
                    className="relative h-[175px] w-[175px]"
                >

                    <ResponsiveContainer
                        width="100%"
                        height="100%"
                    >

                        <PieChart>

                            <Pie
                                data={data}
                                dataKey="value"
                                innerRadius={48}
                                outerRadius={70}
                                stroke="white"
                                strokeWidth={4}
                            >

                                {
                                    data.map((item) => (

                                        <Cell
                                            key={item.name}
                                            fill={item.color}
                                        />

                                    ))
                                }

                            </Pie>

                        </PieChart>

                    </ResponsiveContainer>

                    <div
                        className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
                    >

                        <span
                            className="text-[11px] font-medium text-slate-500"
                        >
                            Total
                        </span>

                        <span
                            className="mt-1 text-[18px] font-bold text-slate-900"
                        >
                            ₹27,830
                        </span>

                    </div>

                </div>

                <div
                    className="flex flex-1 flex-col justify-center space-y-2 pl-0"
                >

                    {
                        data.map((item) => {

                            const percent = Math.round(
                                (item.value / total) * 100
                            );

                            return (

                                <div
                                    key={item.name}
                                    className="grid grid-cols-[10px_1fr_36px_64px] items-center gap-2"
                                >

                                    <span
                                        className="h-3 w-3 rounded-full"
                                        style={{
                                            background: item.color,
                                        }}
                                    />

                                    <span
                                        className="truncate text-[13px] font-medium text-slate-700"
                                    >
                                        {item.name}
                                    </span>

                                    <span
                                        className="text-right text-[13px] text-slate-500"
                                    >
                                        {percent}%
                                    </span>

                                    <span
                                        className="text-right text-[13px] font-semibold text-slate-900"
                                    >
                                        ₹{item.value.toLocaleString()}
                                    </span>

                                </div>

                            );

                        })
                    }

                </div>

            </div>

        </Card>

    );

}







