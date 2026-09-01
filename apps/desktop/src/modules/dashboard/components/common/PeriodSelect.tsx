import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Check, ChevronDown } from "lucide-react";

import type { DashboardPeriod } from "../../services";

export const PERIOD_LABELS: Record<DashboardPeriod, string> = {
    "7d": "7 Days",
    "30d": "30 Days",
    "60d": "60 Days",
    "90d": "90 Days",
    "180d": "180 Days",
    "365d": "365 Days",
    thisMonth: "This Month",
    lastMonth: "Last Month",
    last3Months: "Last 3 Months",
    last6Months: "Last 6 Months",
    last12Months: "Last 12 Months",
};

const GROUPS: {
    label: string;
    options: DashboardPeriod[];
}[] = [
    {
        label: "By day",
        options: ["7d", "30d", "60d", "90d", "180d", "365d"],
    },
    {
        label: "By month",
        options: [
            "thisMonth",
            "lastMonth",
            "last3Months",
            "last6Months",
            "last12Months",
        ],
    },
];

interface PeriodSelectProps {
    value: DashboardPeriod;
    onChange: (value: DashboardPeriod) => void;
    triggerClassName?: string;
}

export function PeriodSelect({
    value,
    onChange,
    triggerClassName,
}: PeriodSelectProps) {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [position, setPosition] = useState<{
        top: number;
        right: number;
    } | null>(null);

    useLayoutEffect(() => {
        if (!open || !triggerRef.current) {
            return;
        }

        const rect = triggerRef.current.getBoundingClientRect();

        setPosition({
            top: rect.bottom + 8,
            right: window.innerWidth - rect.right,
        });
    }, [open]);

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen((current) => !current)}
                className={
                    triggerClassName ??
                    "flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700"
                }
            >
                {PERIOD_LABELS[value]}
                <ChevronDown size={16} />
            </button>

            {open &&
                position &&
                createPortal(
                    <>
                        <button
                            type="button"
                            aria-hidden
                            tabIndex={-1}
                            className="fixed inset-0 z-[60] cursor-default"
                            onClick={() => setOpen(false)}
                        />

                        <div
                            role="listbox"
                            style={{
                                top: position.top,
                                right: position.right,
                            }}
                            className="fixed z-[61] w-52 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-lg"
                        >
                            {GROUPS.map((group) => (
                                <div key={group.label}>
                                    <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                        {group.label}
                                    </div>

                                    {group.options.map((option) => (
                                        <button
                                            key={option}
                                            type="button"
                                            role="option"
                                            aria-selected={value === option}
                                            onClick={() => {
                                                onChange(option);
                                                setOpen(false);
                                            }}
                                            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm ${
                                                value === option
                                                    ? "bg-slate-100 font-semibold text-slate-900"
                                                    : "text-slate-600 hover:bg-slate-50"
                                            }`}
                                        >
                                            {PERIOD_LABELS[option]}

                                            {value === option && (
                                                <Check className="h-4 w-4" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </>,
                    document.body,
                )}
        </>
    );
}
