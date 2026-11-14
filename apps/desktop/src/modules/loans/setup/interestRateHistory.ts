// Interest Rate History - pure rules over stored rows (no database).

import type { InterestRateHistoryEntry } from "../types/InterestRateHistory";

/** The day before an ISO date (YYYY-MM-DD), in UTC so no time zone shifts it. */
export function dayBefore(iso: string): string {
    const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
}

/**
 * Orders a loan's entries and works out "effective until": live entries in
 * date order, each running to the day before the next live entry starts;
 * the latest live entry is the current rate (open-ended). Superseded
 * entries are kept for the audit trail, after the live ones, and are never
 * in effect. Same-date live entries keep the order they were recorded in.
 */
export function withEffectiveUntil(entries: readonly Omit<InterestRateHistoryEntry, "effectiveUntil">[]): InterestRateHistoryEntry[] {
    const byDate = (a: { effectiveFrom: string; createdAt: string }, b: { effectiveFrom: string; createdAt: string }) =>
        a.effectiveFrom.localeCompare(b.effectiveFrom) || a.createdAt.localeCompare(b.createdAt);

    const live = entries.filter(entry => entry.supersededAt === null).sort(byDate);
    const superseded = entries.filter(entry => entry.supersededAt !== null).sort(byDate);

    return [
        ...live.map((entry, index) => {
            const next = live.slice(index + 1).find(later => later.effectiveFrom > entry.effectiveFrom);
            // Stage 3.1: a live entry's previous rate is the live rate before
            // its date on the timeline as it stands now - so a change recorded
            // later, before an upcoming one, or a correction, never leaves a
            // stale "previous" on display. (The stored previous_rate is what
            // was known when the row was saved; it is kept, not shown.)
            const before = live.slice(0, index).filter(earlier => earlier.effectiveFrom < entry.effectiveFrom);
            const previousRate = before.length > 0 ? before[before.length - 1]!.rate : entry.source === "INITIAL" ? null : entry.previousRate;
            return { ...entry, previousRate, effectiveUntil: next ? dayBefore(next.effectiveFrom) : null };
        }),
        ...superseded.map(entry => ({ ...entry, effectiveUntil: null })),
    ];
}

/**
 * The live entry in effect on a date: the latest one starting on or before
 * it (on a shared date, the one recorded last). Null before the first.
 */
export function rateOn(entries: readonly Omit<InterestRateHistoryEntry, "effectiveUntil">[], date: string): InterestRateHistoryEntry | null {
    const day = date.slice(0, 10);
    const started = withEffectiveUntil(entries.filter(entry => entry.supersededAt === null)).filter(entry => entry.effectiveFrom <= day);
    return started[started.length - 1] ?? null;
}

// ---------------------------------------------------------------------
// Stage 3.1 - one rule for the rate in force, upcoming rates and a loan's
// baseline.
//
//   The rate in force on a date is the latest LIVE history entry starting
//   on or before it (on a shared date, the one recorded last). Current =
//   in force today. An entry starting after today is UPCOMING: it is
//   shown, used by calculations on and after its own date, and never
//   treated as the current rate before then.
//
//   A loan with no live history has only its own terms: loans.interest_rate
//   is its rate (no dates or earlier rates are known, and none are made up).
//
//   loans.interest_rate is a stored snapshot, written by the rate-change
//   command as the rate in force on the day it saved. When an upcoming
//   entry's date passes it can lag until the next change is saved, so
//   for a loan WITH history it is never read as the current rate: the
//   current rate is always derived from the history (currentLoanRate).
// ---------------------------------------------------------------------

type HistoryRow = Omit<InterestRateHistoryEntry, "effectiveUntil">;

function liveSorted(entries: readonly HistoryRow[]): HistoryRow[] {
    return entries
        .filter(entry => entry.supersededAt === null)
        .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.createdAt.localeCompare(b.createdAt));
}

/** The live entry in force on `today` (see rateOn), or null when none has started. */
export function currentRateEntry(entries: readonly HistoryRow[], today: string): InterestRateHistoryEntry | null {
    return rateOn(entries, today);
}

/** Live entries that start after `today`, in date order: known, not yet in force. */
export function upcomingEntries(entries: readonly HistoryRow[], today: string): HistoryRow[] {
    const day = today.slice(0, 10);
    return liveSorted(entries).filter(entry => entry.effectiveFrom > day);
}

export interface CurrentLoanRate {
    rate: number;
    rateType: "FIXED" | "FLOATING" | null;
    /**
     * HISTORY: the live entry in force today. LOAN_TERMS: the loan has no
     * live history, so its own stored rate. NOT_STARTED: history exists but
     * its first entry starts after today (a loan that has not started) -
     * that first rate is shown.
     */
    basis: "HISTORY" | "LOAN_TERMS" | "NOT_STARTED";
    entry: HistoryRow | null;
    upcoming: HistoryRow[];
}

