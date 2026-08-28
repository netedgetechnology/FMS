import {
    Car,
    ChevronRight,
    CreditCard,
    Home,
} from "lucide-react";

import { Card } from "@/components/ui/card";

interface EMI {
    id: string;
    type: "home" | "car" | "card" | "other";
    title: string;
    lender: string;
    amount: number;
    dueDate: string;
    dueIn: number;
    progress: number;
}

interface UpcomingEMICardProps {
    data: EMI[];
}

function getIcon(type: EMI["type"]) {
    switch (type) {
        case "home":
            return Home;

        case "car":
            return Car;

        default:
            return CreditCard;
    }
}

function getBadge(days: number) {
    if (days <= 5) {
        return {
            bg: "bg-red-50",
            text: "text-red-600",
        };
    }

    if (days <= 10) {
        return {
            bg: "bg-orange-50",
            text: "text-orange-600",
        };
    }

    return {
        bg: "bg-blue-50",
        text: "text-blue-600",
    };
}

function formatCurrency(value: number) {
    return `₹${value.toLocaleString("en-IN")}`;
}

function EMIRow({
    emi,
}: {
    emi: EMI;
}) {
    const Icon = getIcon(emi.type);
    const badge = getBadge(emi.dueIn);

    return (
        <div className="border-b border-slate-100 py-3 last:border-b-0">
            <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100">
                        <Icon
                            size={20}
                            className="text-slate-700"
                        />
                    </div>

                    <div>
                        <h3 className="text-body font-semibold text-slate-900">
                            {emi.title}
                        </h3>

                        <p className="mt-0.5 text-small text-slate-500">
                            {emi.lender}
                        </p>

                        <div className="text-body amount mt-1 font-semibold text-slate-900">
                            {formatCurrency(emi.amount)}
                        </div>
                    </div>
                </div>

                <div className="flex flex-col items-end">
                    <span
                        className={`rounded-full px-3 py-1 text-small font-medium ${badge.bg} ${badge.text}`}
                    >
                        Due in {emi.dueIn}d
                    </span>

                    <span className="mt-2 text-small text-slate-500">
                        {emi.dueDate}
                    </span>
                </div>
            </div>

            <div className="mt-2">
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                        className="h-full rounded-full bg-blue-600"
                        style={{
                            width: `${Math.min(
                                Math.max(emi.progress, 0),
                                100
                            )}%`,
                        }}
                    />
                </div>

                <div className="mt-2 flex justify-end text-small text-slate-400">
                    {30 - emi.dueIn} / 30 Days
                </div>
            </div>
        </div>
    );
}

export function UpcomingEMICard({
    data,
}: UpcomingEMICardProps) {
    const total = data.reduce(
        (sum, emi) => sum + emi.amount,
        0
    );

    const visibleEMIs = data.slice(0, 2);
    const remainingCount = Math.max(
        data.length - visibleEMIs.length,
        0
    );

    return (
        <Card className="rounded-[20px] border border-slate-200/80 bg-white p-3 shadow-[0_4px_20px_rgba(15,23,42,0.05)]">
            <div className="mb-4 flex items-start justify-between">
                <div>
                    <h2 className="text-card-title text-slate-900">
                        Upcoming EMIs
                    </h2>

                    <p className="mt-1 text-secondary text-slate-500">
                        {data.length}{" "}
                        {data.length === 1 ? "EMI" : "EMIs"} due this month
                        {" • "}
                        {formatCurrency(total)}
                    </p>
                </div>

                <button className="text-body font-medium text-blue-600 hover:text-blue-700">
                    View All
                </button>
            </div>

            <div>
                {visibleEMIs.length === 0 ? (
                    <div className="py-8 text-center text-sm text-slate-500">
                        No upcoming EMIs
                    </div>
                ) : (
                    visibleEMIs.map((emi) => (
                        <EMIRow
                            key={emi.id}
                            emi={emi}
                        />
                    ))
                )}
            </div>

            {remainingCount > 0 && (
                <div className="mt-2 border-t border-slate-100 pt-2">
                    <button className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-50 py-2 text-body font-medium text-slate-700 transition hover:bg-slate-100">
                        <span>
                            View Remaining {remainingCount}{" "}
                            {remainingCount === 1 ? "EMI" : "EMIs"}
                        </span>

                        <ChevronRight size={18} />
                    </button>
                </div>
            )}
        </Card>
    );
}
