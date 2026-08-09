import {
    ShoppingBag,
    UtensilsCrossed,
    Wallet,
    Zap,
    ArrowUpRight,
} from "lucide-react";

import { Card } from "@/components/ui/card";

const transactions = [
    {
        icon: ShoppingBag,
        title: "Amazon",
        category: "Shopping",
        amount: "-₹1,249.00",
        date: "29 May 2025",
        color: "text-red-500",
        bg: "bg-red-50",
    },
    {
        icon: Wallet,
        title: "Salary",
        category: "Income",
        amount: "+₹82,150.00",
        date: "30 May 2025",
        color: "text-emerald-600",
        bg: "bg-emerald-50",
    },
    {
        icon: UtensilsCrossed,
        title: "Zomato",
        category: "Food & Dining",
        amount: "-₹568.00",
        date: "Today",
        color: "text-red-500",
        bg: "bg-orange-50",
    },
    {
        icon: Zap,
        title: "Electricity Bill",
        category: "Utilities",
        amount: "-₹2,228.00",
        date: "28 May 2025",
        color: "text-red-500",
        bg: "bg-yellow-50",
    },
    {
        icon: ArrowUpRight,
        title: "Freelance Work",
        category: "Income",
        amount: "+₹15,000.00",
        date: "27 May 2025",
        color: "text-emerald-600",
        bg: "bg-emerald-50",
    },
];

export function RecentTransactionsCard() {

    return (

        <Card className="rounded-[20px] border border-slate-200/80 bg-white p-5 shadow-[0_4px_20px_rgba(15,23,42,0.05)]">

            <div className="mb-5 flex items-start justify-between">

                <div>

                    <h2 className="text-[20px] font-semibold text-slate-900">
                        Recent Transactions
                    </h2>

                    <p className="mt-1 text-[14px] text-slate-500">
                        Latest account activity
                    </p>

                </div>

                <button className="text-sm font-semibold text-blue-600 hover:text-blue-700">
                    View all
                </button>

            </div>

            <div className="space-y-4">

                {transactions.map((item) => {

                    const Icon = item.icon;

                    return (

                        <div
                            key={item.title}
                            className="grid grid-cols-[1fr_auto] items-center gap-4"
                        >

                            <div className="flex min-w-0 items-center gap-3">

                                <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${item.bg}`}>

                                    <Icon className={item.color} size={20} />

                                </div>

                                <div>

                                    <div className="truncate font-semibold text-slate-900">
                                        {item.title}
                                    </div>

                                    <div className="mt-1 text-[14px] text-slate-500">
                                        {item.category}
                                    </div>

                                </div>

                            </div>

                            <div className="min-w-[88px] text-right">

                                <div className={`font-semibold ${item.color}`}>
                                    {item.amount}
                                </div>

                                <div className="mt-1 text-[14px] text-slate-500">
                                    {item.date}
                                </div>

                            </div>

                        </div>

                    );

                })}

            </div>

        </Card>

    );
}




