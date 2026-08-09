import {
    Building2,
    CreditCard,
    Wallet,
} from "lucide-react";

import { Card } from "@/components/ui/card";

const accounts = [
    {
        icon: Building2,
        name: "HDFC Savings",
        type: "Bank",
        amount: "₹42,320.00",
        color: "text-blue-600",
        bg: "bg-blue-50",
    },
    {
        icon: Building2,
        name: "SBI Savings",
        type: "Bank",
        amount: "₹12,000.00",
        color: "text-indigo-600",
        bg: "bg-indigo-50",
    },
    {
        icon: CreditCard,
        name: "ICICI Credit Card",
        type: "Credit Card",
        amount: "-₹3,560.00",
        color: "text-red-500",
        bg: "bg-red-50",
    },
    {
        icon: Wallet,
        name: "Cash Wallet",
        type: "Cash",
        amount: "₹3,560.00",
        color: "text-emerald-600",
        bg: "bg-emerald-50",
    },
];

export function AccountsSummaryCard() {

    return (

        <Card className="rounded-2xl  bg-white p-5 shadow-sm">

            <div className="mb-6 flex items-center justify-between">

                <div>

                    <h2 className="text-xl font-bold">
                        Accounts Summary
                    </h2>

                    <p className="text-sm text-slate-500">
                        Account balances
                    </p>

                </div>

                <button className="text-sm font-semibold text-blue-600 hover:text-blue-700">
                    View all
                </button>

            </div>

            <div className="space-y-5">

                {accounts.map((item) => {

                    const Icon = item.icon;

                    return (

                        <div
                            key={item.name}
                            className="flex items-center justify-between"
                        >

                            <div className="flex items-center gap-4">

                                <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${item.bg}`}>

                                    <Icon
                                        size={20}
                                        className={item.color}
                                    />

                                </div>

                                <div>

                                    <div className="font-semibold text-slate-900">
                                        {item.name}
                                    </div>

                                    <div className="text-sm text-slate-500">
                                        {item.type}
                                    </div>

                                </div>

                            </div>

                            <div className={`text-lg font-semibold ${item.color}`}>
                                {item.amount}
                            </div>

                        </div>

                    );

                })}

            </div>

            <div className="mt-6 border-t border-transparent pt-5">

                <div className="flex items-center justify-between">

                    <span className="font-semibold text-slate-900">
                        Total Balance
                    </span>

                    <span className="text-3xl font-bold text-slate-900">
                        ₹54,320.00
                    </span>

                </div>

            </div>

        </Card>

    );

}
