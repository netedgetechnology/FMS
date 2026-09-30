import { useState, type ReactNode } from "react";
import {
    ChevronDown,
    ChevronLeft,
    ChevronRight,
} from "lucide-react";

import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { addMonths, MONTH_LABELS } from "@/core/formatting";

import {
    ALL_BUDGETS_LABEL,
    normalizeMonthRange,
    type BudgetMonthRange,
    type BudgetViewMode,
} from "../services";

// ---------------------------------------------------------------------
// Budgets page period controls
//
//   [ All Budgets ] [ Year ▾ ] [ Month ▾ ] [ Range ▾ ]
//
// Three separate compact pickers (All Budgets is a plain button on the
// page):
//  - Year: a 3 x 4 grid of years with previous / next page buttons.
//    Picking a year shows the Year view.
//  - Month: ONLY the 12 months. The month's year is the selected year
//    (the Year picker's selection) - no years inside this picker.
//  - Range: pick a start month and an end month (with year navigation,
//    so a range can cross years).
//
// The selection rules are pure functions below so they can be tested
// without rendering (this repo has no component render test setup).
// Outside-click / Escape closing and focus return come from the shared
// Base UI Popover.
// ---------------------------------------------------------------------

export const MONTH_SHORT_LABELS: readonly string[] =
    MONTH_LABELS.map(label => label.slice(0, 3));

// --- year / month selection --------------------------------------------

// Picking a year keeps the selected month and moves it into that year,
// so the Month view's year context follows the Year selection.
export function selectYearContext(
    month: Date,
    year: number
): Date {
    return new Date(year, month.getMonth(), 1);
}

// Picking a month uses the selected year as its context: October with
// 2026 selected is October 2026.
export function selectMonthInYear(
    month: Date,
    monthIndex: number
): Date {
    return new Date(month.getFullYear(), monthIndex, 1);
}

// What the page's Previous / Next arrows do: one year at a time in Year
// view, one month at a time in Month view (crossing into the next /
// previous year, which moves the year context with it). No date
// boundary. All Budgets and Range have nothing to step - returned
// unchanged (the arrows are disabled there).
export function stepBudgetPeriod(
    viewMode: BudgetViewMode,
    month: Date,
    delta: number
): Date {
    switch (viewMode) {
        case "year":
            return addMonths(month, 12 * delta);
        case "month":
            return addMonths(month, delta);
        case "all":
        case "range":
            return month;
    }
}

// --- year picker ---------------------------------------------------------

export const YEAR_PAGE_SIZE = 12;

// First year of the 12-year page containing `year` (2016-2027 for 2026).
export function yearPageStart(year: number): number {
    return Math.floor(year / YEAR_PAGE_SIZE) * YEAR_PAGE_SIZE;
}

export function formatYearPageLabel(pageStart: number): string {
    return `${pageStart} – ${pageStart + YEAR_PAGE_SIZE - 1}`;
}

export interface YearPickerCell {
    year: number;
    /** The selected year (marked only while in Year view). */
    selected: boolean;
}

export function buildYearPickerCells(
    pageStart: number,
    selectedYear: number,
    active: boolean
): YearPickerCell[] {
    return Array.from({ length: YEAR_PAGE_SIZE }, (_, index) => {
        const year = pageStart + index;

        return {
            year,
            selected: active && year === selectedYear,
        };
    });
}

// --- month picker --------------------------------------------------------

export interface MonthPickerCell {
    monthIndex: number;
    label: string;
    /** The month being viewed (marked only while in Month view). */
    selected: boolean;
}

export function buildMonthPickerCells(
    month: Date,
    active: boolean
): MonthPickerCell[] {
    return MONTH_LABELS.map((label, monthIndex) => ({
        monthIndex,
        label,
        selected: active && month.getMonth() === monthIndex,
    }));
}

// --- range picker --------------------------------------------------------

export interface RangeDraft {
    /** The year the picker's month grid is showing. */
    year: number;
    /** The first month clicked, waiting for the second; else null. */
    anchor: Date | null;
}

