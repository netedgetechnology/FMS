// ---------------------------------------------------------------------
// Term Loan from a lender statement, saved straight from Statement Review
// (no second pass through the Add Loan wizard).
//
// The statement review stays the single source of every figure the PDF
// gives; `reviewToDraft` turns it into the loan setup draft exactly as
// before. On top of it the customer adds ONLY what a statement cannot
// know - the loan's name, the bank accounts, links to existing bank
// transactions, the schedule source and the historical instalments. Those
// live in `StatementCompletion` and can never overwrite a statement value.
// Validation, the duplicate check and the atomic save are the wizard's
// own (validateStep / duplicateLoanIssues / draftToCreateRequest).
// ---------------------------------------------------------------------

import { duplicateLoanIssues, emptyLoanSetupDraft, validateStep } from "../setup/loanSetupWizard";
import { localToday } from "../setup/historicalInstalments";
import type { ExpenseSettlement, InterestMethod, LinkedTransactionSummary, LoanSetupDraft, SetupIssue } from "../setup/loanSetupTypes";
import { LoanKind } from "../types";

import { reviewBlockers, routeForType, setConfirmed, type StatementReviewState } from "./statementReview";
import { reviewToDraft, type StatementDraftResult } from "./statementToDraft";

/** A disbursement row's bank side - keyed by the row's stable key, never its position. */
export interface DisbursementCompletion {
    destinationAccountId: string;
    transaction: LinkedTransactionSummary | null;
}

/** How a charge was paid - keyed by the charge's stable key. */
export interface ChargeCompletion {
    settlement: Extract<ExpenseSettlement, "DEDUCTED_FROM_DISBURSEMENT" | "PAID_SEPARATELY">;
    /** Paid separately only: the bank account and its existing debit. */
    paymentAccountId: string;
    transaction: LinkedTransactionSummary | null;
}

/** What the customer adds on Statement Review - never a statement figure. */
export interface StatementCompletion {
    name: string;
    /** null = the statement's product name. */
    loanCategory: string | null;
    currencyId: string;
    linkedAccountId: string;
    /** null = what the statement implies (flat or reducing). */
    interestMethod: InterestMethod | null;
    /** By disbursement row key (see statementToDraft). */
    disbursements: Record<string, DisbursementCompletion>;
    /** By charge key; a charge with no entry keeps the statement's settlement. */
    charges: Record<string, ChargeCompletion>;
    scheduleMethod: LoanSetupDraft["scheduleMethod"];
    lenderSchedule: LoanSetupDraft["lenderSchedule"];
    historicalCount: number;
    historical: LoanSetupDraft["historical"];
    // Additional Loan Details - optional, and never given by a statement.
    purpose: string;
    paymentDay: number | null;
    gracePeriodMonths: number | null;
    balloonAmount: number | null;
    firstInstallmentAmount: number | null;
}

export function emptyStatementCompletion(): StatementCompletion {
    return {
        name: "",
        loanCategory: null,
        currencyId: "",
        linkedAccountId: "",
        interestMethod: null,
        disbursements: {},
        charges: {},
        scheduleMethod: "GENERATED",
        lenderSchedule: null,
        historicalCount: 0,
        historical: [],
        purpose: "",
        paymentDay: null,
        gracePeriodMonths: null,
        balloonAmount: null,
        firstInstallmentAmount: null,
    };
}

/** The Additional Loan Details: optional, and no statement ever gives them. */
export const ADDITIONAL_DETAIL_KEYS = ["purpose", "paymentDay", "gracePeriodMonths", "balloonAmount", "firstInstallmentAmount"] as const;

/**
 * The draft keys the reused setup components (schedule, historical
 * instalments) may change. Any other key they send is ignored, so a
 * statement figure is only ever changed on the review itself.
 */
const COMPLETION_KEYS = [
    "name",
    "loanCategory",
    "currencyId",
    "linkedAccountId",
    "interestMethod",
    "scheduleMethod",
    "lenderSchedule",
    "historicalCount",
    "historical",
    ...ADDITIONAL_DETAIL_KEYS,
] as const;

