import { ReactNode } from "react";
import {
    ArrowDownRight,
    ArrowUpRight,
} from "lucide-react";

import { cn } from "@/lib/utils";

export interface FinanceStatCardProps {
    title: string;
    value: string;
    change: string;
    positive?: boolean;
    icon: ReactNode;
    sparkline?: ReactNode;
    className?: string;
}

export function FinanceStatCard({
    title,
    value,
    change,
    positive = true,
    icon,
    sparkline,
    className,
}: FinanceStatCardProps) {
    return (
        <section
            className={cn(
                "rounded-2xl  bg-white p-5 shadow-sm transition-all duration-200 hover:shadow-sm",
                className
            )}
        >
            <div className="flex items-start justify-between">

                <div>

                    <p className="text-sm font-medium text-slate-500">
                        {title}
                    </p>

                    <h3 className="mt-3 text-4xl font-bold tracking-tight text-slate-900">
                        {value}
                    </h3>

                    <div
                        className={cn(
                            "mt-4 flex items-center gap-1 text-sm font-semibold",
                            positive
                                ? "text-emerald-600"
                                : "text-red-600"
                        )}
                    >
                        {positive
                            ? <ArrowUpRight className="h-4 w-4" />
                            : <ArrowDownRight className="h-4 w-4" />
                        }

                        {change}

                        <span className="font-normal text-slate-400">
                            vs last month
                        </span>

                    </div>

                </div>

                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50">
                    {icon}
                </div>

            </div>

            {sparkline && (
                <div className="mt-5 h-12">
                    {sparkline}
                </div>
            )}

        </section>
    );
}