// A fresh draft when the Range picker opens: shows the current range's
// start year (or the selected year when there is no range yet).
export function startRangeDraft(
    range: BudgetMonthRange | null,
    fallbackMonth: Date
): RangeDraft {
    return {
        year: (range?.start ?? fallbackMonth).getFullYear(),
        anchor: null,
    };
}

export function stepRangeDraftYear(
    draft: RangeDraft,
    delta: number
): RangeDraft {
    return { ...draft, year: draft.year + delta };
}

export interface RangeClickResult {
    draft: RangeDraft;
    /** Set once both ends are picked - the range to show. */
    range: BudgetMonthRange | null;
}

// First click picks one end, second click picks the other and completes
// the range (in either order). Clicking the same month twice is a
// one-month range.
export function applyRangeMonthClick(
    draft: RangeDraft,
    monthIndex: number
): RangeClickResult {
    const clicked = new Date(draft.year, monthIndex, 1);

    if (draft.anchor === null) {
        return {
            draft: { ...draft, anchor: clicked },
            range: null,
        };
    }

    return {
        draft: { ...draft, anchor: null },
        range: normalizeMonthRange(draft.anchor, clicked),
    };
}

export type RangeCellState =
    | "anchor"
    | "start"
    | "end"
    | "inside"
    | null;

// How a month cell in the Range picker is highlighted: the pending first
// click while a range is being picked, otherwise the current range.
export function rangeCellState(
    draft: RangeDraft,
    range: BudgetMonthRange | null,
    monthIndex: number
): RangeCellState {
    const cell = new Date(draft.year, monthIndex, 1).getTime();

    if (draft.anchor !== null) {
        return draft.anchor.getTime() === cell ? "anchor" : null;
    }

    if (range === null) {
        return null;
    }

    const start = range.start.getTime();
    const end = range.end.getTime();

    if (cell === start) {
        return "start";
    }

    if (cell === end) {
        return "end";
    }

    return cell > start && cell < end ? "inside" : null;
}

// "Jan 2026 – Mar 2026", or "Oct 2026" for a one-month range.
export function formatMonthRange(range: BudgetMonthRange): string {
    const format = (month: Date) =>
        `${MONTH_SHORT_LABELS[month.getMonth()]} ${month.getFullYear()}`;

    return range.start.getTime() === range.end.getTime()
        ? format(range.start)
        : `${format(range.start)} – ${format(range.end)}`;
}

// --- page summary label ------------------------------------------------

// Short label for the period being viewed, used in the page's summary
// text: "All Budgets", "2026", "October" (its year is shown by the Year
// control) or "Jan 2026 – Mar 2026".
export function formatBudgetPeriodLabel(
    viewMode: BudgetViewMode,
    month: Date,
    range: BudgetMonthRange | null
): string {
    switch (viewMode) {
        case "all":
            return ALL_BUDGETS_LABEL;
        case "year":
            return String(month.getFullYear());
        case "month":
            return MONTH_LABELS[month.getMonth()];
        case "range":
            return formatMonthRange(
                range ?? { start: month, end: month }
            );
    }
}

// --- components ----------------------------------------------------------

type TriggerTone = "active" | "context" | "idle";

function PeriodTrigger({
    label,
    value,
    tone,
    ariaLabel,
}: {
    label: string;
    value: string | null;
    tone: TriggerTone;
    ariaLabel: string;
}) {
    return (
        <PopoverTrigger
            aria-label={ariaLabel}
            className={
                "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm transition-colors " +
                (tone === "active"
                    ? "border-slate-900 bg-slate-900 text-white"
                    : tone === "context"
                      ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900")
            }
        >
            <span
                className={
                    value
                        ? tone === "active"
                            ? "text-xs text-slate-300"
                            : "text-xs text-slate-400"
                        : "font-medium"
                }
            >
                {label}
            </span>

            {value && (
                <span className="font-semibold">{value}</span>
            )}

            <ChevronDown size={14} aria-hidden="true" />
        </PopoverTrigger>
    );
}

function PickerPopover({
    open,
    onOpenChange,
    trigger,
    ariaLabel,
    children,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    trigger: ReactNode;
    ariaLabel: string;
    children: ReactNode;
}) {
    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            {trigger}

            <PopoverContent
                align="start"
                aria-label={ariaLabel}
                className="w-[300px] border border-slate-200 bg-white shadow-lg"
            >
                {children}
            </PopoverContent>
        </Popover>
    );
}

