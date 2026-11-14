// ---------------------------------------------------------------------
// Interest Rate History, Stage 3: record a confirmed rate change.
//
// prepareRateChange (pure) turns the user's input and a snapshot of the
// loan into (a) the Stage 2 proposal to review and (b) the exact request
// the atomic Rust command (record_rate_change_atomic) saves. Nothing is
// written before the user confirms; the command then re-checks that the
// loan is still exactly as in the snapshot (a stale proposal is refused).
//
// Term Loans with a FinWea-generated schedule are repriced (Stage 2).
// Everything else records the rate history only, with the reason shown:
// an Overdraft / Cash Credit / Dropline (its interest is the lender's, from
// linked bank transactions), a lender CSV schedule (import the lender's
// revised schedule), flat interest, or a balloon payment.
// ---------------------------------------------------------------------

import { invoke } from "@tauri-apps/api/core";

import { InterestRateHistoryRepository } from "../repositories/InterestRateHistoryRepository";
import { LoanPaymentScheduleRepository } from "../repositories/LoanPaymentScheduleRepository";
import { LoanSchedulePaymentRepository } from "../repositories/LoanSchedulePaymentRepository";
import { localToday } from "../setup/historicalInstalments";
import { currentRateEntry as rateEntryInForce, dayBefore, rateOn, resolveRateBaseline, type RateBaseline } from "../setup/interestRateHistory";
import { LoanRepository } from "../repositories/LoanRepository";
import { proposeRateChange, type RateChangeProposal, type RecalculationOption } from "../setup/rateChangeProposal";
import { isOverdraft, type Loan, type LoanPaymentSchedule } from "../types";
import type { InterestRateHistoryEntry, InterestRateSource } from "../types/InterestRateHistory";

export const RATE_CHANGE_SOURCES = ["LENDER_NOTICE", "MANUAL", "STATEMENT_IMPORT"] as const satisfies readonly InterestRateSource[];
export type RateChangeSource = (typeof RATE_CHANGE_SOURCES)[number];

export interface RateChangeInput {
    rate: number | null;
    effectiveFrom: string;
    rateType: "FIXED" | "FLOATING" | null;
    source: RateChangeSource;
    reference: string;
    notes: string;
    /** Required for a repriced Term Loan; ignored when only the history is recorded. */
    option: RecalculationOption | null;
    /** A correction: the live entry it replaces. */
    correcting: InterestRateHistoryEntry | null;
    correctionReason: string;
}

export interface RateChangeContext {
    /** False until migration 054 is applied: nothing can be read or recorded. */
    available: boolean;
    loan: Loan;
    schedule: LoanPaymentSchedule[];
    linkedScheduleIds: string[];
    /** Live and superseded entries. */
    history: InterestRateHistoryEntry[];
}

export type RateChangeMode = { kind: "REPRICE" } | { kind: "RECORD_ONLY"; reason: string };

export interface RecordRateChangeRequest {
    loanId: string;
    expected: {
        interestRate: number;
        liveHistoryIds: string[];
        schedule: Array<{
            id: string;
            installmentNumber: number;
            dueDate: string;
            principalAmount: number;
            interestAmount: number;
            totalAmount: number;
            outstandingPrincipal: number;
            status: string;
            transactionId: string | null;
            paidAmount: number | null;
            settledBeforeFinwea: boolean;
        }>;
    };
    initialEntry: RateEntryRequest | null;
    entry: RateEntryRequest;
    supersedes: { id: string; reason: string } | null;
    schedule: {
        fromInstalment: number;
        emiAmount: number;
        rows: Array<{ id: string; installmentNumber: number; dueDate: string; principalAmount: number; interestAmount: number; totalAmount: number; outstandingPrincipal: number }>;
    } | null;
}

export interface RateEntryRequest {
    id: string;
    effectiveFrom: string;
    rate: number;
    rateType: "FIXED" | "FLOATING" | null;
    source: InterestRateSource;
    reference: string | null;
    documentId: string | null;
    notes: string | null;
    createdAt: string;
}

export interface RateChangeIssue {
    field: "rate" | "effectiveFrom" | "source" | "option" | "correctionReason" | "change";
    message: string;
}

