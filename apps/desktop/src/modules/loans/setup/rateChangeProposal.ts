// =====================================================================
// Interest Rate History - Stage 2: the rate-change calculation engine.
//
// PURE and DETERMINISTIC: given a loan's terms, its current schedule, its
// rate history and ONE new rate change, it returns a PROPOSED revised
// schedule for a future review-and-confirm screen. It reads nothing and
// writes nothing; no id, clock or random value enters the result.
//
// ---------------------------------------------------------------------
// Rate timeline
//   The rates in force, by date: the loan's live history entries plus the
//   proposed change. A loan with no entry on/before its start date is
//   treated as carrying loans.interest_rate from its start date (the rate
//   its schedule was generated with - approved audit decision). A rate
//   applies from its effective date (inclusive) until the day before the
//   next entry.
//
// Interest periods and day count
//   Instalment k's interest period runs from the previous due date (the
//   loan start date for instalment 1) to its own due date. Interest for a
//   day D accrues at the rate in force ON D, so the days of a period are
//   start .. due-1. A rate effective ON a due date therefore first applies
//   to the NEXT period; one effective on the period's start date covers the
//   whole period. Days are actual calendar days (UTC dates, no time zone).
//
// Formulas (B = opening principal of the period, r = % per year,
//            d_i = days of the period at rate r_i, D = sum of d_i)
//   MONTHLY_RATE  one rate in the period:  round(B x r/12/100)
//                 several rates:           round(B x SUM(r_i/12/100 x d_i/D))
//                 - each rate weighted by its share of the period's actual
//                   days; with one rate the weight is 1, which is exactly
//                   the existing generator's formula.
//   ACTUAL_365    one rate:                round(B x r/100 x D/365)
//                 several rates:           round(B x SUM(r_i/100 x d_i)/365)
//                 - 365 every year, leap years included, as the generator.
//   EMI (tenure-preserving)  the annuity formula the generator uses, with
//                 the monthly rate of the rate in force at the end of the
//                 period, the opening principal and the instalments left:
//                 round(B x m x (1+m)^n / ((1+m)^n - 1)), m = r/12/100;
//                 B / n when the rate is 0. It is worked out again at each
//                 later rate change in the timeline.
//   Principal = EMI - interest; when interest is above the EMI the
//   instalment is the interest alone (principal 0), as the generator does.
//
// Rounding
//   Every amount is rounded to the paisa, half up, as the generator does:
//   round(x) = Math.round((x + Number.EPSILON) x 100) / 100. Interest is
//   rounded once per instalment (after summing its rate segments), never
//   per segment. The LAST instalment repays exactly the remaining
//   principal, so the schedule ends at 0.00; its difference from the
//   regular EMI is reported as the final adjustment.
//
// Recalculation options (no default - the caller must choose)
//   PRESERVE_TENURE  same number of instalments left; a new EMI.
//   PRESERVE_EMI     the current regular EMI kept; the number of
//                    instalments left is worked out (more or fewer).
//
// Protected instalments - never changed, returned exactly as given
//   PAID, PARTIAL, any paid amount, a linked bank transaction, a linked
//   payment record (loan_schedule_payments) or "Settled before FinWea".
//   They must be the leading instalments. Recalculation starts at the
//   later of (a) the first unprotected instalment and (b) the first
//   instalment whose period reaches the change, from the outstanding
//   principal before it - verified by re-checking every earlier row's
//   arithmetic. Anything ambiguous is refused, never guessed: a partly
//   paid instalment (what it left outstanding is unknown), an unknown
//   status, a gap or protected row out of order, or arithmetic that does
//   not add up.
//
// Not repriced: a lender CSV schedule (import the lender's revised CSV),
// flat-interest loans, balloon loans, and a broken-period first instalment
// that is still unpaid. Overdrafts have no schedule and are out of scope.
// =====================================================================

import { LoanPaymentStatus, type LoanPaymentSchedule } from "../types";

export type RecalculationOption = "PRESERVE_EMI" | "PRESERVE_TENURE";
export type RateCalculationMethod = "MONTHLY_RATE" | "ACTUAL_365";

