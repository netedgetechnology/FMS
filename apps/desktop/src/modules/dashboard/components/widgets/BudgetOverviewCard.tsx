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

        <Card className="rounded-[20px] border border-slate-200/80 bg-white p-5 shadow-[0_4px_20px_rgba(15,23,42,0.05)]">

            <div className="mb-6 flex items-center justify-between">

                <h2 className="text-card-title">
                    Budget Overview
                </h2>

                <button className="text-body font-medium text-blue-600">
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

                        <div className="text-card-value percent">
                            64%
                        </div>

                        <div className="text-small text-slate-500">
                            of total budget
                        </div>

                    </div>

                </div>

                <div className="space-y-5">

                    <div className="flex justify-between">
                        <span className="text-secondary text-slate-500">Total Budget</span>
                        <span className="text-body amount font-semibold">₹1,20,000.00</span>
                    </div>

                    <div className="flex justify-between">
                        <span className="text-secondary text-slate-500">Spent</span>
                        <span className="text-body amount font-semibold text-red-500">₹76,800.00</span>
                    </div>

                    <div className="flex justify-between">
                        <span className="text-secondary text-slate-500">Remaining</span>
                        <span className="text-body amount font-semibold text-emerald-600">₹43,200.00</span>
                    </div>

                </div>

            </div>

        </Card>

    );

}


