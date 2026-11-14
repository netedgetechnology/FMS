// ---------------------------------------------------------------------
// Interest Rate History, Stage 4: the rate changes a lender statement
// prints, as PROPOSED history entries for the customer to check, correct
// and confirm. Pure: no database, no React. Nothing here saves anything.
//
//   - Every extracted change is a proposal, with its evidence (page, the
//     statement line, how it was read, every date on that line).
//   - Missing, ambiguous (several dates on the line) or conflicting (two
//     rates on one date) dates stay UNRESOLVED until the customer acts;
//     no date or rate is ever invented. The original rate (from the start
//     date) comes only from a printed previous rate, or the customer.
//   - Proposals apply in date order, whatever order they were printed in.
//
// Saving (see docs/import/statement-rate-history.md):
//   OD / CC / DOD - record-only, atomic with loan creation
//     (CreateLoanRequest.statementRateHistory -> create_loan_atomic).
//   Term Loan - never repriced here: after creation each confirmed change
//     goes through the reviewed Record Rate Change workflow (Keep EMI /
//     Keep Tenure), one atomic save each (termRateChangeInputs).
// ---------------------------------------------------------------------

import type { FacilityExtraction, RateChange } from "@financeos/import-engine";

import type { RateChangeInput } from "../services/InterestRateChangeService";
import { LoanKind, type CreateLoanRequest } from "../types";

export type ProposalRateType = "FIXED" | "FLOATING" | null;

export interface RateProposal {
    /** Stable for the whole review (never the row's position). */
    key: string;
    /** What the statement printed - shown as evidence, never edited. */
    evidence: {
        effectiveDate: string | null;
        rate: number;
        previousRate: number | null;
        page: number;
        raw: string;
        origin: "TABLE" | "TEXT";
        datesInText: string[];
    };
    /** "" while unknown. */
    effectiveDate: string;
    /** False while the date is missing or ambiguous and the customer has not chosen it. */
    dateConfirmed: boolean;
    rate: number | null;
    rateType: ProposalRateType;
    /** The rate type is the statement's general interest type (not this line's). */
    rateTypeFromStatement: boolean;
    /** Left out: never saved. */
    included: boolean;
    /** Left out automatically: the same date and rate as this other proposal. */
    duplicateOf: string | null;
    /** Changed by the customer. */
    edited: boolean;
}

export interface StatementRateReview {
    proposals: RateProposal[];
    /** The rate from the loan's start date (recorded as the original rate). */
    originalRate: number | null;
    /** STATEMENT: the earliest change's printed previous rate. */
    originalRateFrom: "STATEMENT" | "MANUAL" | null;
}

export interface RateIssue {
    /** A proposal's key, "original", or null for the whole list. */
    key: string | null;
    message: string;
}

export interface RateReviewResult {
    /** Stop the save until resolved. */
    blocking: RateIssue[];
    /** Shown; the customer decides. */
    warnings: RateIssue[];
}