export interface RateChangeLoanTerms {
    principalAmount: number;
    /** Disbursement date: interest runs from here. */
    startDate: string;
    /** loans.interest_rate - the rate the schedule was generated with. */
    interestRate: number;
    interestType: "REDUCING" | "FLAT";
    interestCalculationMethod: RateCalculationMethod | null;
    scheduleSource: "GENERATED" | "LENDER_CSV" | null;
    paymentDay?: number | null;
    firstInstallmentAmount?: number | null;
    balloonAmount?: number | null;
}

/** The parts of a stored history entry the engine reads. */
export interface RateHistoryPoint {
    effectiveFrom: string;
    rate: number;
    supersededAt?: string | null;
}

export interface RateChangeRequest {
    loan: RateChangeLoanTerms;
    schedule: readonly LoanPaymentSchedule[];
    /** Schedule rows with a loan_schedule_payments record. */
    linkedScheduleIds?: readonly string[];
    history: readonly RateHistoryPoint[];
    change: { effectiveFrom: string; rate: number };
    /**
     * A correction (Stage 3): the live entry this change replaces. It must
     * NOT be in `history`. Recalculation then reaches back to the earlier of
     * the two dates, and the change may restore the rate in force before it.
     */
    replaces?: { effectiveFrom: string; rate: number } | null;
    /** Required: there is no default. */
    option: RecalculationOption | null;
}

export type ProtectionReason = "PAID" | "PARTIAL" | "TRANSACTION_LINKED" | "PAYMENT_RECORDED" | "SETTLED_BEFORE_FINWEA";

export interface ProtectedInstalment {
    row: LoanPaymentSchedule;
    reasons: ProtectionReason[];
}

export interface RateSegment {
    /** First day at this rate (inclusive). */
    from: string;
    /** Day after the last day at this rate (the next segment's start, or the due date). */
    to: string;
    days: number;
    rate: number;
}

export interface ProposedInstalment {
    installmentNumber: number;
    dueDate: string;
    /** True when the current schedule has no instalment with this number. */
    added: boolean;
    openingPrincipal: number;
    interestAmount: number;
    principalAmount: number;
    totalAmount: number;
    outstandingPrincipal: number;
    periodStart: string;
    segments: RateSegment[];
    /** The regular EMI this instalment was worked out with. */
    emi: number;
}

export interface FinalAdjustment {
    installmentNumber: number;
    regularEmi: number;
    finalTotal: number;
    /** finalTotal - regularEmi (negative: a smaller last instalment). */
    difference: number;
}

export interface RateChangeProposal {
    status: "PROPOSED";
    /** oldRate: the rate in force before the change - for a correction, the corrected entry's rate. */
    change: { effectiveFrom: string; oldRate: number; newRate: number };
    /** A correction: the entry it replaces. */
    replaces: { effectiveFrom: string; rate: number } | null;
    calculationMethod: RateCalculationMethod;
    option: RecalculationOption;
    recalculatedFromInstalment: number;
    startingPrincipal: number;
    protectedInstalments: ProtectedInstalment[];
    /** Unprotected instalments before the change reaches them: unchanged. */
    unchangedInstalments: LoanPaymentSchedule[];
    /** The current schedule from `recalculatedFromInstalment` on, as it is. */
    currentFutureInstalments: LoanPaymentSchedule[];
    proposedInstalments: ProposedInstalment[];
    currentEmi: number;
    /** The EMI(s) used, in order; tenure-preserving re-works it at each later rate change. */
    proposedEmis: number[];
    currentRemainingInstalments: number;
    proposedRemainingInstalments: number;
    finalAdjustment: FinalAdjustment;
    totals: {
        currentInterest: number;
        proposedInterest: number;
        currentPrincipal: number;
        proposedPrincipal: number;
    };
    warnings: string[];
}

export interface RateChangeRejection {
    status: "REJECTED";
    errors: string[];
    warnings: string[];
}

export type RateChangeResult = RateChangeProposal | RateChangeRejection;