function PickerHeader({
    label,
    previousLabel,
    nextLabel,
    onPrevious,
    onNext,
}: {
    label: string;
    previousLabel: string;
    nextLabel: string;
    onPrevious: () => void;
    onNext: () => void;
}) {
    const arrowClass =
        "inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900";

    return (
        <div className="flex items-center justify-between">
            <button
                type="button"
                onClick={onPrevious}
                aria-label={previousLabel}
                className={arrowClass}
            >
                <ChevronLeft size={16} />
            </button>

            <div
                aria-live="polite"
                className="text-sm font-semibold text-slate-900"
            >
                {label}
            </div>

            <button
                type="button"
                onClick={onNext}
                aria-label={nextLabel}
                className={arrowClass}
            >
                <ChevronRight size={16} />
            </button>
        </div>
    );
}

function gridCellClass(
    state: "selected" | "edge" | "inside" | "none"
): string {
    return (
        "h-9 rounded-lg px-1 text-sm transition-colors " +
        (state === "selected" || state === "edge"
            ? "bg-slate-900 font-semibold text-white"
            : state === "inside"
              ? "bg-slate-100 text-slate-900"
              : "text-slate-700 hover:bg-slate-100 hover:text-slate-900")
    );
}

export interface BudgetYearPickerProps {
    year: number;
    viewMode: BudgetViewMode;
    onSelectYear: (year: number) => void;
}

export function BudgetYearPicker({
    year,
    viewMode,
    onSelectYear,
}: BudgetYearPickerProps) {
    const [open, setOpen] = useState(false);
    const [pageStart, setPageStart] = useState(() =>
        yearPageStart(year)
    );

    const active = viewMode === "year";

    const handleOpenChange = (nextOpen: boolean) => {
        if (nextOpen) {
            setPageStart(yearPageStart(year));
        }

        setOpen(nextOpen);
    };

    return (
        <PickerPopover
            open={open}
            onOpenChange={handleOpenChange}
            ariaLabel="Choose year"
            trigger={
                <PeriodTrigger
                    label="Year"
                    // The year is also the Month view's context.
                    value={
                        active || viewMode === "month"
                            ? String(year)
                            : null
                    }
                    tone={
                        active
                            ? "active"
                            : viewMode === "month"
                              ? "context"
                              : "idle"
                    }
                    ariaLabel={
                        active || viewMode === "month"
                            ? `Year: ${year}. Choose year`
                            : "Choose year"
                    }
                />
            }
        >
            <PickerHeader
                label={formatYearPageLabel(pageStart)}
                previousLabel="Previous years"
                nextLabel="Next years"
                onPrevious={() =>
                    setPageStart(start => start - YEAR_PAGE_SIZE)
                }
                onNext={() =>
                    setPageStart(start => start + YEAR_PAGE_SIZE)
                }
            />

            <div
                role="group"
                aria-label="Years"
                className="grid grid-cols-3 gap-1"
            >
                {buildYearPickerCells(pageStart, year, active).map(
                    cell => (
                        <button
                            key={cell.year}
                            type="button"
                            onClick={() => {
                                onSelectYear(cell.year);
                                setOpen(false);
                            }}
                            aria-pressed={cell.selected}
                            className={gridCellClass(
                                cell.selected ? "selected" : "none"
                            )}
                        >
                            {cell.year}
                        </button>
                    )
                )}
            </div>
        </PickerPopover>
    );
}

export interface BudgetMonthPickerProps {
    month: Date;
    viewMode: BudgetViewMode;
    onSelectMonth: (monthIndex: number) => void;
}