/** What the loan to be saved says, when known (the review alone does not know it). */
export interface RateLoanContext {
    loanKind: LoanKind;
    startDate: string | null;
    /** The loan's own interest rate (Term: what its schedule starts from; OD: its rate today). */
    loanRate: number | null;
    today: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: string): boolean {
    if (!ISO.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isRate(value: number | null): value is number {
    return value !== null && Number.isFinite(value) && value >= 0 && value <= 100;
}

function rateText(value: number): string {
    return `${Number(value.toFixed(4))}%`;
}

function dateText(iso: string): string {
    return isIsoDate(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso;
}

/** The statement's general interest type, as a default for every line (labelled as such). */
export function rateTypeFromInterestText(text: string | null | undefined): ProposalRateType {
    if (!text) return null;
    if (/float|variable|mclr|rllr|eblr|plr|repo|benchmark/i.test(text)) return "FLOATING";
    if (/fixed/i.test(text)) return "FIXED";
    return null;
}

function byDate(a: RateProposal, b: RateProposal): number {
    return (a.effectiveDate || "9999-99-99").localeCompare(b.effectiveDate || "9999-99-99") || a.key.localeCompare(b.key, undefined, { numeric: true });
}

/** The included proposals, in the order they take effect (undated last). */
export function chronological(review: StatementRateReview): RateProposal[] {
    return review.proposals.filter(proposal => proposal.included).sort(byDate);
}

function originalFrom(proposals: readonly RateProposal[]): number | null {
    const earliest = proposals.filter(proposal => proposal.included && proposal.effectiveDate).sort(byDate)[0];
    return earliest?.evidence.previousRate ?? null;
}

/** The review's starting point from the engine's extraction. */
export function rateReviewFromFacility(facility: Pick<FacilityExtraction, "rateHistory">, interestTypeText?: string | null): StatementRateReview {
    const defaultType = rateTypeFromInterestText(interestTypeText);
    const proposals: RateProposal[] = [];

    facility.rateHistory.forEach((change: RateChange, index) => {
        const date = change.effectiveDate ?? "";
        const ambiguous = (change.datesInText ?? []).length > 1;
        const duplicate = date ? proposals.find(other => other.included && other.effectiveDate === date && other.rate === change.rate) : undefined;

        proposals.push({
            key: `r-${index}`,
            evidence: {
                effectiveDate: change.effectiveDate,
                rate: change.rate,
                previousRate: change.previousRate,
                page: change.page,
                raw: change.raw,
                origin: change.origin ?? "TEXT",
                datesInText: change.datesInText ?? [],
            },
            effectiveDate: date,
            dateConfirmed: date !== "" && !ambiguous,
            rate: change.rate,
            rateType: defaultType,
            rateTypeFromStatement: defaultType !== null,
            included: duplicate === undefined,
            duplicateOf: duplicate?.key ?? null,
            edited: false,
        });
    });

    const originalRate = originalFrom(proposals);
    return { proposals, originalRate, originalRateFrom: originalRate === null ? null : "STATEMENT" };
}

export function hasRateProposals(review: StatementRateReview | null | undefined): review is StatementRateReview {
    return Boolean(review && review.proposals.length > 0);
}

// ------------------------------------------------------------ corrections

export type ProposalChange = Partial<Pick<RateProposal, "effectiveDate" | "rate" | "rateType" | "included">>;

/** The customer's correction of one proposal. Entering a date resolves it; including a duplicate again un-marks it. */
export function updateRateProposal(review: StatementRateReview, key: string, change: ProposalChange): StatementRateReview {
    const proposals = review.proposals.map(proposal => {
        if (proposal.key !== key) return proposal;
        const next: RateProposal = { ...proposal, ...change, edited: true };
        if ("effectiveDate" in change) next.dateConfirmed = Boolean(change.effectiveDate);
        if ("rateType" in change) next.rateTypeFromStatement = false;
        if (change.included === true) next.duplicateOf = null;
        return next;
    });

    // The original rate follows the statement until the customer sets it.
    const statementOriginal = review.originalRateFrom === "MANUAL" ? review.originalRate : originalFrom(proposals);
    return {
        proposals,
        originalRate: statementOriginal,
        originalRateFrom: review.originalRateFrom === "MANUAL" ? "MANUAL" : statementOriginal === null ? null : "STATEMENT",
    };
}

/** Confirms the date the customer chose for an ambiguous or undated line. */
export function confirmProposalDate(review: StatementRateReview, key: string, date: string): StatementRateReview {
    return updateRateProposal(review, key, { effectiveDate: date });
}

export function setOriginalRate(review: StatementRateReview, rate: number | null): StatementRateReview {
    return { ...review, originalRate: rate, originalRateFrom: rate === null ? null : "MANUAL" };
}

// ------------------------------------------------------------ validation

/** The rate in force on a date: the latest change on or before it, else the original rate. */
function rateOnTimeline(original: number | null, changes: readonly RateProposal[], date: string): number | null {
    let rate = original;
    for (const change of changes) {
        if (change.effectiveDate && change.effectiveDate <= date && isRate(change.rate)) rate = change.rate;
    }
    return rate;
}

/**
 * Everything that stops the save, and what the customer should see. Without
 * a loan context only the proposals themselves are checked (Statement
 * Review); with it, also the original rate against the loan (save time).
 */
export function rateReviewIssues(review: StatementRateReview, context: RateLoanContext | null = null): RateReviewResult {
    const blocking: RateIssue[] = [];
    const warnings: RateIssue[] = [];
    const included = chronological(review);
    const start = context?.startDate && isIsoDate(context.startDate.slice(0, 10)) ? context.startDate.slice(0, 10) : null;

    for (const proposal of review.proposals) {
        if (!proposal.included && proposal.duplicateOf) {
            const kept = review.proposals.find(other => other.key === proposal.duplicateOf);
            warnings.push({ key: proposal.key, message: `The same change (${proposal.rate ?? "-"}% from ${dateText(proposal.effectiveDate)}) is printed again${kept ? ` (page ${kept.evidence.page})` : ""}; it is left out so it is recorded once.` });
        }
    }

    for (const proposal of included) {
        const issue = (message: string) => blocking.push({ key: proposal.key, message });

        if (!proposal.effectiveDate) {
            issue("The statement gives no effective date for this rate. Enter the date it applies from, or leave it out.");
        } else if (!isIsoDate(proposal.effectiveDate)) {
            issue("Enter a valid effective date.");
        } else if (!proposal.dateConfirmed) {
            issue(`The line prints more than one date (${proposal.evidence.datesInText.map(dateText).join(", ")}), so the effective date is not certain. Choose or enter the date the rate applies from.`);
        } else if (start && proposal.effectiveDate <= start) {
            issue(`This change is dated on or before the loan's start date (${dateText(start)}). The rate from the start date is the original rate - enter it there, or correct the date.`);
        }

        if (!isRate(proposal.rate)) issue("Enter the rate, from 0 to 100 (% per year).");
    }

    // Two rates on one date: a conflict the customer must resolve.
    const byDay = new Map<string, RateProposal[]>();
    for (const proposal of included.filter(item => item.effectiveDate)) byDay.set(proposal.effectiveDate, [...(byDay.get(proposal.effectiveDate) ?? []), proposal]);
    for (const [day, items] of byDay) {
        if (items.length < 2) continue;
        const rates = [...new Set(items.map(item => item.rate))];
        for (const item of items) {
            blocking.push({
                key: item.key,
                message:
                    rates.length > 1
                        ? `Conflicting rates are dated ${dateText(day)} (${rates.map(rate => (rate === null ? "-" : rateText(rate))).join(" and ")}). Correct the date or rate, or leave one out.`
                        : `This change is listed twice on ${dateText(day)}. Leave one out.`,
            });
        }
    }

    if (included.length > 0) {
        if (!isRate(review.originalRate)) {
            blocking.push({
                key: "original",
                message: "The rate from the loan's start date is not stated (no rate before the first change is printed). Enter it - it is recorded as the loan's original rate.",
            });
        }

        // Each change against the rate before it (the timeline in date order).
        let before = isRate(review.originalRate) ? review.originalRate : null;
        for (const proposal of included.filter(item => item.effectiveDate && isRate(item.rate))) {
            if (before !== null && proposal.rate === before) {
                blocking.push({ key: proposal.key, message: `${rateText(before)} is already the rate before ${dateText(proposal.effectiveDate)}, so nothing changes. Correct the rate or leave it out.` });
            }
            if (proposal.evidence.previousRate !== null && before !== null && proposal.evidence.previousRate !== before) {
                warnings.push({
                    key: proposal.key,
                    message: `The statement says the rate before this change was ${rateText(proposal.evidence.previousRate)}, but the rates above give ${rateText(before)}. Check both.`,
                });
            }
            before = proposal.rate;
        }

        if (context && isRate(review.originalRate) && context.loanRate !== null) {
            if (context.loanKind === LoanKind.TERM_LOAN && context.loanRate !== review.originalRate) {
                blocking.push({
                    key: "original",
                    message: `The loan's interest rate (${rateText(context.loanRate)}) is the rate its schedule starts from, but the original rate here is ${rateText(review.originalRate)}. They must match: correct the loan's interest rate or the original rate.`,
                });
            }
            if (context.loanKind === LoanKind.OVERDRAFT) {
                const inForce = rateOnTimeline(review.originalRate, included, context.today);
                if (inForce !== null && inForce !== context.loanRate) {
                    blocking.push({
                        key: "original",
                        message: `The rate changes put the rate in force today (${dateText(context.today)}) at ${rateText(inForce)}, but the loan's interest rate is ${rateText(context.loanRate)}. Correct one of them.`,
                    });
                }
            }
        }
    }

    return { blocking, warnings };
}

// ------------------------------------------------------------ what is saved

export interface ConfirmedRateChange {
    key: string;
    effectiveFrom: string;
    rate: number;
    rateType: ProposalRateType;
    /** File and page, for the history row's reference. */
    reference: string;
    /** The statement line, kept as the evidence. */
    notes: string;
}

export interface ConfirmedStatementRates {
    originalRate: number;
    /** In date order. */
    changes: ConfirmedRateChange[];
}

function evidenceNotes(proposal: RateProposal): string {
    const line = proposal.evidence.raw.replace(/\s+/g, " ").trim().slice(0, 480);
    return proposal.edited ? `From the lender statement (corrected on review): "${line}"` : `From the lender statement: "${line}"`;
}

/** The confirmed history to save, in date order - or why there can be none. */
export function confirmedStatementRates(review: StatementRateReview, context: RateLoanContext, fileName: string): ConfirmedStatementRates {
    const { blocking } = rateReviewIssues(review, context);
    if (blocking.length > 0) throw new Error(blocking[0]!.message);

    return {
        originalRate: review.originalRate!,
        changes: chronological(review).map(proposal => ({
            key: proposal.key,
            effectiveFrom: proposal.effectiveDate,
            rate: proposal.rate!,
            rateType: proposal.rateType,
            reference: `${fileName}, page ${proposal.evidence.page}`.slice(0, 200),
            notes: evidenceNotes(proposal),
        })),
    };
}

/** OD / CC / DOD: the history create_loan_atomic writes with the loan. */
export function overdraftStatementRateHistory(confirmed: ConfirmedStatementRates): NonNullable<CreateLoanRequest["statementRateHistory"]> {
    return {
        originalRate: confirmed.originalRate,
        changes: confirmed.changes.map(change => ({ effectiveFrom: change.effectiveFrom, rate: change.rate, rateType: change.rateType, reference: change.reference, notes: change.notes })),
    };
}

/**
 * OD / CC / DOD save: the statement history to send with the loan, or null
 * when the customer has left out EVERY change. Then nothing from the
 * statement is recorded - no history entry is invented - and the loan is
 * created exactly as a typed-in one, at its own rate from its start date.
 * Any blocking issue still refuses (pre-activation audit M1).
 */
export function overdraftStatementRateHistoryFor(review: StatementRateReview, context: RateLoanContext, fileName: string): NonNullable<CreateLoanRequest["statementRateHistory"]> | null {
    const confirmed = confirmedStatementRates(review, context, fileName);
    return confirmed.changes.length === 0 ? null : overdraftStatementRateHistory(confirmed);
}

export type FollowUpStatus = "PENDING" | "RECORDED" | "SKIPPED";

/**
 * Term Loan follow-up: the changes are recorded strictly in date order, so
 * only the earliest pending one can be recorded or skipped next.
 */
export function followUpProgress(changes: readonly ConfirmedRateChange[], statuses: Readonly<Record<string, FollowUpStatus>>): { next: ConfirmedRateChange | null; pending: number; recorded: number; skipped: number } {
    const status = (change: ConfirmedRateChange) => statuses[change.key] ?? "PENDING";
    return {
        next: changes.find(change => status(change) === "PENDING") ?? null,
        pending: changes.filter(change => status(change) === "PENDING").length,
        recorded: changes.filter(change => status(change) === "RECORDED").length,
        skipped: changes.filter(change => status(change) === "SKIPPED").length,
    };
}

/**
 * Term Loan follow-up (pre-activation audit H1): every confirmed change not
 * recorded - still pending or left out ("Do not record") - in date order.
 * Leaving the follow-up with any of these asks first and lists them, and
 * the customer is told afterwards: they are NOT saved anywhere.
 */
export function unrecordedChanges(changes: readonly ConfirmedRateChange[], statuses: Readonly<Record<string, FollowUpStatus>>): ConfirmedRateChange[] {
    return changes.filter(change => (statuses[change.key] ?? "PENDING") !== "RECORDED");
}

/** One change, as listed in the warnings: "9.5% from 01/06/2025". */
export function unrecordedChangeText(change: Pick<ConfirmedRateChange, "rate" | "effectiveFrom">): string {
    return `${rateText(change.rate)} from ${dateText(change.effectiveFrom)}`;
}

/** The notice after the follow-up ends with changes left unrecorded; null when every change was recorded. */
export function unrecordedNotice(loanName: string | null, unrecorded: readonly ConfirmedRateChange[]): string | null {
    if (unrecorded.length === 0) return null;
    return (
        `${unrecorded.length} rate change(s) from the statement were NOT recorded${loanName ? ` for ${loanName}` : ""}: ${unrecorded.map(unrecordedChangeText).join("; ")}. ` +
        "They are not saved anywhere, and the loan's current rate does not include them. Record each from the loan's details (Interest rate history - Record rate change)."
    );
}

/** Term Loan: each confirmed change, prefilled for the reviewed Record Rate Change workflow. */
export function termRateChangeInputs(confirmed: ConfirmedStatementRates): Array<{ key: string; input: Partial<RateChangeInput> }> {
    return confirmed.changes.map(change => ({
        key: change.key,
        input: {
            rate: change.rate,
            effectiveFrom: change.effectiveFrom,
            rateType: change.rateType,
            source: "STATEMENT_IMPORT",
            reference: change.reference,
            notes: change.notes,
            option: null,
        },
    }));
}
