import { useDateFormatter } from "@/core/formatting";
import {
    ShoppingBag,
    UtensilsCrossed,
    Zap,
    ArrowUpRight,
} from "lucide-react";

import { Card } from "@/components/ui/card";

import { CardViewAllLink } from "../common/CardViewAllLink";

interface RecentTransactionsCardProps {
    data: {
        id: string;
        title: string;
        category: string;
        amount: number;
        type: "income" | "expense";
        date: string;
    }[];
}

function getIcon(category: string, type: "income" | "expense") {
    if (type === "income") {
        return ArrowUpRight;
    }

    const value = category.toLowerCase();

    if (
        value.includes("food") ||
        value.includes("dining") ||
        value.includes("restaurant")
    ) {
        return UtensilsCrossed;
    }

    if (
        value.includes("utility") ||
        value.includes("electric") ||
        value.includes("bill")
    ) {
        return Zap;
    }

    return ShoppingBag;
}

export function RecentTransactionsCard({
    data,
}: RecentTransactionsCardProps) {
    const formatDate = useDateFormatter();
    return (
        <Card className="h-full rounded-[20px] border border-slate-200/80 bg-white p-4 shadow-[0_4px_20px_rgba(15,23,42,0.05)]">

            <div className="mb-4 flex items-start justify-between">

                <div>
                    <h2 className="text-[20px] font-semibold text-slate-900">
                        Recent Transactions
                    </h2>

                    <p className="mt-1 text-[14px] text-slate-500">
                        Latest account activity
                    </p>
                </div>

                <CardViewAllLink to="/transactions" />

            </div>

            <div className="space-y-3">

                {data.length === 0 ? (
                    <div className="py-8 text-center text-sm text-slate-500">
                        No recent transactions
                    </div>
                ) : (
                    data.slice(0, 5).map((item) => {

                        const Icon = getIcon(
                            item.category,
                            item.type
                        );

                        const isIncome =
                            item.type === "income";

                        const amount = `${isIncome ? "+" : "-"}₹${Math.abs(
                            item.amount
                        ).toLocaleString("en-IN", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                        })}`;

                        return (
                            <div
                                key={item.id}
                                className="grid grid-cols-[1fr_auto] items-center gap-3"
                            >

                                <div className="flex min-w-0 items-center gap-3">

                                    <div
                                        className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                                            isIncome
                                                ? "bg-emerald-50"
                                                : "bg-red-50"
                                        }`}
                                    >
                                        <Icon
                                            className={
                                                isIncome
                                                    ? "text-emerald-600"
                                                    : "text-red-500"
                                            }
                                            size={16}
                                        />
                                    </div>

                                    <div className="min-w-0">

                                        <div className="truncate font-semibold text-slate-900">
                                            {item.title}
                                        </div>

                                        <div className="mt-1 truncate text-[14px] text-slate-500">
                                            {item.category}
                                        </div>

                                    </div>

                                </div>

                                <div className="min-w-[100px] text-right">

                                    <div
                                        className={`font-semibold ${
                                            isIncome
                                                ? "text-emerald-600"
                                                : "text-red-500"
                                        }`}
                                    >
                                        {amount}
                                    </div>

                                    <div className="mt-1 text-[14px] text-slate-500">
                                        {formatDate(item.date)}
                                    </div>

                                </div>

                            </div>
                        );
                    })
                )}

            </div>

        </Card>
    );
}




