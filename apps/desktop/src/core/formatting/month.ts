// Calendar-month helpers, mirroring week.ts. Every function operates in
// local time - consistent with the YYYY-MM-DD strings stored across
// FinanceOS date columns and with DashboardService's own month math -
// and never mutates its input.

const MONTH_LABELS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

/** First day of `date`'s calendar month, at local midnight. */
export function startOfMonth(date: Date): Date {
    return new Date(
        date.getFullYear(),
        date.getMonth(),
        1,
    );
}

/** Last day of `date`'s calendar month, at local midnight. */
export function endOfMonth(date: Date): Date {
    return new Date(
        date.getFullYear(),
        date.getMonth() + 1,
        0,
    );
}

/**
 * First day of the calendar month `months` away from `date`'s month
 * (negative = earlier). Year rollover is handled by the Date
 * constructor's own normalization.
 */
export function addMonths(
    date: Date,
    months: number,
): Date {
    return new Date(
        date.getFullYear(),
        date.getMonth() + months,
        1,
    );
}

/** First day of the current calendar month (defaults to now). */
export function currentMonth(
    reference: Date = new Date(),
): Date {
    return startOfMonth(reference);
}

/** True when both dates fall in the same calendar month and year. */
export function isSameMonth(
    a: Date,
    b: Date,
): boolean {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth()
    );
}

/**
 * Local YYYY-MM-DD string for `date` - matches the format stored in
 * every FinanceOS date column, so results can be compared directly
 * against `start_date` / `end_date` and transaction dates.
 */
export function toISODateString(date: Date): string {
    const year = date.getFullYear();
    const month = String(
        date.getMonth() + 1,
    ).padStart(2, "0");
    const day = String(
        date.getDate(),
    ).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

/** Human label for a month, e.g. "September 2026". */
export function formatMonthLabel(date: Date): string {
    return `${
        MONTH_LABELS[date.getMonth()]
    } ${date.getFullYear()}`;
}
