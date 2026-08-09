import {
    CalendarDays,
    CreditCard,
} from "lucide-react";

import { Card } from "@/components/ui/card";

const emis = [
    {
        name: "Home Loan",
        due: "05 Jun 2025",
        amount: "₹28,450",
    },
    {
        name: "Car Loan",
        due: "12 Jun 2025",
        amount: "₹14,200",
    },
    {
        name: "Laptop EMI",
        due: "18 Jun 2025",
        amount: "₹3,250",
    },
];

export function UpcomingEMICard() {

    return (

        <Card className="rounded-2xl  bg-white p-5 shadow-sm">

            <div className="mb-6 flex items-center justify-between">

                <div>

                    <h2 className="text-xl font-bold">
                        Upcoming EMI
                    </h2>

                    <p className="text-sm text-slate-500">
                        Next scheduled payments
                    </p>

                </div>

                <button className="text-sm font-semibold text-blue-600">
                    View all
                </button>

            </div>

            <div className="space-y-5">

                {emis.map((emi) => (

                    <div
                        key={emi.name}
                        className="flex items-center justify-between rounded-xl border-transparent border-slate-100 p-4"
                    >

                        <div className="flex items-center gap-4">

                            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-50">

                                <CreditCard
                                    size={20}
                                    className="text-orange-600"
                                />

                            </div>

                            <div>

                                <div className="font-semibold">
                                    {emi.name}
                                </div>

                                <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">

                                    <CalendarDays size={14} />

                                    {emi.due}

                                </div>

                            </div>

                        </div>

                        <div className="text-lg font-bold text-slate-900">
                            {emi.amount}
                        </div>

                    </div>

                ))}

            </div>

        </Card>

    );

}