/** The most instalments a proposal may add when the EMI is kept. */
export const MAX_ADDED_INSTALMENTS = 600;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Half-up to the paisa - the same rounding as EMIScheduleGenerator. */
export function roundPaise(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isIsoDate(value: unknown): value is string {
    if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isRate(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function daysBetween(from: string, to: string): number {
    return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** `months` after a date, on `day` (clamped to the month's end) - as the generator's addMonthsOnDay. */
function addMonthsOnDay(dateString: string, months: number, day: number): string {
    const [year, month] = dateString.split("-").map(Number);
    const target = new Date(Date.UTC(year!, month! - 1 + months, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    return [target.getUTCFullYear(), String(target.getUTCMonth() + 1).padStart(2, "0"), String(Math.min(day, lastDay)).padStart(2, "0")].join("-");
}

function formatRate(rate: number): string {
    return `${rate}%`;
}

function formatDate(iso: string): string {
    const [year, month, day] = iso.split("-");
    return `${day}/${month}/${year}`;
}

// ---------------------------------------------------------------- timeline

interface TimelinePoint {
    effectiveFrom: string;
    rate: number;
}

/** The rate in force on a day: the latest point starting on or before it. */
function rateOnDay(timeline: readonly TimelinePoint[], day: string): number | null {
    let rate: number | null = null;
    for (const point of timeline) {
        if (point.effectiveFrom <= day) rate = point.rate;
        else break;
    }
    return rate;
}

/** A period's days split by rate (consecutive equal rates merged). */
export function periodSegments(timeline: readonly TimelinePoint[], start: string, end: string): RateSegment[] {
    const boundaries = [start, ...timeline.map(point => point.effectiveFrom).filter(date => date > start && date < end), end];
    const segments: RateSegment[] = [];

    for (let index = 0; index < boundaries.length - 1; index++) {
        const from = boundaries[index]!;
        const to = boundaries[index + 1]!;
        const rate = rateOnDay(timeline, from);
        if (rate === null) throw new Error(`No rate is in force on ${from}.`);
        const last = segments[segments.length - 1];
        if (last && last.rate === rate) {
            last.to = to;
            last.days = daysBetween(last.from, to);
        } else {
            segments.push({ from, to, days: daysBetween(from, to), rate });
        }
    }

    return segments;
}

/** One period's interest - see the formulas at the top of this file. */
export function periodInterest(opening: number, segments: readonly RateSegment[], method: RateCalculationMethod): number {
    if (segments.length === 1) {
        const { rate, days } = segments[0]!;
        // Exactly the generator's expressions.
        return method === "ACTUAL_365" ? roundPaise(opening * (rate / 100) * days / 365) : roundPaise(opening * (rate / 12 / 100));
    }

    if (method === "ACTUAL_365") {
        return roundPaise((opening * segments.reduce((sum, s) => sum + (s.rate / 100) * s.days, 0)) / 365);
    }

    const totalDays = segments.reduce((sum, s) => sum + s.days, 0);
    return roundPaise(opening * segments.reduce((sum, s) => sum + (s.rate / 12 / 100) * (s.days / totalDays), 0));
}

/** The generator's annuity EMI for `count` instalments at `rate` % a year. */
export function annuityEmi(principal: number, rate: number, count: number): number {
    const monthly = rate / 12 / 100;
    if (monthly === 0) return roundPaise(principal / count);
    const factor = Math.pow(1 + monthly, count);
    return roundPaise((principal * monthly * factor) / (factor - 1));
}

// ---------------------------------------------------------------- projection

export interface ProjectionInput {
    timeline: readonly TimelinePoint[];
    method: RateCalculationMethod;
    option: RecalculationOption;
    startingPrincipal: number;
    firstInstallmentNumber: number;
    /** The interest period start of the first projected instalment. */
    firstPeriodStart: string;
    /** Due dates of the existing instalments from the first projected one on. */
    existingDueDates: readonly string[];
    paymentDay: number;
    /** PRESERVE_EMI: the EMI kept. */
    keptEmi?: number;
}

/**
 * The schedule from a starting principal under a rate timeline. With one
 * rate throughout, PRESERVE_TENURE from instalment 1 reproduces
 * EMIScheduleGenerator's reducing-balance schedule exactly.
 * Throws (with the reason) when the schedule cannot be completed.
 */
export function projectSchedule(input: ProjectionInput): ProposedInstalment[] {
    const rows: ProposedInstalment[] = [];
    const count = input.existingDueDates.length;
    let balance = roundPaise(input.startingPrincipal);
    let periodStart = input.firstPeriodStart;
    let emi = input.keptEmi ?? 0;
    let emiRate: number | null = null;

    for (let index = 0; balance > 0; index++) {
        const number = input.firstInstallmentNumber + index;
        const added = index >= count;

        if (input.option === "PRESERVE_TENURE" && added) {
            throw new Error("The schedule did not finish within its instalments.");
        }
        if (index >= count + MAX_ADDED_INSTALMENTS) {
            throw new Error(`Keeping the EMI would need more than ${MAX_ADDED_INSTALMENTS} extra instalments.`);
        }

        const dueDate = added ? addMonthsOnDay(rows[rows.length - 1]?.dueDate ?? periodStart, 1, input.paymentDay) : input.existingDueDates[index]!;
        if (daysBetween(periodStart, dueDate) <= 0) {
            throw new Error(`Instalment ${number} is due on ${formatDate(dueDate)}, not after the start of its interest period (${formatDate(periodStart)}).`);
        }

        const segments = periodSegments(input.timeline, periodStart, dueDate);
        const interestAmount = periodInterest(balance, segments, input.method);
        const remaining = count - index;
        const isLast = input.option === "PRESERVE_TENURE" && remaining === 1;

        if (input.option === "PRESERVE_TENURE") {
            // The rate that governs the rest of the loan: the one in force at the end of this period.
            const governing = segments[segments.length - 1]!.rate;
            if (emiRate === null || governing !== emiRate) {
                emi = annuityEmi(balance, governing, remaining);
                emiRate = governing;
            }
        } else if (interestAmount >= emi) {
            throw new Error(
                `The EMI of ${emi.toFixed(2)} does not cover instalment ${number}'s interest of ${interestAmount.toFixed(2)}, so the loan would never be repaid. Choose to keep the tenure instead.`
            );
        }

        let principalAmount = roundPaise(emi - interestAmount);
        let totalAmount = emi;

        if (principalAmount < 0) {
            principalAmount = 0;
            totalAmount = interestAmount;
        }
        if (isLast || principalAmount >= balance) {
            principalAmount = balance;
            totalAmount = roundPaise(principalAmount + interestAmount);
        }

        const opening = balance;
        balance = roundPaise(balance - principalAmount);

        rows.push({
            installmentNumber: number,
            dueDate,
            added,
            openingPrincipal: opening,
            interestAmount,
            principalAmount,
            totalAmount,
            outstandingPrincipal: balance,
            periodStart,
            segments,
            emi,
        });

        periodStart = dueDate;
    }

    return rows;
}

// ---------------------------------------------------------------- protection

function protectionReasons(row: LoanPaymentSchedule, linked: ReadonlySet<string>): ProtectionReason[] {
    const reasons: ProtectionReason[] = [];
    if (row.status === LoanPaymentStatus.PAID) reasons.push("PAID");
    if (row.status === LoanPaymentStatus.PARTIAL || (row.status !== LoanPaymentStatus.PAID && Number(row.paidAmount ?? 0) > 0)) reasons.push("PARTIAL");
    if (row.transactionId) reasons.push("TRANSACTION_LINKED");
    if (linked.has(row.id)) reasons.push("PAYMENT_RECORDED");
    if (row.settledBeforeFinwea) reasons.push("SETTLED_BEFORE_FINWEA");
    return reasons;
}

/**
 * The EMI the borrower pays at the recalculation point - "Keep the EMI"
 * keeps this one. It is the first recalculated instalment's EMI, never an
 * EMI taken across paid instalments: after an earlier Keep Tenure change
 * the paid rows still carry the old EMI. The schedule's last instalment
 * carries the final rounding adjustment, so when it is the only one left
 * the regular instalment just before it gives the EMI.
 */
function emiInForce(rows: readonly LoanPaymentSchedule[], startIndex: number): number {
    const lastIndex = rows.length - 1;
    if (startIndex < lastIndex) return rows[startIndex]!.totalAmount;
    return rows[Math.max(0, lastIndex - 1)]!.totalAmount;
}

// ---------------------------------------------------------------- proposal

/** A proposed revised schedule after one rate change, or why there can be none. */
export function proposeRateChange(request: RateChangeRequest): RateChangeResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const { loan, change } = request;
    const reject = (): RateChangeRejection => ({ status: "REJECTED", errors, warnings });

    // ---- the request itself
    if (request.option !== "PRESERVE_EMI" && request.option !== "PRESERVE_TENURE") {
        errors.push("Choose how to recalculate: keep the EMI (the tenure changes) or keep the tenure (the EMI changes).");
    }
    if (!isRate(change.rate)) errors.push("The new rate must be a number from 0 to 100 (% per year).");
    if (!isIsoDate(change.effectiveFrom)) errors.push("The new rate needs a valid effective date (YYYY-MM-DD).");
    if (!(Number.isFinite(loan.principalAmount) && loan.principalAmount > 0)) errors.push("The loan's principal is missing, so the outstanding principal cannot be verified.");
    if (!isIsoDate(loan.startDate)) errors.push("The loan's start date is missing or invalid.");
    if (!isRate(loan.interestRate)) errors.push("The loan's own interest rate is missing or invalid.");
    if (loan.scheduleSource === "LENDER_CSV") {
        errors.push("This loan uses the lender's own schedule (CSV). FinWea does not reprice it: import the lender's revised schedule instead.");
    }
    if (loan.interestType === "FLAT") errors.push("Rate changes are not recalculated for flat-interest loans.");
    if (Number(loan.balloonAmount ?? 0) > 0) errors.push("Rate changes are not recalculated for loans with a balloon payment yet.");
    if (request.schedule.length === 0) errors.push("The loan has no schedule to recalculate.");

    const method: RateCalculationMethod = loan.interestCalculationMethod === "ACTUAL_365" ? "ACTUAL_365" : "MONTHLY_RATE";

    // ---- the rate history
    const live = request.history.filter(entry => !entry.supersededAt);
    for (const entry of live) {
        if (!isIsoDate(entry.effectiveFrom)) errors.push(`A recorded rate has an invalid effective date (${String(entry.effectiveFrom)}).`);
        if (!isRate(entry.rate)) errors.push(`The rate recorded from ${String(entry.effectiveFrom)} is not a valid rate.`);
    }
    const byDate = new Map<string, number[]>();
    for (const entry of live) byDate.set(entry.effectiveFrom, [...(byDate.get(entry.effectiveFrom) ?? []), entry.rate]);
    for (const [date, rates] of byDate) {
        if (rates.length > 1) {
            errors.push(
                new Set(rates).size > 1
                    ? `Conflicting rates are recorded from ${isIsoDate(date) ? formatDate(date) : date} (${rates.map(formatRate).join(" and ")}). Correct the history first.`
                    : `The rate from ${isIsoDate(date) ? formatDate(date) : date} is recorded more than once. Correct the history first.`
            );
        }
    }

    if (errors.length > 0) return reject();

    if (change.effectiveFrom < loan.startDate) {
        errors.push(`The new rate's effective date ${formatDate(change.effectiveFrom)} is before the loan started (${formatDate(loan.startDate)}).`);
    }
    const sameDay = byDate.get(change.effectiveFrom);
    if (sameDay) {
        errors.push(
            sameDay.includes(change.rate)
                ? `${formatRate(change.rate)} from ${formatDate(change.effectiveFrom)} is already recorded.`
                : `${formatRate(sameDay[0]!)} is already recorded from ${formatDate(change.effectiveFrom)}. Correct that entry instead of adding a conflicting one.`
        );
    }

    // The timeline without the change; the loan's own rate from its start
    // date when no recorded entry covers the start.
    const recorded: TimelinePoint[] = live.map(entry => ({ effectiveFrom: entry.effectiveFrom, rate: entry.rate })).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    const replaces = request.replaces ?? null;
    if (replaces && (!isIsoDate(replaces.effectiveFrom) || !isRate(replaces.rate))) {
        errors.push("The entry being corrected has an invalid date or rate.");
        return reject();
    }
    // The loan's own rate covers its start only when nothing recorded - nor
    // the change itself (correcting the initial rate) - does.
    const coversStart = [...recorded, { effectiveFrom: change.effectiveFrom, rate: change.rate }].some(point => point.effectiveFrom <= loan.startDate);
    const implicit: TimelinePoint[] = coversStart ? [] : [{ effectiveFrom: loan.startDate, rate: loan.interestRate }];
    const before: TimelinePoint[] = [...implicit, ...recorded];
    const oldRate = replaces ? replaces.rate : rateOnDay(before, change.effectiveFrom);

    if (oldRate === null) errors.push("No rate is known before the change, so the old rate cannot be shown.");
    else if (!replaces && oldRate === change.rate && !sameDay) errors.push(`${formatRate(change.rate)} is already the rate on ${formatDate(change.effectiveFrom)}; there is nothing to recalculate.`);

    const timeline = [...before, { effectiveFrom: change.effectiveFrom, rate: change.rate }].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    const later = recorded.filter(point => point.effectiveFrom > change.effectiveFrom);
    if (later.length > 0) {
        warnings.push(`Later recorded rate change(s) also apply: ${later.map(point => `${formatRate(point.rate)} from ${formatDate(point.effectiveFrom)}`).join(", ")}.`);
    }

    // ---- the schedule: numbering, dates, protection
    const rows = [...request.schedule].sort((a, b) => a.installmentNumber - b.installmentNumber);
    rows.forEach((row, index) => {
        if (row.installmentNumber !== index + 1) errors.push(`The schedule's instalment numbers are not 1, 2, 3...: instalment ${index + 1} is missing or repeated.`);
        if (!isIsoDate(row.dueDate)) errors.push(`Instalment ${row.installmentNumber} has an invalid due date.`);
        else if (index > 0 && rows[index - 1]!.dueDate >= row.dueDate) errors.push(`Instalment ${row.installmentNumber} is not due after instalment ${row.installmentNumber - 1}.`);
        if (!Object.values(LoanPaymentStatus).includes(row.status)) errors.push(`Instalment ${row.installmentNumber} has an unknown status (${String(row.status)}), so its payment state is ambiguous.`);
    });
    if (errors.length > 0) return reject();

    const linked = new Set(request.linkedScheduleIds ?? []);
    const reasons = rows.map(row => protectionReasons(row, linked));
    let protectedCount = 0;
    while (protectedCount < rows.length && reasons[protectedCount]!.length > 0) protectedCount++;

    for (let index = protectedCount; index < rows.length; index++) {
        if (reasons[index]!.length > 0) {
            errors.push(
                `Instalment ${rows[index]!.installmentNumber} is paid, linked or settled, but an earlier instalment (${rows[protectedCount]!.installmentNumber}) is not, so the outstanding principal is ambiguous.`
            );
            break;
        }
    }
    const partial = rows.find((_, index) => reasons[index]!.includes("PARTIAL"));
    if (partial) {
        errors.push(`Instalment ${partial.installmentNumber} is partly paid, so the principal it left outstanding is not known. Settle or correct it before recalculating.`);
    }
    if (errors.length > 0) return reject();

    // ---- where recalculation starts
    // A correction re-prices from the earlier of the old and the new date.
    const reachFrom = replaces && replaces.effectiveFrom < change.effectiveFrom ? replaces.effectiveFrom : change.effectiveFrom;
    const firstReached = rows.findIndex(row => row.dueDate > reachFrom);
    if (firstReached === -1) {
        errors.push(`The new rate starts on ${formatDate(change.effectiveFrom)}, after the last instalment is due; no instalment is affected.`);
        return reject();
    }
    const startIndex = Math.max(protectedCount, firstReached);
    if (startIndex >= rows.length) {
        errors.push("Every instalment the new rate reaches is already paid, linked or settled; there is nothing to recalculate.");
        return reject();
    }
    if (firstReached < protectedCount) {
        warnings.push(
            `The new rate applies from ${formatDate(change.effectiveFrom)}, but instalments ${rows[firstReached]!.installmentNumber}-${rows[protectedCount - 1]!.installmentNumber} are already paid, linked or settled. They are not changed; recalculation starts at instalment ${rows[startIndex]!.installmentNumber}.`
        );
    }
    if (startIndex === 0 && Number(loan.firstInstallmentAmount ?? 0) > 0) {
        errors.push("The unpaid broken-period first instalment cannot be repriced. Recalculate once it is paid.");
        return reject();
    }

    // ---- verify the principal up to the start, row by row
    let opening = roundPaise(loan.principalAmount);
    for (let index = 0; index < startIndex; index++) {
        const row = rows[index]!;
        if (row.openingPrincipal !== null && row.openingPrincipal !== undefined && roundPaise(row.openingPrincipal) !== opening) {
            errors.push(`Instalment ${row.installmentNumber} opens at ${row.openingPrincipal.toFixed(2)}, not ${opening.toFixed(2)}: the outstanding principal cannot be verified.`);
            return reject();
        }
        const closing = roundPaise(opening - row.principalAmount);
        if (closing !== roundPaise(row.outstandingPrincipal) || row.principalAmount < 0 || closing < 0) {
            errors.push(
                `Instalment ${row.installmentNumber}: ${opening.toFixed(2)} - ${row.principalAmount.toFixed(2)} is ${closing.toFixed(2)}, but it records ${row.outstandingPrincipal.toFixed(2)} outstanding. The outstanding principal cannot be verified.`
            );
            return reject();
        }
        opening = closing;
    }
    const startingPrincipal = opening;
    if (!(startingPrincipal > 0)) {
        errors.push("Nothing is outstanding at the recalculation point.");
        return reject();
    }

    if (errors.length > 0) return reject();

    // ---- project
    const future = rows.slice(startIndex);
    const currentEmi = emiInForce(rows, startIndex);
    const paymentDay = loan.paymentDay ?? Number(rows[0]!.dueDate.slice(8, 10));
    const option = request.option!;

    let proposed: ProposedInstalment[];
    try {
        proposed = projectSchedule({
            timeline,
            method,
            option,
            startingPrincipal,
            firstInstallmentNumber: rows[startIndex]!.installmentNumber,
            firstPeriodStart: startIndex === 0 ? loan.startDate : rows[startIndex - 1]!.dueDate,
            existingDueDates: future.map(row => row.dueDate),
            paymentDay,
            keptEmi: option === "PRESERVE_EMI" ? currentEmi : undefined,
        });
    } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        return reject();
    }

    const last = proposed[proposed.length - 1]!;
    const sum = (values: number[]) => roundPaise(values.reduce((total, value) => total + value, 0));
    const proposedEmis = proposed.reduce<number[]>((list, row) => (list[list.length - 1] === row.emi ? list : [...list, row.emi]), []);

    if (proposed.some(row => row.added)) {
        warnings.push(`Keeping the EMI adds ${proposed.filter(row => row.added).length} instalment(s), due monthly on day ${paymentDay} after the current last one.`);
    }
    if (option === "PRESERVE_EMI" && proposed.length < future.length) {
        warnings.push(`Keeping the EMI repays the loan ${future.length - proposed.length} instalment(s) sooner.`);
    }

    return {
        status: "PROPOSED",
        change: { effectiveFrom: change.effectiveFrom, oldRate: oldRate!, newRate: change.rate },
        replaces,
        calculationMethod: method,
        option,
        recalculatedFromInstalment: rows[startIndex]!.installmentNumber,
        startingPrincipal,
        protectedInstalments: rows.slice(0, protectedCount).map((row, index) => ({ row, reasons: reasons[index]! })),
        unchangedInstalments: rows.slice(protectedCount, startIndex),
        currentFutureInstalments: future,
        proposedInstalments: proposed,
        currentEmi,
        proposedEmis,
        currentRemainingInstalments: future.length,
        proposedRemainingInstalments: proposed.length,
        finalAdjustment: {
            installmentNumber: last.installmentNumber,
            regularEmi: last.emi,
            finalTotal: last.totalAmount,
            difference: roundPaise(last.totalAmount - last.emi),
        },
        totals: {
            currentInterest: sum(future.map(row => row.interestAmount)),
            proposedInterest: sum(proposed.map(row => row.interestAmount)),
            currentPrincipal: sum(future.map(row => row.principalAmount)),
            proposedPrincipal: sum(proposed.map(row => row.principalAmount)),
        },
        warnings,
    };
}
