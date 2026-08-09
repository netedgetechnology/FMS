import {
    Car,
    ChevronRight,
    CreditCard,
    Home,
} from "lucide-react";

import { Card } from "@/components/ui/card";

interface EMI {
    id: number;
    type: "home" | "car" | "card";
    title: string;
    lender: string;
    amount: number;
    dueDate: string;
    dueIn: number;
    progress: number;
}

const emis: EMI[] = [
    {
        id: 1,
        type: "home",
        title: "Home Loan",
        lender: "HDFC Bank",
        amount: 24580,
        dueDate: "10 Aug",
        dueIn: 5,
        progress: 82,
    },
    {
        id: 2,
        type: "car",
        title: "Car Loan",
        lender: "ICICI Bank",
        amount: 12450,
        dueDate: "13 Aug",
        dueIn: 8,
        progress: 68,
    },
    {
        id: 3,
        type: "card",
        title: "Credit Card EMI",
        lender: "SBI Card",
        amount: 4250,
        dueDate: "17 Aug",
        dueIn: 12,
        progress: 54,
    },
];

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

                        <p className="text-small text-slate-500 mt-0.5">

                            {emi.lender}

                        </p>

                        <div className="mt-1 text-body amount font-semibold text-slate-900">

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
                            width: `${emi.progress}%`,
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


export function UpcomingEMICard() {

    const total = emis.reduce(
        (sum, emi) => sum + emi.amount,
        0,
    );

    return (

        <Card className="rounded-[20px] border border-slate-200/80 bg-white p-3 shadow-[0_4px_20px_rgba(15,23,42,0.05)]">

            <div className="mb-4 flex items-start justify-between">

                <div>

                    <h2 className="text-card-title text-slate-900">
                        Upcoming EMIs
                    </h2>

                    <p className="mt-1 text-secondary text-slate-500">
                        {emis.length + 4} EMIs due this month • {formatCurrency(total + 18000)}
                    </p>

                </div>

                <button className="text-body font-medium text-blue-600 hover:text-blue-700">
                    View All
                </button>

            </div>

            <div>                {emis.slice(0, 2).map((emi) => (

                    <EMIRow
                        key={emi.id}
                        emi={emi}
                    />

                ))}</div>

            <div className="mt-2 border-t border-slate-100 pt-2">

                <button className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-50 py-2 text-body font-medium text-slate-700 transition hover:bg-slate-100">

                    <span>

                        View Remaining 5 EMIs

                    </span>

                    <ChevronRight
                        size={18}
                    />

                </button>

            </div>

        </Card>

    );

}






