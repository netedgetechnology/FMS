// Calendar-quarter and calendar-year helpers, mirroring month.ts. Every
// function operates in local time - consistent with the YYYY-MM-DD
// strings stored across FinanceOS date columns - and never mutates its
// input.
//
// Quarters are fixed civil quarters, with NO fiscal-year offset:
//   Q1 = Jan-Mar   Q2 = Apr-Jun   Q3 = Jul-Sep   Q4 = Oct-Dec

/** 0-based quarter (0..3) for a 0-based month index (0..11). */
export function quarterIndex(monthIndex: number): number {
    return Math.floor(monthIndex / 3);
}

/** First day of `date`'s calendar quarter, at local midnight. */
export function startOfQuarter(date: Date): Date {
    return new Date(
        date.getFullYear(),
        quarterIndex(date.getMonth()) * 3,
        1
    );
}

/** Last day of `date`'s calendar quarter, at local midnight. */
export function endOfQuarter(date: Date): Date {
    return new Date(
        date.getFullYear(),
        quarterIndex(date.getMonth()) * 3 + 3,
        0
    );
}

/** First day of `date`'s calendar year, at local midnight. */
export function startOfYear(date: Date): Date {
    return new Date(date.getFullYear(), 0, 1);
}

/** Last day of `date`'s calendar year, at local midnight. */
export function endOfYear(date: Date): Date {
    return new Date(date.getFullYear(), 11, 31);
}

/** Human label for a quarter, e.g. "Q3 2026". */
export function formatQuarterLabel(date: Date): string {
    return `Q${
        quarterIndex(date.getMonth()) + 1
    } ${date.getFullYear()}`;
}
