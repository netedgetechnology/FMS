import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { LucideIcon } from "lucide-react";
import { Sparkline } from "../charts/Sparkline";

const positiveData = [
    { value: 10 }, { value: 11 }, { value: 13 }, { value: 12 },
    { value: 15 }, { value: 17 }, { value: 16 }, { value: 19 }
];

const negativeData = [
    { value: 19 }, { value: 18 }, { value: 17 }, { value: 18 },
    { value: 16 }, { value: 15 }, { value: 14 }, { value: 13 }
];

export interface DashboardStatCardProps {
    title: string;
    value: string;
    change: string;
    positive?: boolean;
    icon: LucideIcon;
    iconBackground: string;
    iconColor: string;
}

export function DashboardStatCard({
    title,
    value,
    change,
    positive = true,
    icon: Icon,
    iconBackground,
    iconColor,
}: DashboardStatCardProps) {

    const chartColor = positive ? "#16A34A" : "#EF4444";
    const data = positive ? positiveData : negativeData;

    return (
        <div className="rounded-2xl  bg-white p-5 shadow-sm transition-shadow hover:shadow-sm">

            <div className="flex items-start justify-between">

                <div>

                    <div className="text-[15px] font-medium text-slate-500">
                        {title}
                    </div>

                    <div className="mt-2 text-[20px] font-bold leading-none text-slate-900">
                        {value}
                    </div>

                </div>

                <div
                    className="flex h-11 w-11 items-center justify-center rounded-xl"
                    style={{ backgroundColor: iconBackground }}
                >
                    <Icon size={19} style={{ color: iconColor }} />
                </div>

            </div>

            <div className="mt-4 flex items-end justify-between">

                <div className={positive ? "text-emerald-600" : "text-red-500"}>

                    <div className="flex items-center text-[13px] font-semibold">

                        {positive
                            ? <ArrowUpRight size={14} />
                            : <ArrowDownRight size={14} />
                        }

                        <span className="ml-1">
                            {change}
                        </span>

                    </div>

                    <div className="mt-1 text-[12px] text-slate-400">
                        vs last month
                    </div>

                </div>

                <div className="h-12 w-16">

                    <Sparkline
                        color={chartColor}
                        data={data}
                    />

                </div>

            </div>

        </div>
    );
}
