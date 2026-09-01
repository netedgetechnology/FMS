import { useEffect, useState } from "react";

import {
    Pie,
    PieChart,
    ResponsiveContainer,
} from "recharts";

import { Card } from "@/components/ui/card";
import { useMoneyFormatter } from "@/core/formatting";

import {
    DashboardService,
    DEFAULT_DASHBOARD_PERIOD,
    resolveDashboardPeriod,
    type DashboardPeriod,
    type ExpenseBreakdownItem,
} from "../../services";
import { PeriodSelect } from "../common/PeriodSelect";
import { buildExpenseSegments } from "./expenseSegments";

interface ExpenseBreakdownCardProps {
    data: ExpenseBreakdownItem[];
}

export function ExpenseBreakdownCard({
    data,
}: ExpenseBreakdownCardProps) {
    const formatMoney = useMoneyFormatter();

    const [period, setPeriod] = useState<DashboardPeriod>(
        DEFAULT_DASHBOARD_PERIOD,
    );

    const [fetched, setFetched] = useState<
        ExpenseBreakdownItem[] | null
    >(null);

    useEffect(() => {
        let active = true;

        new DashboardService()
            .getExpenseBreakdown(resolveDashboardPeriod(period))
            .then((result) => {
                if (active) {
                    setFetched(result);
                }
            })
            .catch(() => {
                if (active) {
                    setFetched([]);
                }
            });

        return () => {
            active = false;
        };
    }, [period]);

    const items: ExpenseBreakdownItem[] = fetched ?? data;

    /*
     * Single source of truth for category colours. The donut reads
     * `fill` straight off this array and the legend below renders the
     * same array, so a segment's colour always matches its legend
     * swatch — for any number of categories.
     */
    const displayData = buildExpenseSegments(items);

    const total = displayData.reduce(
        (sum, item) => sum + item.value,
        0,
    );

    return (
        <Card
            className="h-full rounded-[20px] border border-slate-200/80 bg-white p-4 shadow-[0_4px_20px_rgba(15,23,42,0.05)]"
        >

            <div className="flex items-start justify-between">

                <div>
                    <h2 className="text-[20px] font-semibold text-slate-900">
                        Expense Breakdown
                    </h2>
                </div>

                <PeriodSelect
                    value={period}
                    onChange={setPeriod}
                    triggerClassName="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700"
                />

            </div>

            <div className="mt-4 grid grid-cols-[150px_1fr] items-center gap-3">

                <div className="flex flex-col items-center">

                    <div className="h-[150px] w-[150px]">

                        <ResponsiveContainer
                            width="100%"
                            height="100%"
                        >

                            <PieChart>

                                <Pie
                                    data={displayData}
                                    dataKey="value"
                                    nameKey="name"
                                    outerRadius={64}
                                    stroke="white"
                                    strokeWidth={2}
                                    minAngle={4}
                                    isAnimationActive={false}
                                />

                            </PieChart>

                        </ResponsiveContainer>

                    </div>

                    <div className="mt-3 text-center">

                        <div className="text-[11px] font-medium text-slate-500">
                            Total
                        </div>

                        <div className="text-[14px] font-bold leading-tight text-slate-900 tabular-nums">
                            {formatMoney(total)}
                        </div>

                    </div>

                </div>

                <div className="flex min-w-0 flex-col justify-center space-y-1.5">

                    {displayData.map((item, index) => {

                        const percent =
                            total > 0
                                ? Math.round(
                                      (item.value / total) * 100,
                                  )
                                : 0;

                        return (
                            <div
                                key={`${item.name}-${index}`}
                                className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-x-2"
                            >

                                <span
                                    className="h-2.5 w-2.5 rounded-full"
                                    style={{
                                        background: item.fill,
                                    }}
                                />

                                <span className="truncate text-[13px] font-medium text-slate-700">
                                    {item.name}
                                </span>

                                <span className="flex items-baseline justify-end gap-2 whitespace-nowrap text-[13px]">

                                    <span className="text-slate-400">
                                        {percent}%
                                    </span>

                                    <span className="font-semibold text-slate-900 tabular-nums">
                                        {formatMoney(item.value)}
                                    </span>

                                </span>

                            </div>
                        );

                    })}

                </div>

            </div>

        </Card>
    );
}