/** The loan's current rate under the one rule above (never a lagging snapshot). */
export function currentLoanRate(
    loan: { interestRate: number; rateType?: "FIXED" | "FLOATING" | null },
    entries: readonly HistoryRow[],
    today: string
): CurrentLoanRate {
    const live = liveSorted(entries);
    if (live.length === 0) {
        return { rate: loan.interestRate, rateType: loan.rateType ?? null, basis: "LOAN_TERMS", entry: null, upcoming: [] };
    }
    const upcoming = upcomingEntries(live, today);
    const inForce = rateOn(live, today);
    if (!inForce) {
        const first = live[0]!;
        return { rate: first.rate, rateType: first.rateType, basis: "NOT_STARTED", entry: first, upcoming: upcoming.slice(1) };
    }
    return { rate: inForce.rate, rateType: inForce.rateType, basis: "HISTORY", entry: inForce, upcoming };
}

/** "12.00%", plus the next upcoming change when there is one. */
export function currentRateLabel(current: CurrentLoanRate, formatDate: (iso: string) => string = iso => iso): string {
    const text = `${current.rate.toFixed(2)}%`;
    const next = current.upcoming[0];
    return next ? `${text} (${next.rate.toFixed(2)}% from ${formatDate(next.effectiveFrom)})` : text;
}

/** Live entries for many loans (one query) grouped by loan; empty without history. */
export function groupByLoan(entries: readonly HistoryRow[]): Map<string, HistoryRow[]> {
    const grouped = new Map<string, HistoryRow[]>();
    for (const entry of entries) {
        const list = grouped.get(entry.loanId) ?? [];
        list.push(entry);
        grouped.set(entry.loanId, list);
    }
    return grouped;
}

// ---------------------------------------------------------------- baseline

export type RateBaseline =
    /** The loan already has live history: nothing is recorded first. */
    | { kind: "HISTORY" }
    /**
     * No history: the loan's own terms (its stored rate, from its start
     * date) are recorded as its original rate in the same transaction as
     * the first explicit change - and only then. Nothing else is inferred.
     */
    | { kind: "LOAN_TERMS"; rate: number; effectiveFrom: string; rateType: "FIXED" | "FLOATING" | null }
    /** Not safe to record anything: the reason, for the user. */
    | { kind: "UNSAFE"; reason: string };

function isIsoDay(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** What the first explicit rate change must record before itself. */
export function resolveRateBaseline(
    loan: { interestRate: number | null | undefined; startDate: string | null | undefined; rateType?: "FIXED" | "FLOATING" | null },
    entries: readonly HistoryRow[]
): RateBaseline {
    if (entries.some(entry => entry.supersededAt === null)) return { kind: "HISTORY" };
    if (entries.length > 0) {
        return {
            kind: "UNSAFE",
            reason: "This loan's rate history has only corrected (superseded) entries and no current one, so its original rate is ambiguous. Nothing can be recorded until this is resolved.",
        };
    }
    const start = (loan.startDate ?? "").slice(0, 10);
    if (!isIsoDay(start)) {
        return { kind: "UNSAFE", reason: "This loan has no valid start date, so its original rate cannot be dated. Set the loan's start date first." };
    }
    const rate = loan.interestRate;
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 100) {
        return { kind: "UNSAFE", reason: "This loan's stored interest rate is missing or invalid, so its original rate is not known. Nothing is recorded in its place." };
    }
    return { kind: "LOAN_TERMS", rate, effectiveFrom: start, rateType: loan.rateType ?? null };
}

// ---------------------------------------------------- direct rate edits

/**
 * Edit forms never change an existing loan's interest rate: a rate change
 * is recorded with its effective date and source (Record rate change), so
 * the history is never bypassed. The message to show, or null when the
 * rate is unchanged. (Float noise only - no rounding allowance.)
 */
export function directRateEditRefusal(existingRate: number, requestedRate: number | null | undefined, overdraft: boolean): string | null {
    const requested = requestedRate ?? (overdraft ? 0 : NaN);
    if (Number.isFinite(requested) && Math.abs(requested - existingRate) < 0.000001) return null;
    return "The interest rate can't be changed here. Use Record rate change in the loan's details, which keeps the rate history with its effective date and source.";
}

/**
 * A schedule generated later (EMIScheduleService.generateSchedule) is
 * priced at the loan's one stored rate. Once the history records a
 * different rate (a change, an upcoming one, or a correction), one rate
 * no longer describes the loan, so generation is refused rather than
 * silently ignoring the timeline. Null when one rate is all there is.
 */
export function scheduleGenerationRateIssue(loanRate: number, entries: readonly Omit<InterestRateHistoryEntry, "effectiveUntil">[]): string | null {
    const differs = entries.some(entry => entry.supersededAt === null && Math.abs(entry.rate - loanRate) > 0.000001);
    return differs
        ? "This loan has recorded interest rate changes, and a schedule generated here would use one rate only. It can't be generated until schedules support the rate history."
        : null;
}
