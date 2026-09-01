import {
    Building2,
    CreditCard,
    Wallet,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { useMoneyFormatter } from "@/core/formatting";

import { CardViewAllLink } from "../common/CardViewAllLink";

interface AccountsSummaryCardProps {
    data: {
        id: string;
        name: string;
        type: string;
        amount: number;
        isCreditCard: boolean;
    }[];
}

function getAccountStyle(
    type: string,
    isCreditCard: boolean
) {
    if (isCreditCard) {
        return {
            icon: CreditCard,
            color: "text-red-500",
            bg: "bg-red-50",
        };
    }

    if (type.toLowerCase().includes("cash")) {
        return {
            icon: Wallet,
            color: "text-emerald-600",
            bg: "bg-emerald-50",
        };
    }

    return {
        icon: Building2,
        color: "text-blue-600",
        bg: "bg-blue-50",
    };
}

export function AccountsSummaryCard({
    data,
}: AccountsSummaryCardProps) {
    const formatMoney = useMoneyFormatter();

    const totalBalance = data.reduce(
        (sum, account) => sum + account.amount,
        0
    );

    return (

        <Card className="h-full rounded-[20px] border border-slate-200/80 bg-white p-4 shadow-[0_4px_20px_rgba(15,23,42,0.05)]">

            <div className="mb-4 flex items-center justify-between">

                <div>

                    <h2 className="text-card-title">
                        Accounts Summary
                    </h2>

                    <p className="text-secondary text-slate-500">
                        Account balances
                    </p>

                </div>

                <CardViewAllLink to="/accounts" />

            </div>

            <div className="space-y-3">

                {data.length === 0 ? (
                    <div className="py-8 text-center text-sm text-slate-500">
                        No accounts available
                    </div>
                ) : (
                    data.slice(0, 5).map((item) => {

                        const style = getAccountStyle(
                            item.type,
                            item.isCreditCard
                        );

                        const Icon = style.icon;

                        return (

                            <div
                                key={item.id}
                                className="flex items-center justify-between"
                            >

                                <div className="flex min-w-0 items-center gap-3">

                                    <div
                                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${style.bg}`}
                                    >

                                        <Icon
                                            size={16}
                                            className={style.color}
                                        />

                                    </div>

                                    <div className="min-w-0">

                                        <div className="truncate text-body font-semibold text-slate-900">
                                            {item.name}
                                        </div>

                                        <div className="text-secondary text-slate-500">
                                            {item.type}
                                        </div>

                                    </div>

                                </div>

                                <div
                                    className={`text-body amount ml-3 whitespace-nowrap font-semibold ${style.color}`}
                                >
                                    {item.amount < 0 ? "-" : ""}{formatMoney(Math.abs(item.amount))}
                                </div>

                            </div>

                        );

                    })
                )}

            </div>

            <div className="mt-4 border-t border-transparent pt-3">

                <div className="flex items-center justify-between">

                    <span className="text-body font-semibold text-slate-900">
                        Total Balance
                    </span>

                    <span className="text-card-value amount text-slate-900">
                        {totalBalance < 0 ? "-" : ""}{formatMoney(Math.abs(totalBalance))}
                    </span>

                </div>

            </div>

        </Card>
    );
}







