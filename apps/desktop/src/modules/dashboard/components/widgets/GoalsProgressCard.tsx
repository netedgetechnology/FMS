import { Card } from "@/components/ui/card";

const goals = [
    {
        name: "Emergency Fund",
        current: "₹68,000",
        target: "₹1,00,000",
        percent: 68,
        color: "bg-emerald-500",
    },
    {
        name: "Europe Trip",
        current: "₹42,000",
        target: "₹1,00,000",
        percent: 42,
        color: "bg-blue-500",
    },
    {
        name: "New Laptop",
        current: "₹45,000",
        target: "₹60,000",
        percent: 75,
        color: "bg-orange-500",
    },
];

export function GoalsProgressCard() {

    return (

        <Card className="rounded-[20px] border border-slate-200/80 bg-white p-5 shadow-[0_4px_20px_rgba(15,23,42,0.05)]">

            <div className="mb-6 flex items-center justify-between">

                <h2 className="text-xl font-bold">
                    Goals Progress
                </h2>

                <button className="text-sm font-semibold text-blue-600">
                    View all
                </button>

            </div>

            <div className="space-y-8">

                {goals.map((goal) => (

                    <div key={goal.name}>

                        <div className="mb-2 flex items-center justify-between">

                            <span className="font-semibold">
                                {goal.name}
                            </span>

                            <span className="text-slate-500">
                                {goal.percent}%
                            </span>

                        </div>

                        <div className="h-3 overflow-hidden rounded-full bg-slate-200">

                            <div
                                className={`h-full rounded-full ${goal.color}`}
                                style={{
                                    width: `${goal.percent}%`,
                                }}
                            />

                        </div>

                        <div className="mt-2 flex justify-between text-slate-500">

                            <span>{goal.current}</span>

                            <span>{goal.target}</span>

                        </div>

                    </div>

                ))}

            </div>

        </Card>

    );

}

