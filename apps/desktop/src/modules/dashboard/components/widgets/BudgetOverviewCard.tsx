import { useMoneyFormatter } from "@/core/formatting";

import {
    Cell,
    Pie,
    PieChart,
    ResponsiveContainer,
} from "recharts";

import { Card } from "@/components/ui/card";

import type { DashboardBudgetOverview } from "../../types";
import { CardViewAllLink } from "../common/CardViewAllLink";

interface BudgetOverviewCardProps {
    data: DashboardBudgetOverview;
}

const STATUS_DOT: Record<
    DashboardBudgetOverview["categories"][number]["statusKey"],
    string
> = {
    over: "bg-red-500",
    approaching: "bg-amber-500",
    "on-track": "bg-emerald-500",
    "no-spending": "bg-slate-300",
};

export function BudgetOverviewCard({
    data,
}: BudgetOverviewCardProps) {
    const formatMoney = useMoneyFormatter();
    const money = (value: number) =>
        formatMoney(
            value,
            data.currencyCode ?? undefined
        );

    const hasBudgets = data.currencyId !== null;

    // Ring is clamped to 0..100 for the visual only; the label shows the
    // real percentage from calculateBudgetSpending().
    const ringPercent = Math.min(
        Math.max(
            Number.isFinite(data.percentageUsed)
                ? data.percentageUsed
                : 0,
            0
        ),
        100
    );

    const labelPercent = Number.isFinite(
        data.percentageUsed
    )
        ? Math.round(data.percentageUsed)
        : 0;

    const chartData = [
        {
            value: ringPercent,
            color: data.overBudget
                ? "#dc2626"
                : "#2563eb",
        },
        {
            value: 100 - ringPercent,
            color: "#e2e8f0",
        },
    ];

    return (
        <Card className="h-full rounded-[20px] border border-slate-200/80 bg-white p-5 shadow-[0_4px_20px_rgba(15,23,42,0.05)]">
            <div className="mb-4 flex items-center justify-between">
                <h2 className="text-card-title">
                    Budget Overview
                </h2>

                <CardViewAllLink
                    to="/budgets"
                    label="View budgets"
                />
            </div>

            {!hasBudgets ? (
                <div className="flex h-40 flex-col items-center justify-center text-center">
                    <p className="text-small text-slate-500">
                        No budgets for this month.
                    </p>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-[150px_1fr] gap-4">
                        <div className="relative h-40">
                            <ResponsiveContainer>
                                <PieChart>
                                    <Pie
                                        data={chartData}
                                        innerRadius={44}
                                        outerRadius={60}
                                        stroke="none"
                                        dataKey="value"
                                    >
                                        {chartData.map(
                                            (
                                                entry,
                                                index
                                            ) => (
                                                <Cell
                                                    key={
                                                        index
                                                    }
                                                    fill={
                                                        entry.color
                                                    }
                                                />
                                            )
                                        )}
                                    </Pie>
                                </PieChart>
                            </ResponsiveContainer>

                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                                <div
                                    className={
                                        "text-card-value percent " +
                                        (data.overBudget
                                            ? "text-red-600"
                                            : "")
                                    }
                                >
                                    {labelPercent}%
                                </div>

                                <div className="text-small text-slate-500">
                                    {data.overBudget
                                        ? "over budget"
                                        : "of budget used"}
                                </div>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <Row
                                label="Total Budget"
                                value={money(
                                    data.totalBudget
                                )}
                            />

                            <Row
                                label="Actual Spending"
                                value={money(
                                    data.actualSpending
                                )}
                                valueClass="text-red-500"
                            />

                            <Row
                                label="Remaining"
                                value={money(
                                    data.remaining
                                )}
                                valueClass={
                                    data.remaining < 0
                                        ? "text-red-600"
                                        : "text-emerald-600"
                                }
                            />
                        </div>
                    </div>

                    <div className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5 text-small text-slate-500">
                        <div className="flex justify-between">
                            <span>Unbudgeted spending</span>
                            <span className="font-semibold text-slate-700">
                                {money(
                                    data.unbudgetedSpending
                                )}
                            </span>
                        </div>

                        <div className="mt-0.5 flex justify-between text-[11px] text-slate-400">
                            <span>
                                incl. uncategorized
                            </span>
                            <span>
                                {money(
                                    data.uncategorizedSpending
                                )}
                            </span>
                        </div>
                    </div>

                    {data.categories.length > 0 && (
                        <ul className="mt-4 space-y-2">
                            {data.categories
                                .slice(0, 5)
                                .map(category => (
                                    <li
                                        key={
                                            category.budgetId
                                        }
                                        className="flex items-center justify-between gap-2 text-small"
                                    >
                                        <span className="flex min-w-0 items-center gap-2">
                                            <span
                                                className={
                                                    "h-2 w-2 shrink-0 rounded-full " +
                                                    STATUS_DOT[
                                                        category
                                                            .statusKey
                                                    ]
                                                }
                                            />
                                            <span className="truncate text-slate-600">
                                                {
                                                    category.label
                                                }
                                            </span>
                                        </span>

                                        <span
                                            className={
                                                "shrink-0 tabular-nums " +
                                                (category.overBudget
                                                    ? "font-semibold text-red-600"
                                                    : "text-slate-500")
                                            }
                                        >
                                            {money(
                                                category.actualAmount
                                            )}{" "}
                                            /{" "}
                                            {money(
                                                category.budgetAmount
                                            )}
                                        </span>
                                    </li>
                                ))}

                            {data.categories.length >
                                5 && (
                                <li className="text-[11px] text-slate-400">
                                    +
                                    {data.categories
                                        .length - 5}{" "}
                                    more on the Budgets
                                    page
                                </li>
                            )}
                        </ul>
                    )}

                    {data.hasOtherCurrencies && (
                        <p className="mt-3 text-[11px] text-slate-400">
                            Showing{" "}
                            {data.currencyCode ??
                                "the primary currency"}{" "}
                            only - other currencies are
                            on the Budgets page.
                        </p>
                    )}
                </>
            )}
        </Card>
    );
}

function Row({
    label,
    value,
    valueClass = "",
}: {
    label: string;
    value: string;
    valueClass?: string;
}) {
    return (
        <div className="flex justify-between">
            <span className="text-secondary text-slate-500">
                {label}
            </span>

            <span
                className={
                    "text-body amount font-semibold " +
                    valueClass
                }
            >
                {value}
            </span>
        </div>
    );
}
