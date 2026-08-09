import { ReactNode } from "react";

interface DashboardCardProps {
    title?: string;
    subtitle?: string;
    action?: ReactNode;
    className?: string;
    children: ReactNode;
}

export function DashboardCard({
    title,
    subtitle,
    action,
    className = "",
    children,
}: DashboardCardProps) {
    return (
        <section
            className={[
                "rounded-[28px]",
                "bg-white",
                "shadow-sm",
                "border border-slate-100",
                "p-7",
                "transition-all duration-200",
                className,
            ].join(" ")}
        >
            {(title || action) && (

                <div className="mb-6 flex items-start justify-between">

                    <div>

                        {title && (
                            <h2 className="text-[22px] font-bold text-slate-900">
                                {title}
                            </h2>
                        )}

                        {subtitle && (
                            <p className="mt-1 text-[15px] text-slate-500">
                                {subtitle}
                            </p>
                        )}

                    </div>

                    {action}

                </div>

            )}

            {children}

        </section>
    );
}

