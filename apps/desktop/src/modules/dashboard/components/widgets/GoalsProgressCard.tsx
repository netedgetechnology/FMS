import { useMoneyFormatter } from "@/core/formatting";

import { Card } from "@/components/ui/card";

import { CardViewAllLink } from "../common/CardViewAllLink";

interface Goal {
    id: string;
    name: string;
    current: number;
    target: number;
    percentage: number;
}

interface GoalsProgressCardProps {
    data: Goal[];
}



function getProgressColor(index: number) {
    const colors = [
        "bg-emerald-500",
        "bg-blue-500",
        "bg-orange-500",
        "bg-violet-500",
    ];

    return colors[index % colors.length];
}

export function GoalsProgressCard({
    data,
}: GoalsProgressCardProps) {
    const formatMoney = useMoneyFormatter();
    return (
        <Card className="h-full rounded-[20px] border border-slate-200/80 bg-white p-5 shadow-[0_4px_20px_rgba(15,23,42,0.05)]">

            <div className="mb-6 flex items-center justify-between">

                <h2 className="text-xl font-bold">
                    Goals Progress
                </h2>

                <CardViewAllLink to="/financial-goals" />

            </div>

            <div className="space-y-8">

                {data.length === 0 ? (
                    <div className="py-8 text-center text-sm text-slate-500">
                        No goals available
                    </div>
                ) : (
                    data.map((goal, index) => {
                        const percentage = Math.min(
                            Math.max(goal.percentage, 0),
                            100
                        );

                        return (
                            <div key={goal.id}>

                                <div className="mb-2 flex items-center justify-between">

                                    <span className="truncate font-semibold text-slate-900">
                                        {goal.name}
                                    </span>

                                    <span className="ml-3 whitespace-nowrap text-slate-500">
                                        {percentage.toFixed(1)}%
                                    </span>

                                </div>

                                <div className="h-3 overflow-hidden rounded-full bg-slate-200">

                                    <div
                                        className={`h-full rounded-full ${getProgressColor(index)}`}
                                        style={{
                                            width: `${percentage.toFixed(1)}%`,
                                        }}
                                    />

                                </div>

                                <div className="mt-2 flex justify-between text-slate-500">

                                    <span>
                                        {formatMoney(goal.current)}
                                    </span>

                                    <span>
                                        {formatMoney(goal.target)}
                                    </span>

                                </div>

                            </div>
                        );
                    })
                )}

            </div>

        </Card>
    );
}








