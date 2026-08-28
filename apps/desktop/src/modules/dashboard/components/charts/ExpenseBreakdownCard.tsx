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

interface ExpenseBreakdownCardProps {
    data: {
        name: string;
        value: number;
        color: string;
    }[];
}

export function ExpenseBreakdownCard({
    data,
}: ExpenseBreakdownCardProps) {

    const sortedData = data
        .slice()
        .sort((a, b) => b.value - a.value);

    const topCategories = sortedData.slice(0, 9);

    const othersValue = sortedData
        .slice(9)
        .reduce(
            (sum, item) => sum + item.value,
            0,
        );

    const displayData = [
        ...topCategories,
        ...(othersValue > 0
            ? [
                  {
                      name: "Others",
                      value: othersValue,
                      color: "#2563EB",
                  },
              ]
            : []),
    ];

    const total = displayData.reduce(
        (sum, item) => sum + item.value,
        0,
    );

    return (
        <Card
            className="rounded-[20px] border border-slate-200/80 bg-white p-4 shadow-[0_4px_20px_rgba(15,23,42,0.05)]"
        >

            <div className="flex items-start justify-between">

                <div>
                    <h2 className="text-[20px] font-semibold text-slate-900">
                        Expense Breakdown
                    </h2>
                </div>

                <button
                    className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700"
                >
                    This Month
                    <ChevronDown size={16} />
                </button>

            </div>

            <div className="mt-4 grid grid-cols-[150px_1fr] items-center gap-3">

                <div className="relative h-[150px] w-[150px]">

                    <ResponsiveContainer
                        width="100%"
                        height="100%"
                    >

                        <PieChart>

                            <Pie
                                data={displayData}
                                dataKey="value"
                                innerRadius={43}
                                outerRadius={64}
                                stroke="white"
                                strokeWidth={4}
                            >

                                {displayData.map((item) => (
                                    <Cell
                                        key={item.name}
                                        fill={item.color}
                                    />
                                ))}

                            </Pie>

                        </PieChart>

                    </ResponsiveContainer>

                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">

                        <span className="text-[11px] font-medium text-slate-500">
                            Total
                        </span>

                        <span className="mt-0.5 max-w-[112px] whitespace-nowrap text-[14px] font-bold leading-tight text-slate-900">
                            ₹{total.toLocaleString("en-IN")}
                        </span>

                    </div>

                </div>

                <div className="flex min-w-0 flex-col justify-center space-y-1.5">

                    {displayData.map((item) => {

                        const percent =
                            total > 0
                                ? Math.round(
                                      (item.value / total) * 100,
                                  )
                                : 0;

                        return (
                            <div
                                key={item.name}
                                className="grid grid-cols-[8px_minmax(0,1fr)_34px_62px] items-center gap-2"
                            >

                                <span
                                    className="h-2.5 w-2.5 rounded-full"
                                    style={{
                                        background: item.color,
                                    }}
                                />

                                <span className="truncate text-[13px] font-medium text-slate-700">
                                    {item.name}
                                </span>

                                <span className="text-right text-[13px] text-slate-500">
                                    {percent}%
                                </span>

                                <span className="whitespace-nowrap text-right text-[13px] font-semibold text-slate-900">
                                    ₹{item.value.toLocaleString("en-IN")}
                                </span>

                            </div>
                        );

                    })}

                </div>

            </div>

        </Card>
    );
}
