import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface FinanceCardProps {
    title?: string;
    subtitle?: string;
    action?: ReactNode;
    children: ReactNode;
    className?: string;
}

export function FinanceCard({
    title,
    subtitle,
    action,
    children,
    className,
}: FinanceCardProps) {
    return (
        <section
            className={cn(
                "rounded-2xl  bg-white shadow-sm",
                className
            )}
        >
            {(title || action) && (
                <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">

                    <div>

                        {title && (
                            <h2 className="text-lg font-semibold text-slate-900">
                                {title}
                            </h2>
                        )}

                        {subtitle && (
                            <p className="mt-1 text-sm text-slate-500">
                                {subtitle}
                            </p>
                        )}

                    </div>

                    {action}

                </div>
            )}

            <div className="p-5">
                {children}
            </div>

        </section>
    );
}
