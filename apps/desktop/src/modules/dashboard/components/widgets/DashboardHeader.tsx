import { useState } from "react";

import {
    CalendarDays,
    Check,
    ChevronDown,
} from "lucide-react";

import { Button } from "@/components/ui/button";

import { MAX_DASHBOARD_RANGE_DAYS } from "../../services";

interface DashboardHeaderProps {
    rangeDays: number;
    onRangeDaysChange: (days: number) => void;
}

const RANGE_PRESETS: { days: number; label: string }[] = [
    { days: 1, label: "Today" },
    { days: 7, label: "Last 7 days" },
    { days: 30, label: "Last 30 days" },
    { days: 60, label: "Last 60 days" },
    { days: 90, label: "Last 90 days" },
    { days: 180, label: "Last 180 days" },
    { days: 365, label: "Last 365 days" },
];

function formatDay(date: Date): string {
    return date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
}

function rangeLabel(days: number): string {
    const end = new Date();
    end.setHours(0, 0, 0, 0);

    const start = new Date(end);
    start.setDate(start.getDate() - (days - 1));

    if (days <= 1) {
        return formatDay(end);
    }

    return `${formatDay(start)} - ${formatDay(end)}`;
}

export function DashboardHeader({
    rangeDays,
    onRangeDaysChange,
}: DashboardHeaderProps) {
    const [open, setOpen] = useState(false);
    const [customValue, setCustomValue] = useState("");

    const applyCustom = () => {
        const parsed = Math.floor(Number(customValue));

        if (Number.isFinite(parsed) && parsed >= 1) {
            onRangeDaysChange(
                Math.min(parsed, MAX_DASHBOARD_RANGE_DAYS),
            );
            setCustomValue("");
            setOpen(false);
        }
    };

    const isPreset = RANGE_PRESETS.some(
        (preset) => preset.days === rangeDays,
    );

    return (

        <div className="mb-6 flex items-start justify-between">

            <div>

                <h1 className="text-display leading-none tracking-tight text-slate-900">
                    Dashboard
                </h1>

                <p className="mt-3 text-body text-slate-500">
                    Good evening, User! Here's your financial overview.
                </p>

            </div>

            <div className="flex items-center gap-3">

                <div className="relative">

                    <Button
                        variant="outline"
                        onClick={() => setOpen((value) => !value)}
                        aria-expanded={open}
                        className="h-14 rounded-2xl border-transparent px-6 text-body font-medium shadow-sm"
                    >

                        <CalendarDays className="mr-3 h-5 w-5 shrink-0" />

                        {rangeLabel(rangeDays)}

                        <ChevronDown className="ml-4 h-4 w-4 shrink-0" />

                    </Button>

                    {open && (
                        <>
                            <button
                                type="button"
                                aria-hidden
                                tabIndex={-1}
                                className="fixed inset-0 z-40 cursor-default"
                                onClick={() => setOpen(false)}
                            />

                            <div className="absolute right-0 z-50 mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">

                                <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                    Date range
                                </div>

                                {RANGE_PRESETS.map((preset) => (
                                    <button
                                        key={preset.days}
                                        type="button"
                                        onClick={() => {
                                            onRangeDaysChange(preset.days);
                                            setOpen(false);
                                        }}
                                        className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm ${
                                            rangeDays === preset.days
                                                ? "bg-slate-100 font-semibold text-slate-900"
                                                : "text-slate-600 hover:bg-slate-50"
                                        }`}
                                    >
                                        {preset.label}

                                        {rangeDays === preset.days && (
                                            <Check className="h-4 w-4" />
                                        )}
                                    </button>
                                ))}

                                <div className="mt-1 border-t border-slate-100 px-3 pb-1 pt-3">

                                    <label className="text-xs font-medium text-slate-500">
                                        Custom (previous days)
                                    </label>

                                    <div className="mt-1.5 flex items-center gap-2">

                                        <input
                                            type="number"
                                            min={1}
                                            inputMode="numeric"
                                            value={customValue}
                                            onChange={(event) =>
                                                setCustomValue(event.target.value)
                                            }
                                            onKeyDown={(event) => {
                                                if (event.key === "Enter") {
                                                    applyCustom();
                                                }
                                            }}
                                            placeholder={
                                                isPreset
                                                    ? "e.g. 45"
                                                    : String(rangeDays)
                                            }
                                            className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-slate-400"
                                        />

                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={applyCustom}
                                            className="h-9 rounded-lg px-3 text-sm"
                                        >
                                            Apply
                                        </Button>

                                    </div>

                                    {!isPreset && (
                                        <p className="mt-1.5 text-[11px] text-slate-400">
                                            Showing last {rangeDays} days
                                        </p>
                                    )}

                                </div>

                            </div>
                        </>
                    )}

                </div>

            </div>

        </div>

    );
}
