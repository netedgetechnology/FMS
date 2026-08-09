import {
    Cell,
    Pie,
    PieChart,
    ResponsiveContainer,
} from "recharts";

import { Card } from "@/components/ui/card";

const data = [
    { value: 64, color: "#2563eb" },
    { value: 36, color: "#dbeafe" },
];

export function BudgetOverviewCard() {

    return (

        <Card className="rounded-2xl  bg-white p-5 shadow-sm">

            <div className="mb-6 flex items-center justify-between">

                <h2 className="text-xl font-bold">
                    Budget Overview
                </h2>

                <button className="text-sm font-semibold text-blue-600">
                    View all
                </button>

            </div>

            <div className="grid grid-cols-[170px_1fr] gap-5">

                <div className="relative h-44">

                    <ResponsiveContainer>

                        <PieChart>

                            <Pie
                                data={data}
                                innerRadius={48}
                                outerRadius={66}
                                stroke="none"
                                dataKey="value"
                            >

                                {data.map((entry, index) => (

                                    <Cell
                                        key={index}
                                        fill={entry.color}
                                    />

                                ))}

                            </Pie>

                        </PieChart>

                    </ResponsiveContainer>

                    <div className="absolute inset-0 flex flex-col items-center justify-center">

                        <div className="text-4xl font-bold">
                            64%
                        </div>

                        <div className="text-xs text-slate-500">
                            of total budget
                        </div>

                    </div>

                </div>

                <div className="space-y-5">

                    <div className="flex justify-between">
                        <span className="text-slate-500">Total Budget</span>
                        <span className="font-bold">₹1,20,000.00</span>
                    </div>

                    <div className="flex justify-between">
                        <span className="text-slate-500">Spent</span>
                        <span className="font-bold text-red-500">₹76,800.00</span>
                    </div>

                    <div className="flex justify-between">
                        <span className="text-slate-500">Remaining</span>
                        <span className="font-bold text-emerald-600">₹43,200.00</span>
                    </div>

                </div>

            </div>

        </Card>

    );

}
