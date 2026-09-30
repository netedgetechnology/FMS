import { toISODateString } from "@/core/formatting";

// ---------------------------------------------------------------------
// Loans - Phase 5 (derived overdue status)
//
// LoanPaymentStatus.OVERDUE exists in the type but is never persisted
// anywhere - EMIScheduleGenerator only ever writes UPCOMING/PAID, and
// LoanPaymentService.processPayment only ever writes PAID/PARTIAL (see
// the Phase 5 inspection report). Rather than adding a write path (a
// scheduler or a recalculation-on-read-then-save step), "overdue" is
// derived here, at read time, from dueDate vs. today - never stored.
// The persisted status column stays exactly UPCOMING/PARTIAL/PAID
// forever; every consumer that wants to know whether a row is overdue
// calls this instead of re-deriving the date comparison itself, so
// Dashboard, the Loans page and the EMI schedule dialog can never
// disagree with each other about it.
//
// Rule (agreed, fixed): a row is overdue when its status is not PAID
// AND its dueDate is strictly earlier than the local calendar "today"
// (toISODateString(asOf), not a raw UTC/millisecond comparison - same
// convention already established for Investments' price-freshness
// classifier, for the same off-by-one reason). The due date itself is
// not yet overdue - only the day after. A PAID row is never overdue,
// regardless of dueDate or how late paidDate was relative to it - the
// debt is settled, full stop. PARTIAL rows are eligible exactly like
// UPCOMING ones; both facts (partial and overdue) can be true at once
// and are reported independently, not collapsed into one value.
// ---------------------------------------------------------------------

export interface OverdueCheckSchedule {
    dueDate: string;
    status: string;
}

/**
 * Whether a schedule row is currently overdue. Excludes PAID
 * unconditionally; for UPCOMING/PARTIAL rows, true once dueDate is
 * strictly before the local calendar day of `asOf` (defaults to now).
 */
export function isScheduleOverdue(
    schedule: OverdueCheckSchedule,
    asOf: Date = new Date()
): boolean {
    if (schedule.status === "PAID") {
        return false;
    }

    return schedule.dueDate < toISODateString(asOf);
}

/** Whole calendar days between two YYYY-MM-DD local-date strings (b - a). */
function daysBetween(
    fromDateStr: string,
    toDateStr: string
): number {
    const from = new Date(`${fromDateStr}T00:00:00Z`);
    const to = new Date(`${toDateStr}T00:00:00Z`);

    return Math.round(
        (to.getTime() - from.getTime()) / 86_400_000
    );
}

/**
 * How many whole calendar days past its due date a schedule row is -
 * 0 when it is not overdue (never negative, never fabricated for a
 * PAID or not-yet-due row).
 */
export function scheduleDaysOverdue(
    schedule: OverdueCheckSchedule,
    asOf: Date = new Date()
): number {
    if (!isScheduleOverdue(schedule, asOf)) {
        return 0;
    }

    return daysBetween(
        schedule.dueDate,
        toISODateString(asOf)
    );
}