/** Applies a change made through the setup components to the completion. */
export function applyCompletionChange(completion: StatementCompletion, change: Partial<LoanSetupDraft>): StatementCompletion {
    const next = { ...completion };

    for (const key of COMPLETION_KEYS) {
        if (key in change) (next as Record<string, unknown>)[key] = change[key];
    }

    if ("disbursements" in change && change.disbursements) {
        next.disbursements = { ...completion.disbursements };
        for (const row of change.disbursements) {
            next.disbursements[row.key] = { destinationAccountId: row.destinationAccountId, transaction: row.transaction };
        }
    }

    return next;
}

/** Sets one disbursement row's bank side, by its key. */
export function setDisbursementCompletion(completion: StatementCompletion, key: string, value: DisbursementCompletion): StatementCompletion {
    return { ...completion, disbursements: { ...completion.disbursements, [key]: value } };
}

/** Sets how one charge was paid, by its key. */
export function setChargeCompletion(completion: StatementCompletion, key: string, value: ChargeCompletion): StatementCompletion {
    return { ...completion, charges: { ...completion.charges, [key]: value } };
}

/** True when this review is saved directly from Statement Review. */
export function savesDirectly(state: StatementReviewState): boolean {
    if (state.selectedType === null) return false;
    const route = routeForType(state.selectedType, state.droplineEnabled);
    return route.kind === "WIZARD" && route.loanKind === LoanKind.TERM_LOAN;
}

export type StatementLoan =
    | { status: "READY"; result: StatementDraftResult; draft: LoanSetupDraft }
    | { status: "BLOCKED"; blockers: string[] };

/**
 * The loan to be saved: the reviewed statement, plus the customer's
 * completion. The review's own confirmation tick is replaced by the single
 * final confirmation, so it is not required here - every other blocker
 * (an unconfirmed type, a conflict) still is.
 */
export function statementLoanDraft(state: StatementReviewState, completion: StatementCompletion): StatementLoan {
    const reviewed = setConfirmed(state, true);
    const blockers = reviewBlockers(reviewed);
    if (blockers.length > 0) return { status: "BLOCKED", blockers };

    const result = reviewToDraft(reviewed);
    const base = { ...emptyLoanSetupDraft(result.draft.loanKind), ...result.draft } as LoanSetupDraft;

    const draft: LoanSetupDraft = {
        ...base,
        name: completion.name,
        loanCategory: completion.loanCategory ?? base.loanCategory,
        currencyId: completion.currencyId || base.currencyId,
        linkedAccountId: completion.linkedAccountId,
        interestMethod: completion.interestMethod ?? base.interestMethod,
        disbursements: base.disbursements.map(row => ({
            ...row,
            destinationAccountId: completion.disbursements[row.key]?.destinationAccountId ?? "",
            transaction: completion.disbursements[row.key]?.transaction ?? null,
        })),
        expenses: base.expenses.map(expense => {
            const chosen = completion.charges[expense.key];
            if (!chosen) return expense;

            return chosen.settlement === "PAID_SEPARATELY"
                ? { ...expense, settlement: "PAID_SEPARATELY", disbursementKey: null, paymentAccountId: chosen.paymentAccountId, transaction: chosen.transaction }
                : {
                      ...expense,
                      settlement: "DEDUCTED_FROM_DISBURSEMENT",
                      disbursementKey: expense.disbursementKey ?? base.disbursements[0]?.key ?? null,
                      paymentAccountId: "",
                      transaction: null,
                  };
        }),
        scheduleMethod: completion.scheduleMethod,
        lenderSchedule: completion.lenderSchedule,
        historicalCount: completion.historicalCount,
        historical: completion.historical,
        purpose: completion.purpose,
        paymentDay: completion.paymentDay,
        gracePeriodMonths: completion.gracePeriodMonths,
        balloonAmount: completion.balloonAmount,
        firstInstallmentAmount: completion.firstInstallmentAmount,
    };

    return { status: "READY", result, draft };
}

/** Everything that stops the save: the wizard's full validation, plus the duplicate check. */
export function statementSaveIssues(
    draft: LoanSetupDraft,
    existingLoans: Parameters<typeof duplicateLoanIssues>[1],
    today: string = localToday()
): SetupIssue[] {
    return [...duplicateLoanIssues(draft, existingLoans), ...validateStep(draft, "review", today)];
}
