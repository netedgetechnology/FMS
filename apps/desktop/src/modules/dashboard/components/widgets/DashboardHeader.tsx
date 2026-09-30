import { useState } from "react";

import {
    CalendarDays,
    Check,
    ChevronDown,
} from "lucide-react";

import { Button } from "@/components/ui/button";

import {
    MAX_DASHBOARD_RANGE_DAYS,
    validateCustomDateRange,
    type DashboardRangeSelection,
} from "../../services";

interface DashboardHeaderProps {
    selection: DashboardRangeSelection;
    onSelectionChange: (selection: DashboardRangeSelection) => void;
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

export function formatDay(date: Date): string {
    return date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
}

/**
 * Parses a plain `YYYY-MM-DD` calendar date (exactly what a native
 * `<input type="date">` produces) into a local midnight `Date` for
 * display formatting only. Deliberately NOT `new Date(isoString)`: that
 * parses date-only ISO strings as UTC midnight, which `toLocaleDateString`
 * then renders in the *local* timezone - shifting the displayed day
 * backward by one for any timezone behind UTC. Splitting the string and
 * building the `Date` from local year/month/day components avoids that
 * entirely.
 */
export function parseIsoDateAsLocal(value: string): Date {
    const [year, month, day] = value.split("-").map(Number);

    return new Date(year, (month || 1) - 1, day || 1);
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

/**
 * The Dashboard header's display for an applied Custom Date Range, e.g.
 * "01 Sep 2026 - 13 Sep 2026".
 */
export function customRangeLabel(start: string, end: string): string {
    return `${formatDay(parseIsoDateAsLocal(start))} - ${formatDay(
        parseIsoDateAsLocal(end),
    )}`;
}

export function DashboardHeader({
    selection,
    onSelectionChange,
}: DashboardHeaderProps) {
    const [open, setOpen] = useState(false);
    const [customDaysValue, setCustomDaysValue] = useState("");

    const [customRangeStart, setCustomRangeStart] = useState(
        selection.mode === "customRange" ? selection.start : "",
    );
    const [customRangeEnd, setCustomRangeEnd] = useState(
        selection.mode === "customRange" ? selection.end : "",
    );
    const [customRangeError, setCustomRangeError] = useState<
        string | null
    >(null);

    const applyCustomDays = () => {
        const parsed = Math.floor(Number(customDaysValue));

        if (Number.isFinite(parsed) && parsed >= 1) {
            onSelectionChange({
                mode: "days",
                days: Math.min(parsed, MAX_DASHBOARD_RANGE_DAYS),
            });
            setCustomDaysValue("");
            setOpen(false);
        }
    };

    const applyCustomRange = () => {
        const validation = validateCustomDateRange(
            customRangeStart,
            customRangeEnd,
        );

        if (!validation.valid) {
            setCustomRangeError(validation.error);
            return;
        }

        setCustomRangeError(null);
        onSelectionChange({
            mode: "customRange",
            start: customRangeStart,
            end: customRangeEnd,
        });
        setOpen(false);
    };

    const clearCustomRange = () => {
        setCustomRangeStart("");
        setCustomRangeEnd("");
        setCustomRangeError(null);
    };

    const isDaysPreset =
        selection.mode === "days" &&
        RANGE_PRESETS.some((preset) => preset.days === selection.days);

    const isCustomDaysActive =
        selection.mode === "days" && !isDaysPreset;

    const isCustomRangeActive = selection.mode === "customRange";

    const headerLabel =
        selection.mode === "customRange"
            ? customRangeLabel(selection.start, selection.end)
            : rangeLabel(selection.days);

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
                        onClick={() => {
                            // Re-seed the custom-range draft from the
                            // active selection each time the panel opens,
                            // so reopening it shows what's actually applied
                            // rather than a stale draft from a previous
                            // session.
                            if (!open && selection.mode === "customRange") {
                                setCustomRangeStart(selection.start);
                                setCustomRangeEnd(selection.end);
                                setCustomRangeError(null);
                            }

                            setOpen((value) => !value);
                        }}
                        aria-expanded={open}
                        className="h-14 rounded-2xl border-transparent px-6 text-body font-medium shadow-sm"
                    >

                        <CalendarDays className="mr-3 h-5 w-5 shrink-0" />

                        {headerLabel}

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

                            <div className="absolute right-0 z-50 mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">

                                <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                    Date range
                                </div>

                                {RANGE_PRESETS.map((preset) => (
                                    <button
                                        key={preset.days}
                                        type="button"
                                        onClick={() => {
                                            onSelectionChange({
                                                mode: "days",
                                                days: preset.days,
                                            });
                                            setOpen(false);
                                        }}
                                        className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm ${
                                            selection.mode === "days" &&
                                            selection.days === preset.days
                                                ? "bg-slate-100 font-semibold text-slate-900"
                                                : "text-slate-600 hover:bg-slate-50"
                                        }`}
                                    >
                                        {preset.label}

                                        {selection.mode === "days" &&
                                            selection.days ===
                                                preset.days && (
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
                                            value={customDaysValue}
                                            onChange={(event) =>
                                                setCustomDaysValue(
                                                    event.target.value,
                                                )
                                            }
                                            onKeyDown={(event) => {
                                                if (event.key === "Enter") {
                                                    applyCustomDays();
                                                }
                                            }}
                                            placeholder={
                                                isCustomDaysActive &&
                                                selection.mode === "days"
                                                    ? String(selection.days)
                                                    : "e.g. 45"
                                            }
                                            className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-slate-400"
                                        />

                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={applyCustomDays}
                                            className="h-9 rounded-lg px-3 text-sm"
                                        >
                                            Apply
                                        </Button>

                                    </div>

                                    {isCustomDaysActive &&
                                        selection.mode === "days" && (
                                            <p className="mt-1.5 text-[11px] text-slate-400">
                                                Showing last {selection.days}{" "}
                                                days
                                            </p>
                                        )}

                                </div>

                                <div className="mt-1 border-t border-slate-100 px-3 pb-2 pt-3">

                                    <div className="flex items-center justify-between">
                                        <label className="text-xs font-medium text-slate-500">
                                            Custom Date Range
                                        </label>

                                        {isCustomRangeActive && (
                                            <Check className="h-3.5 w-3.5 text-slate-500" />
                                        )}
                                    </div>

                                    <div className="mt-1.5 grid grid-cols-2 gap-2">

                                        <div>
                                            <label
                                                htmlFor="dashboard-custom-range-start"
                                                className="mb-1 block text-[11px] text-slate-400"
                                            >
                                                Start date
                                            </label>

                                            <input
                                                id="dashboard-custom-range-start"
                                                type="date"
                                                value={customRangeStart}
                                                max={customRangeEnd || undefined}
                                                onChange={(event) => {
                                                    setCustomRangeStart(
                                                        event.target.value,
                                                    );
                                                    setCustomRangeError(null);
                                                }}
                                                className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-slate-400"
                                            />
                                        </div>

                                        <div>
                                            <label
                                                htmlFor="dashboard-custom-range-end"
                                                className="mb-1 block text-[11px] text-slate-400"
                                            >
                                                End date
                                            </label>

                                            <input
                                                id="dashboard-custom-range-end"
                                                type="date"
                                                value={customRangeEnd}
                                                min={customRangeStart || undefined}
                                                onChange={(event) => {
                                                    setCustomRangeEnd(
                                                        event.target.value,
                                                    );
                                                    setCustomRangeError(null);
                                                }}
                                                className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-slate-400"
                                            />
                                        </div>

                                    </div>

                                    {customRangeError && (
                                        <p className="mt-1.5 text-[11px] font-medium text-red-500">
                                            {customRangeError}
                                        </p>
                                    )}

                                    <div className="mt-2 flex items-center justify-end gap-2">

                                        <Button
                                            type="button"
                                            variant="ghost"
                                            onClick={clearCustomRange}
                                            className="h-9 rounded-lg px-3 text-sm text-slate-500"
                                        >
                                            Clear
                                        </Button>

                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={applyCustomRange}
                                            className="h-9 rounded-lg px-3 text-sm"
                                        >
                                            Apply
                                        </Button>

                                    </div>

                                </div>

                            </div>
                        </>
                    )}

                </div>

            </div>

        </div>

    );
}