export function BudgetMonthPicker({
    month,
    viewMode,
    onSelectMonth,
}: BudgetMonthPickerProps) {
    const [open, setOpen] = useState(false);

    const active = viewMode === "month";

    return (
        <PickerPopover
            open={open}
            onOpenChange={setOpen}
            ariaLabel="Choose month"
            trigger={
                <PeriodTrigger
                    label="Month"
                    value={
                        active
                            ? MONTH_LABELS[month.getMonth()]
                            : null
                    }
                    tone={active ? "active" : "idle"}
                    ariaLabel={
                        active
                            ? `Month: ${MONTH_LABELS[month.getMonth()]}. Choose month`
                            : "Choose month"
                    }
                />
            }
        >
            <div
                role="group"
                aria-label="Months"
                className="grid grid-cols-3 gap-1"
            >
                {buildMonthPickerCells(month, active).map(cell => (
                    <button
                        key={cell.label}
                        type="button"
                        onClick={() => {
                            onSelectMonth(cell.monthIndex);
                            setOpen(false);
                        }}
                        aria-pressed={cell.selected}
                        className={gridCellClass(
                            cell.selected ? "selected" : "none"
                        )}
                    >
                        {cell.label}
                    </button>
                ))}
            </div>
        </PickerPopover>
    );
}

export interface BudgetRangePickerProps {
    range: BudgetMonthRange | null;
    /** Opens on this month's year when there is no range yet. */
    fallbackMonth: Date;
    viewMode: BudgetViewMode;
    onSelectRange: (range: BudgetMonthRange) => void;
}

export function BudgetRangePicker({
    range,
    fallbackMonth,
    viewMode,
    onSelectRange,
}: BudgetRangePickerProps) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<RangeDraft>(() =>
        startRangeDraft(range, fallbackMonth)
    );

    const active = viewMode === "range" && range !== null;

    const handleOpenChange = (nextOpen: boolean) => {
        if (nextOpen) {
            setDraft(startRangeDraft(range, fallbackMonth));
        }

        setOpen(nextOpen);
    };

    const handleMonthClick = (monthIndex: number) => {
        const result = applyRangeMonthClick(draft, monthIndex);

        setDraft(result.draft);

        if (result.range) {
            onSelectRange(result.range);
            setOpen(false);
        }
    };

    const status =
        draft.anchor !== null
            ? `From ${formatMonthRange({
                  start: draft.anchor,
                  end: draft.anchor,
              })} – pick the end month`
            : range
              ? formatMonthRange(range)
              : "Pick the start month";

    return (
        <PickerPopover
            open={open}
            onOpenChange={handleOpenChange}
            ariaLabel="Choose month range"
            trigger={
                <PeriodTrigger
                    label="Range"
                    value={active ? formatMonthRange(range) : null}
                    tone={active ? "active" : "idle"}
                    ariaLabel={
                        active
                            ? `Range: ${formatMonthRange(range)}. Choose month range`
                            : "Choose month range"
                    }
                />
            }
        >
            <div
                aria-live="polite"
                className="rounded-lg bg-slate-50 px-3 py-2 text-center text-xs font-medium text-slate-600"
            >
                {status}
            </div>

            <PickerHeader
                label={String(draft.year)}
                previousLabel={`Previous year (${draft.year - 1})`}
                nextLabel={`Next year (${draft.year + 1})`}
                onPrevious={() =>
                    setDraft(current =>
                        stepRangeDraftYear(current, -1)
                    )
                }
                onNext={() =>
                    setDraft(current =>
                        stepRangeDraftYear(current, 1)
                    )
                }
            />

            <div
                role="group"
                aria-label={`Months of ${draft.year}`}
                className="grid grid-cols-3 gap-1"
            >
                {MONTH_LABELS.map((label, monthIndex) => {
                    const state = rangeCellState(
                        draft,
                        range,
                        monthIndex
                    );

                    return (
                        <button
                            key={label}
                            type="button"
                            onClick={() =>
                                handleMonthClick(monthIndex)
                            }
                            aria-label={`${label} ${draft.year}`}
                            aria-pressed={state !== null}
                            className={gridCellClass(
                                state === "inside"
                                    ? "inside"
                                    : state === null
                                      ? "none"
                                      : "edge"
                            )}
                        >
                            {label}
                        </button>
                    );
                })}
            </div>
        </PickerPopover>
    );
}
