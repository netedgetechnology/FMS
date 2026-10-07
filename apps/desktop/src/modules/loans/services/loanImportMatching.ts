import {
    isRawNarrationPayee,
    learningKeyForCandidate,
} from "@/modules/imports/services/learningKey";

import type {
    Loan,
    LoanPaymentSchedule,
    LoanSchedulePayment,
} from "../types";
import { LoanPaymentStatus } from "../types/LoanPaymentStatus";
import { LoanStatus } from "../types/LoanStatus";

// ---------------------------------------------------------------------
// Automatic loan EMI matching for imported statement transactions -
// the pure decision. Given one transaction a confirmed import has just
// created and the current state of every loan, decides whether it is
// confidently one loan's EMI payment and which instalment it pays.
// Nothing here reads or writes the database; LoanImportPaymentService
// loads the state and applies an "apply" decision through
// LoanPaymentService (the same rules as a manual payment).
//
// WHICH LOAN. A loan is a candidate when the transaction is an outgoing
// expense from the loan's own EMI payment account and EITHER
//   - it has the same payment signature as a transaction already linked
//     to the loan's payments (see sameSignature) - what the user taught
//     by linking a transaction by hand, or an earlier automatic match;
//   - or its payee / counterparty / narration names the loan or its
//     lender (every distinctive word of the name).
// The signature is the account, the direction, the narration pattern -
// the very Self-Learning key of the import's learned rules
// (learningKeyForCandidate) - and, when both sides have one, the payment
// type, payee and counterparty. The AMOUNT is never part of it: it does
// not say which loan a debit belongs to, only whether it is a payment
// the instalment can take. Exactly ONE candidate is required - never a
// guess between several.
//
// WHICH AMOUNT. No tolerance of any kind: lenders round, truncate or
// adjust EMIs differently, so FinWea never assumes a small difference is
// rounding. The debit is applied to the loan's earliest unpaid
// instalment only when
//   - it is exactly what remains on it (paise for paise), or
//   - the user has already said, for a debit with this same signature
//     and this same amount, that it settles an instalment of this same
//     scheduled amount in full (a lender whose real debit differs from
//     the calculated EMI) - the same settlement is then applied again,
//     and the difference stays recorded on the instalment.
// Anything else - a smaller amount, a larger one, a different one - is
// left for review and can be linked by hand (Transactions -> Link to
// Loan EMI), where full / partial / settlement is chosen explicitly.
//
// WHICH INSTALMENT. Only the instalment the debit is for - the one whose
// due date is nearest the debit's date - can be paid automatically, and
// only when it is also the loan's earliest unpaid instalment. An earlier
// instalment that is still unpaid is never skipped and never silently
// paid with a later month's debit: the debit goes to review until that
// earlier instalment has been dealt with. A debit nearest an instalment
// that is already paid, or with no instalment due within
// DUE_DATE_WINDOW_DAYS, goes to review too.
//
// Also refused for review: a debit that a manually recorded payment of
// this loan already covers (same amount within a few days - it would
// pay twice).
// ---------------------------------------------------------------------

/** Tolerance for comparing money amounts held as REAL - float noise only, never rounding. */
const MONEY_EPSILON = 0.005;

/**
 * A manually recorded payment within this many days of a statement debit
 * of the same amount is taken to be that same real payment.
 */
export const MANUAL_PAYMENT_MATCH_WINDOW_DAYS = 7;

/**
 * A debit is only taken to be an instalment's payment when that
 * instalment is due within this many days of it - never an advance
 * payment of a far-off EMI, nor a payment long after the schedule ends.
 */
export const DUE_DATE_WINDOW_DAYS = 45;

// Words that say what kind of lender or loan it is, never which one -
// they never identify a loan by themselves.
const GENERIC_WORDS = new Set([
    "and", "of", "the", "for",
    "bank", "banking", "capital", "finance", "financial", "finserv",
    "fincorp", "credit", "limited", "ltd", "pvt", "private", "co",
    "company", "corp", "corporation", "inc", "llp", "services",
    "service", "india", "loan", "loans", "emi", "home", "housing",
    "personal", "car", "auto", "vehicle", "two", "wheeler", "gold",
    "education", "business", "mortgage", "term", "card", "account",
]);