export type PreparedRateChange =
    | {
          status: "READY";
          mode: RateChangeMode;
          proposal: RateChangeProposal | null;
          request: RecordRateChangeRequest;
          warnings: string[];
          /**
           * The rate in force just before the change takes effect (shown as
           * the old rate) - from the confirmed history, else the loan's own
           * terms; for a correction, the entry it replaces. Null only when
           * no earlier rate is known.
           */
          oldRate: number | null;
      }
    | { status: "BLOCKED"; issues: RateChangeIssue[]; warnings: string[] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: string): boolean {
    if (!ISO_DATE.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Whether FinWea reprices this loan's schedule, or records its rate history
 * only - and why. `schedule`, when given, lets a Term Loan with no
 * instalments yet be recorded only (there is nothing to reprice).
 */
export function rateChangeMode(loan: Loan, schedule?: readonly unknown[]): RateChangeMode {
    if (isOverdraft(loan)) {
        return {
            kind: "RECORD_ONLY",
            reason: "An Overdraft, Cash Credit or Dropline facility's interest is charged by the lender and linked from bank transactions. FinWea records its rate history only and never calculates its interest.",
        };
    }
    if (loan.scheduleSource === "LENDER_CSV") {
        return {
            kind: "RECORD_ONLY",
            reason: "This loan uses the lender's own schedule (CSV). FinWea does not reprice it: the rate is recorded, and the revised instalments come from the lender's revised schedule.",
        };
    }
    if (loan.interestType === "FLAT") {
        return { kind: "RECORD_ONLY", reason: "Flat-interest loans are not repriced. The rate is recorded; the schedule is not changed." };
    }
    if (Number(loan.balloonAmount ?? 0) > 0) {
        return { kind: "RECORD_ONLY", reason: "Loans with a balloon payment are not repriced yet. The rate is recorded; the schedule is not changed." };
    }
    if (schedule && schedule.length === 0) {
        return { kind: "RECORD_ONLY", reason: "This loan has no instalment schedule, so nothing is repriced. The rate is recorded." };
    }
    return { kind: "REPRICE" };
}

/**
 * A loan with no rate history whose change starts on its start date: that
 * replaces the rate the loan was recorded with (it is not a later change).
 * It is saved as the recorded rate (INITIAL) superseded by the new one,
 * with the reason - so the stored rate is never lost or overwritten.
 */
export function replacesRecordedRate(context: Pick<RateChangeContext, "loan" | "history">, input: Pick<RateChangeInput, "correcting" | "effectiveFrom">): boolean {
    return !input.correcting && context.history.length === 0 && input.effectiveFrom === context.loan.startDate.slice(0, 10);
}

/** A correction that changes neither the rate nor its date: only its details (no repricing). */
export function isDetailsOnlyCorrection(input: RateChangeInput): boolean {
    return Boolean(input.correcting && input.correcting.rate === input.rate && input.correcting.effectiveFrom === input.effectiveFrom);
}

export function validateRateChangeInput(input: RateChangeInput, loan: Loan, mode: RateChangeMode): RateChangeIssue[] {
    const issues: RateChangeIssue[] = [];
    const startDate = loan.startDate.slice(0, 10);

    if (input.rate === null || !Number.isFinite(input.rate) || input.rate < 0 || input.rate > 100) {
        issues.push({ field: "rate", message: "Enter the new rate, from 0 to 100 (% per year)." });
    }
    if (!isIsoDate(input.effectiveFrom)) {
        issues.push({ field: "effectiveFrom", message: "Enter the date the rate applies from." });
    } else if (input.effectiveFrom < startDate) {
        issues.push({ field: "effectiveFrom", message: "The rate cannot apply from before the loan started." });
    }
    if (!input.correcting && !RATE_CHANGE_SOURCES.includes(input.source)) {
        issues.push({ field: "source", message: "Choose where the rate comes from." });
    }
    if (input.correcting) {
        if (!input.correctionReason.trim()) issues.push({ field: "correctionReason", message: "Give the reason for the correction." });
        if (input.correcting.source === "INITIAL" && input.effectiveFrom !== startDate) {
            issues.push({ field: "effectiveFrom", message: "The original rate applies from the loan's start date." });
        }
    }
    if (mode.kind === "REPRICE" && !isDetailsOnlyCorrection(input) && input.option !== "PRESERVE_EMI" && input.option !== "PRESERVE_TENURE") {
        issues.push({ field: "option", message: "Choose how to recalculate: keep the EMI (the tenure changes) or keep the tenure (the EMI changes)." });
    }

    return issues;
}

function liveEntries(history: readonly InterestRateHistoryEntry[]): InterestRateHistoryEntry[] {
    return history.filter(entry => entry.supersededAt === null);
}

/**
 * The proposal to review and the request to save - or why there can be none.
 * `ids` makes it deterministic in tests; the app passes crypto.randomUUID.
 */
export function prepareRateChange(
    context: RateChangeContext,
    input: RateChangeInput,
    ids: { newId(): string; now: string } = { newId: () => crypto.randomUUID(), now: new Date().toISOString() }
): PreparedRateChange {
    if (!context.available) {
        return { status: "BLOCKED", issues: [{ field: "change", message: "Interest rate history needs a database update (migration 054) that has not been applied yet." }], warnings: [] };
    }

    const { loan } = context;
    const mode = rateChangeMode(loan, context.schedule);
    const issues = validateRateChangeInput(input, loan, mode);
    if (issues.length > 0) return { status: "BLOCKED", issues, warnings: [] };

    const live = liveEntries(context.history);
    if (input.correcting && !live.some(entry => entry.id === input.correcting!.id)) {
        return { status: "BLOCKED", issues: [{ field: "change", message: "The entry being corrected is no longer current. Reload the loan." }], warnings: [] };
    }

    // The baseline: nothing is recorded when it is missing or ambiguous.
    const baseline: RateBaseline = resolveRateBaseline(loan, context.history);
    if (baseline.kind === "UNSAFE") {
        return { status: "BLOCKED", issues: [{ field: "change", message: baseline.reason }], warnings: [] };
    }

    const rate = input.rate!;
    const replacingRecorded = baseline.kind === "LOAN_TERMS" && replacesRecordedRate(context, input);
    if (replacingRecorded && baseline.kind === "LOAN_TERMS") {
        if (rate === baseline.rate) {
            return { status: "BLOCKED", issues: [{ field: "rate", message: `${baseline.rate}% is already this loan's rate from its start date.` }], warnings: [] };
        }
        if (!input.correctionReason.trim()) {
            return {
                status: "BLOCKED",
                issues: [
                    {
                        field: "correctionReason",
                        message: `A rate from the loan's start date replaces its recorded rate (${baseline.rate}%). Give the reason; the recorded rate is kept in the correction history.`,
                    },
                ],
                warnings: [],
            };
        }
    }
    let proposal: RateChangeProposal | null = null;
    const warnings: string[] = [];

    if (mode.kind === "REPRICE" && !isDetailsOnlyCorrection(input)) {
        const result = proposeRateChange({
            loan: {
                principalAmount: loan.principalAmount,
                startDate: loan.startDate.slice(0, 10),
                interestRate: loan.interestRate,
                interestType: loan.interestType,
                interestCalculationMethod: loan.interestCalculationMethod ?? null,
                scheduleSource: loan.scheduleSource ?? null,
                paymentDay: loan.paymentDay ?? null,
                firstInstallmentAmount: loan.firstInstallmentAmount ?? null,
                balloonAmount: loan.balloonAmount ?? null,
            },
            schedule: context.schedule,
            linkedScheduleIds: context.linkedScheduleIds,
            history: live.filter(entry => entry.id !== input.correcting?.id),
            change: { effectiveFrom: input.effectiveFrom, rate },
            replaces: input.correcting
                ? { effectiveFrom: input.correcting.effectiveFrom, rate: input.correcting.rate }
                : replacingRecorded && baseline.kind === "LOAN_TERMS"
                  ? { effectiveFrom: baseline.effectiveFrom, rate: baseline.rate }
                  : null,
            option: input.option,
        });

        if (result.status === "REJECTED") {
            return { status: "BLOCKED", issues: result.errors.map(message => ({ field: "change" as const, message })), warnings: result.warnings };
        }
        proposal = result;
        warnings.push(...result.warnings);
    } else if (!input.correcting && !replacingRecorded) {
        // Recorded only: still refuse what the database would.
        const sameDay = live.find(entry => entry.effectiveFrom === input.effectiveFrom);
        if (sameDay) {
            return {
                status: "BLOCKED",
                issues: [{ field: "effectiveFrom", message: sameDay.rate === rate ? "This rate is already recorded from that date." : `${sameDay.rate}% is already recorded from that date. Correct that entry instead.` }],
                warnings: [],
            };
        }
    }

    const existingIds = new Map(context.schedule.map(row => [row.installmentNumber, row.id]));
    const correctsInitial = input.correcting?.source === "INITIAL" || replacingRecorded;
    const initialId = baseline.kind === "LOAN_TERMS" ? ids.newId() : null;

    const request: RecordRateChangeRequest = {
        loanId: loan.id,
        expected: {
            interestRate: loan.interestRate,
            liveHistoryIds: live.map(entry => entry.id),
            schedule: context.schedule.map(row => ({
                id: row.id,
                installmentNumber: row.installmentNumber,
                dueDate: row.dueDate.slice(0, 10),
                principalAmount: row.principalAmount,
                interestAmount: row.interestAmount,
                totalAmount: row.totalAmount,
                outstandingPrincipal: row.outstandingPrincipal,
                status: row.status,
                transactionId: row.transactionId ?? null,
                paidAmount: row.paidAmount ?? null,
                settledBeforeFinwea: row.settledBeforeFinwea === true,
            })),
        },
        // A loan with no history: its original rate is recorded first, from
        // its own terms, in the same transaction - never before this change.
        initialEntry:
            baseline.kind === "LOAN_TERMS" && initialId
                ? {
                      id: initialId,
                      effectiveFrom: baseline.effectiveFrom,
                      rate: baseline.rate,
                      rateType: baseline.rateType,
                      source: "INITIAL",
                      reference: null,
                      documentId: null,
                      notes: null,
                      createdAt: ids.now,
                  }
                : null,
        entry: {
            id: ids.newId(),
            effectiveFrom: input.effectiveFrom,
            rate,
            rateType: input.rateType,
            source: correctsInitial ? "INITIAL" : input.source,
            reference: input.reference.trim() || null,
            documentId: null,
            notes: input.notes.trim() || null,
            createdAt: ids.now,
        },
        supersedes: input.correcting
            ? { id: input.correcting.id, reason: input.correctionReason.trim() }
            : replacingRecorded && initialId
              ? { id: initialId, reason: input.correctionReason.trim() }
              : null,
        schedule: proposal
            ? {
                  fromInstalment: proposal.recalculatedFromInstalment,
                  emiAmount: proposal.proposedEmis[0]!,
                  rows: proposal.proposedInstalments.map(row => ({
                      id: existingIds.get(row.installmentNumber) ?? ids.newId(),
                      installmentNumber: row.installmentNumber,
                      dueDate: row.dueDate,
                      principalAmount: row.principalAmount,
                      interestAmount: row.interestAmount,
                      totalAmount: row.totalAmount,
                      outstandingPrincipal: row.outstandingPrincipal,
                  })),
              }
            : null,
    };

    return { status: "READY", mode, proposal, request, warnings, oldRate: proposal ? proposal.change.oldRate : rateBeforeChange(live, input, baseline, replacingRecorded) };
}

/**
 * The old rate of a change that is recorded only (no schedule proposal):
 * the same rule as the previous rate the save stores - the latest live
 * entry starting before the change's date (the entry being corrected left
 * out), else the loan's own terms when it has no history yet. A first
 * change from the start date replaces that recorded rate, so it is the old
 * one; a correction's old rate is the entry it replaces.
 */
export function rateBeforeChange(
    live: readonly InterestRateHistoryEntry[],
    input: Pick<RateChangeInput, "effectiveFrom" | "correcting">,
    baseline: RateBaseline,
    replacingRecorded: boolean
): number | null {
    if (input.correcting) return input.correcting.rate;
    if (baseline.kind === "LOAN_TERMS") {
        return replacingRecorded || baseline.effectiveFrom < input.effectiveFrom ? baseline.rate : null;
    }
    return rateOn(live, dayBefore(input.effectiveFrom))?.rate ?? null;
}

/** The rate in force today from live history; null when nothing is recorded (the one rule: setup/interestRateHistory). */
export function currentRateEntry(history: readonly InterestRateHistoryEntry[], today: string = localToday()): InterestRateHistoryEntry | null {
    return rateEntryInForce(history, today);
}

const REFUSED = "RATE_CHANGE_REFUSED: ";

export class InterestRateChangeService {
    private readonly loans = new LoanRepository();
    private readonly history = new InterestRateHistoryRepository();
    private readonly schedules = new LoanPaymentScheduleRepository();
    private readonly payments = new LoanSchedulePaymentRepository();

    /**
     * Always from the database: the screen's loan object can predate the
     * last save (its stored rate, tenure, EMI), and a proposal made from it
     * would only be refused by the save's stale check. The given loan is a
     * fallback only when it can no longer be read.
     */
    async loadContext(screenLoan: Loan): Promise<RateChangeContext> {
        const loan = (await this.loans.getById(screenLoan.id)) ?? screenLoan;
        const available = await this.history.isAvailable();
        const [history, schedule, payments] = await Promise.all([
            available ? this.history.findByLoan(loan.id, { includeSuperseded: true }) : Promise.resolve([]),
            isOverdraft(loan) ? Promise.resolve([]) : this.schedules.getAllByLoanId(loan.id),
            isOverdraft(loan) ? Promise.resolve([]) : this.payments.getAllByLoanId(loan.id),
        ]);

        return { available, loan, schedule, linkedScheduleIds: [...new Set(payments.map(payment => payment.scheduleId))], history };
    }

    /** One atomic save; a refusal comes back as its plain message. */
    async save(request: RecordRateChangeRequest): Promise<void> {
        try {
            await invoke("record_rate_change_atomic", { request });
        } catch (error) {
            const text = String(error instanceof Error ? error.message : error);
            const match = text.match(/RATE_CHANGE_REFUSED: (.*)$/s);
            throw new Error(match ? match[1] : text.replace(REFUSED, ""));
        }
    }
}