export interface LoanMatchTransaction {
    id: string;
    accountId: string;
    type: string;
    amount: number;
    transactionDate: string;
    payee: string | null;
    counterparty?: string | null;
    originalNarration?: string | null;
    /** The payment type detected or chosen (UPI / EMANDATE / ...). */
    transactionType?: string | null;
    paymentMethod?: string | null;
}

/** A payment already recorded against the loan, with its transaction. */
export interface LoanMatchPayment extends LoanSchedulePayment {
    /**
     * The payment's transaction (null when it no longer exists) - with
     * whether it came from a statement.
     */
    transaction: (LoanMatchTransaction & { isImported: boolean }) | null;
}

export interface LoanMatchState {
    loan: Loan;
    lenderName: string | null;
    schedule: LoanPaymentSchedule[];
    payments: LoanMatchPayment[];
}

export type LoanImportDecision =
    | {
          kind: "apply";
          loanId: string;
          scheduleId: string;
          installmentNumber: number;
          amount: number;
          fullyPaysInstallment: boolean;
          /**
           * Settles the instalment in full for less than its scheduled
           * amount - only ever repeating a settlement the user made.
           */
          settlesInstallment: boolean;
      }
    | {
          kind: "review";
          loanIds: string[];
          reason: string;
      }
    | { kind: "none" };

function words(text: string | null | undefined): string[] {
    return (text ?? "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(word => word.length > 0);
}

function distinctiveWords(name: string | null | undefined): string[] {
    return words(name).filter(
        word =>
            word.length >= 2 &&
            !/^\d+$/.test(word) &&
            !GENERIC_WORDS.has(word)
    );
}

function dayNumber(isoDate: string): number {
    return Math.floor(Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`) / 86_400_000);
}

function roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sameMoney(a: number, b: number): boolean {
    return Math.abs(a - b) < MONEY_EPSILON;
}

function money(value: number): string {
    return value.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function normalizedText(value: string | null | undefined): string {
    return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

// Two values agree unless BOTH are present and differ - a value missing
// on one side is no evidence either way.
function compatible(
    a: string | null | undefined,
    b: string | null | undefined
): boolean {
    const left = normalizedText(a);
    const right = normalizedText(b);

    return left === "" || right === "" || left === right;
}

// A payee that is only the bank narration (what an import stores when no
// payee was learned yet) names nobody - as in Self-Learning.
function chosenPayee(transaction: LoanMatchTransaction): string | null {
    return isRawNarrationPayee(transaction.payee, transaction.originalNarration)
        ? null
        : transaction.payee;
}

/** The narration-pattern + direction key Self-Learning uses for this transaction. */
function signatureKey(transaction: LoanMatchTransaction): string | null {
    if (transaction.type !== "expense" && transaction.type !== "income") {
        return null;
    }

    return learningKeyForCandidate({
        description: transaction.originalNarration ?? "",
        type: transaction.type,
    });
}

/**
 * Whether two transactions are the same recurring payment: same account,
 * same direction and narration pattern (the Self-Learning key - digits
 * such as mandate / reference numbers collapsed), and no conflicting
 * payment type, payee or counterparty. The amount plays no part.
 */
export function sameSignature(
    transaction: LoanMatchTransaction,
    learned: LoanMatchTransaction
): boolean {
    const key = signatureKey(transaction);

    return (
        key !== null &&
        transaction.accountId === learned.accountId &&
        key === signatureKey(learned) &&
        compatible(
            transaction.transactionType ?? transaction.paymentMethod,
            learned.transactionType ?? learned.paymentMethod
        ) &&
        compatible(chosenPayee(transaction), chosenPayee(learned)) &&
        compatible(transaction.counterparty, learned.counterparty)
    );
}

/** The loan's payments whose transaction has the same signature as this one. */
function learnedPayments(
    transaction: LoanMatchTransaction,
    state: LoanMatchState
): LoanMatchPayment[] {
    return state.payments.filter(
        payment =>
            payment.transaction !== null &&
            payment.transaction.id !== transaction.id &&
            sameSignature(transaction, payment.transaction)
    );
}

/**
 * Whether the transaction's own text names this loan: every distinctive
 * word of the loan's name, or of its lender's name, is in its payee /
 * counterparty / narration (as a word, or - for a word of 4+ letters -
 * run together with others, as bank narrations often are).
 */
export function transactionNamesLoan(
    transaction: LoanMatchTransaction,
    state: LoanMatchState
): boolean {
    const texts = [
        transaction.payee,
        transaction.counterparty,
        transaction.originalNarration,
    ];
    const textWords = new Set(texts.flatMap(words));
    const compact = texts
        .map(text => (text ?? "").toLowerCase().replace(/[^a-z0-9]/g, ""))
        .join(" ");

    return [state.loan.name, state.lenderName].some(name => {
        const required = distinctiveWords(name);

        return (
            required.length > 0 &&
            required.every(
                word =>
                    textWords.has(word) ||
                    (word.length >= 4 && compact.includes(word))
            )
        );
    });
}

/**
 * Whether the transaction identifies this loan: it has the signature of
 * a transaction already linked to the loan, or it names the loan.
 */
export function transactionIdentifiesLoan(
    transaction: LoanMatchTransaction,
    state: LoanMatchState
): boolean {
    return (
        learnedPayments(transaction, state).length > 0 ||
        transactionNamesLoan(transaction, state)
    );
}

/** What remains unpaid on each not-yet-PAID instalment, by the payment ledger. */
export function unpaidInstallments(
    state: Pick<LoanMatchState, "schedule" | "payments">
): Array<{ schedule: LoanPaymentSchedule; paid: number; remaining: number }> {
    return [...state.schedule]
        .filter(row => row.status !== LoanPaymentStatus.PAID)
        .sort((a, b) => a.installmentNumber - b.installmentNumber)
        .map(schedule => {
            const paid = roundMoney(
                state.payments
                    .filter(payment => payment.scheduleId === schedule.id)
                    .reduce((sum, payment) => sum + payment.amount, 0)
            );

            return {
                schedule,
                paid,
                remaining: roundMoney(Math.max(0, schedule.totalAmount - paid)),
            };
        })
        .filter(item => item.remaining > 0);
}

/**
 * Whether the user has already settled, in full, an instalment of the
 * same scheduled amount with a debit of this signature and this exact
 * amount - the only case in which a debit below the scheduled EMI is
 * applied automatically.
 */
function repeatsUserSettlement(
    transaction: LoanMatchTransaction,
    state: LoanMatchState,
    next: { schedule: LoanPaymentSchedule; paid: number }
): boolean {
    if (next.paid > 0) {
        return false;
    }

    return learnedPayments(transaction, state).some(payment => {
        const settled = state.schedule.find(row => row.id === payment.scheduleId);

        return (
            payment.settlesInstallment &&
            sameMoney(payment.amount, transaction.amount) &&
            settled !== undefined &&
            sameMoney(settled.totalAmount, next.schedule.totalAmount)
        );
    });
}

/**
 * The instalment a debit on this date is for: the one whose due date is
 * nearest it (the earlier one on a tie), whatever its status.
 */
export function installmentDueFor(
    transaction: Pick<LoanMatchTransaction, "transactionDate">,
    state: Pick<LoanMatchState, "schedule">
): LoanPaymentSchedule | null {
    const debitDay = dayNumber(transaction.transactionDate);
    let nearest: LoanPaymentSchedule | null = null;

    for (const row of state.schedule) {
        const distance = Math.abs(dayNumber(row.dueDate) - debitDay);
        const best = nearest
            ? Math.abs(dayNumber(nearest.dueDate) - debitDay)
            : Infinity;

        if (
            distance < best ||
            (distance === best && nearest && row.installmentNumber < nearest.installmentNumber)
        ) {
            nearest = row;
        }
    }

    return nearest;
}

export function decideLoanPaymentForTransaction(
    transaction: LoanMatchTransaction,
    loans: readonly LoanMatchState[]
): LoanImportDecision {
    // Outgoing money only - a credit (refund, disbursement, reversal) is
    // never an EMI payment.
    if (transaction.type !== "expense" || !(transaction.amount > 0)) {
        return { kind: "none" };
    }

    const candidates = loans.filter(
        state =>
            state.loan.status !== LoanStatus.CLOSED &&
            state.loan.accountId !== null &&
            state.loan.accountId === transaction.accountId &&
            transactionIdentifiesLoan(transaction, state)
    );

    if (candidates.length === 0) {
        return { kind: "none" };
    }

    const loanIds = candidates.map(state => state.loan.id);

    if (candidates.length > 1) {
        return {
            kind: "review",
            loanIds,
            reason: `It could belong to more than one loan (${candidates
                .map(state => state.loan.name)
                .join(", ")}), so it was not applied to any.`,
        };
    }

    const state = candidates[0]!;
    const amount = roundMoney(transaction.amount);
    const debitDay = dayNumber(transaction.transactionDate);

    const recordedManually = state.payments.some(
        payment =>
            !payment.transactionLinked &&
            !payment.transaction?.isImported &&
            sameMoney(payment.amount, amount) &&
            Math.abs(dayNumber(payment.paymentDate) - debitDay) <=
                MANUAL_PAYMENT_MATCH_WINDOW_DAYS
    );

    if (recordedManually) {
        return {
            kind: "review",
            loanIds,
            reason: "A payment of the same amount was already recorded manually for this loan around this date, so it was not applied again.",
        };
    }

    const next = unpaidInstallments(state)[0];

    if (!next) {
        return {
            kind: "review",
            loanIds,
            reason: "The loan has no unpaid instalment left.",
        };
    }

    const label = `instalment #${next.schedule.installmentNumber}`;
    const due = installmentDueFor(transaction, state)!;
    const distance = Math.abs(dayNumber(due.dueDate) - debitDay);

    if (distance > DUE_DATE_WINDOW_DAYS) {
        return {
            kind: "review",
            loanIds,
            reason:
                dayNumber(next.schedule.dueDate) > debitDay
                    ? `No EMI of this loan is due around this date - the next unpaid ${label} is not due until ${next.schedule.dueDate}.`
                    : `No EMI of this loan is due around this date (the nearest, #${due.installmentNumber}, is due on ${due.dueDate}).`,
        };
    }

    if (due.installmentNumber > next.schedule.installmentNumber) {
        return {
            kind: "review",
            loanIds,
            reason: `Earlier EMI #${next.schedule.installmentNumber} (due ${next.schedule.dueDate}) is still unpaid and must be reviewed before this payment can be automatically matched to EMI #${due.installmentNumber}.`,
        };
    }

    if (due.installmentNumber < next.schedule.installmentNumber) {
        return {
            kind: "review",
            loanIds,
            reason: `EMI #${due.installmentNumber}, due on ${due.dueDate}, is already paid, and the next unpaid ${label} is due on ${next.schedule.dueDate} - this debit is not clearly either.`,
        };
    }

    if (sameMoney(amount, next.remaining)) {
        return {
            kind: "apply",
            loanId: state.loan.id,
            scheduleId: next.schedule.id,
            installmentNumber: next.schedule.installmentNumber,
            amount,
            fullyPaysInstallment: true,
            settlesInstallment: false,
        };
    }

    if (amount < next.remaining && repeatsUserSettlement(transaction, state, next)) {
        return {
            kind: "apply",
            loanId: state.loan.id,
            scheduleId: next.schedule.id,
            installmentNumber: next.schedule.installmentNumber,
            amount,
            fullyPaysInstallment: true,
            settlesInstallment: true,
        };
    }

    // More than what remains would be an extra principal payment - not
    // supported (see LoanPaymentService). Less is a partial payment or the
    // lender's own EMI figure - only the user can say which.
    return {
        kind: "review",
        loanIds,
        reason:
            amount > next.remaining
                ? `It is more than the ${money(next.remaining)} remaining on the next unpaid ${label}.`
                : `It is ${money(amount)}, not the ${money(next.remaining)} remaining on the next unpaid ${label} - use Link to Loan EMI to record it as a partial payment or as the lender's full instalment.`,
    };
}
