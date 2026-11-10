import { AccountRepository } from "@/modules/accounts/repositories/AccountRepository";
import { TransactionRepository } from "@/modules/transactions/repositories/TransactionRepository";
import type { Transaction } from "@/modules/transactions/types";

import { LoanPaymentScheduleRepository } from "../repositories/LoanPaymentScheduleRepository";
import { LoanRepository } from "../repositories/LoanRepository";
import { LoanSchedulePaymentRepository } from "../repositories/LoanSchedulePaymentRepository";
import { LoanStatus } from "../types/LoanStatus";
import { isOverdraft, overdraftAccountIds, type OverdraftEntryKind } from "../types";
import { LoanImportPaymentService } from "./LoanImportPaymentService";
import { OverdraftService } from "./OverdraftService";
import {
    NOT_LOAN_CATEGORY_REASON,
    isLoanLinkEligible,
    loadLoanLinkCategoryIds,
} from "./loanLinkEligibility";
import { overdraftKindsFor, overdraftLinkRefusal } from "./overdraftRules";
import {
    LoanPaymentService,
    type ProcessLoanPaymentResult,
    type ReversePaymentResult,
} from "./LoanPaymentService";
import {
    MANUAL_PAYMENT_MATCH_WINDOW_DAYS,
    transactionIdentifiesLoan,
    transactionNamesLoan,
    unpaidInstallments,
    type LoanMatchState,
} from "./loanImportMatching";

// ---------------------------------------------------------------------
// Link an EXISTING transaction to a loan EMI by hand (Transactions ->
// Link to Loan EMI). No new transaction is created: the payment records
// the selected transaction itself (its id, amount and date unchanged)
// through LoanPaymentService.recordPaymentFromTransaction - the same
// validation, allocation and single atomic write as every EMI payment,
// including its duplicate guard (one transaction, one payment).
//
// How the amount counts is the user's explicit choice, never inferred:
//   full    - the amount is exactly what remains on the instalment.
//   partial - less than what remains; the instalment stays PARTIAL.
//   settle  - less than what remains, but it IS the lender's full
//             instalment (its real debit differs from the calculated
//             EMI). The instalment becomes PAID; its scheduled amount is
//             kept, so the difference stays visible.
//
// The link is what future imports learn from: a statement debit with the
// same signature (see loanImportMatching.ts) is matched to this loan, and
// a settlement is repeated for the same amount against an instalment of
// the same scheduled amount.
//
// The same action links a transaction to an Overdraft (Link to Loan):
// there it is a Drawdown, a Repayment or an Interest / Charge - never an
// EMI. See OverdraftService; future imports learn from it the same way
// (overdraftImportMatching.ts).
// ---------------------------------------------------------------------

export type LoanLinkMode = "full" | "partial" | "settle";

export interface LoanLinkInstallmentOption {
    scheduleId: string;
    installmentNumber: number;
    dueDate: string;
    scheduledAmount: number;
    paid: number;
    remaining: number;
    /** How this transaction's amount can count against it - none when it is more than remains. */
    modes: LoanLinkMode[];
}

export interface LoanLinkLoanOption {
    loanId: string;
    loanName: string;
    installments: LoanLinkInstallmentOption[];
    /**
     * Payments of this loan that created their own transaction for the
     * same amount within a few days of this one - quite possibly this
     * same real payment, entered by hand.
     */
    possibleDuplicates: string[];
}

/** An Overdraft this transaction can be linked to, and as what. */
export interface OverdraftLinkOption {
    loanId: string;
    loanName: string;
    /** What this transaction's direction allows it to be. */
    kinds: OverdraftEntryKind[];
    /** Why it can't be linked to this overdraft, or null. */
    refusal: string | null;
}

/** What an already-linked transaction is linked to - for its details popup. */
export interface TransactionLinkDetails {
    loanName: string;
    /** null when the instalment can no longer be found (and for an Overdraft). */
    installmentNumber: number | null;
    /** The amount this transaction paid towards the EMI. */
    amount: number;
    /** Present only for an Overdraft link: what the transaction is. */
    overdraftEntryKind?: OverdraftEntryKind;
}

/**
 * Which linking workflow the transaction belongs to, from the active loans
 * on its account - never from its category or its text:
 *   EMI       - only Term Loans use the account (Link to Loan EMI).
 *   OVERDRAFT - only Overdrafts use it, or none does but an Overdraft
 *               exists on another account (Link to Overdraft).
 *   ANY       - both use it; the user chooses (Link to Loan).
 */
export type LoanLinkTarget = "EMI" | "OVERDRAFT" | "ANY";

export interface TransactionLinkOptions {
    transaction: Transaction;
    /** Why this transaction cannot be linked at all, or null. */
    refusal: string | null;
    target: LoanLinkTarget;
    /** Term Loans - linked to an EMI instalment. */
    loans: LoanLinkLoanOption[];
    /** Overdrafts on the transaction's account - linked as a movement. */
    overdrafts: OverdraftLinkOption[];
    /** The loan the transaction identifies, when exactly one does. */
    suggestedLoanId: string | null;
}

const MONEY_EPSILON = 0.005;

function roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

function money(value: number): string {
    return value.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function dayNumber(isoDate: string): number {
    return Math.floor(Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`) / 86_400_000);
}

/** How an amount can count against an instalment with `remaining` left. */
export function linkModesFor(amount: number, remaining: number): LoanLinkMode[] {
    if (Math.abs(amount - remaining) < MONEY_EPSILON) {
        return ["full"];
    }

    return amount < remaining ? ["partial", "settle"] : [];
}

/** The link choices for one transaction, from each eligible loan's state. */
export function buildLinkOptions(
    transaction: Transaction,
    states: readonly LoanMatchState[]
): Omit<TransactionLinkOptions, "refusal" | "overdrafts" | "target"> {
    const amount = roundMoney(transaction.amount);
    const day = dayNumber(transaction.transactionDate);

    const loans = states.map(state => {
        const scheduleNumber = new Map(
            state.schedule.map(row => [row.id, row.installmentNumber])
        );

        return {
            loanId: state.loan.id,
            loanName: state.loan.name,
            installments: unpaidInstallments(state).map(item => ({
                scheduleId: item.schedule.id,
                installmentNumber: item.schedule.installmentNumber,
                dueDate: item.schedule.dueDate,
                scheduledAmount: item.schedule.totalAmount,
                paid: item.paid,
                remaining: item.remaining,
                modes: linkModesFor(amount, item.remaining),
            })),
            possibleDuplicates: state.payments
                .filter(
                    payment =>
                        !payment.transactionLinked &&
                        !payment.transaction?.isImported &&
                        Math.abs(payment.amount - amount) < MONEY_EPSILON &&
                        Math.abs(dayNumber(payment.paymentDate) - day) <=
                            MANUAL_PAYMENT_MATCH_WINDOW_DAYS
                )
                .map(
                    payment =>
                        `A payment of ${money(payment.amount)} was already recorded on ${payment.paymentDate} for instalment #${scheduleNumber.get(payment.scheduleId) ?? "?"}, with its own transaction.`
                ),
        };
    });

    const identified = states.filter(state =>
        transactionIdentifiesLoan(transaction, state)
    );

    return {
        transaction,
        loans,
        suggestedLoanId:
            identified.length === 1 ? identified[0]!.loan.id : null,
    };
}

/** The workflow for a transaction, from the active loans on its account. */
export function linkTargetFor(counts: {
    termLoansOnAccount: number;
    overdraftsOnAccount: number;
    overdraftsElsewhere: number;
}): LoanLinkTarget {
    if (counts.overdraftsOnAccount > 0) {
        return counts.termLoansOnAccount > 0 ? "ANY" : "OVERDRAFT";
    }

    return counts.termLoansOnAccount === 0 && counts.overdraftsElsewhere > 0
        ? "OVERDRAFT"
        : "EMI";
}

/**
 * Why a transaction on an account no active loan uses can't be linked to
 * the Overdrafts that do exist - naming its real account and each OD's
 * linked accounts, so the user can decide whether to add the account to
 * the OD (Edit Loan). Never done for them.
 */
export function overdraftAccountMismatchRefusal(
    transactionAccountName: string,
    overdrafts: ReadonlyArray<{ loanName: string; accountNames: string[] }>
): string {
    const linkedTo = overdrafts
        .map(
            od =>
                `${od.loanName} (Overdraft) is linked only to ${
                    od.accountNames.length > 0
                        ? od.accountNames.join(", ")
                        : "other bank accounts"
                }`
        )
        .join("; ");

    return `This transaction is on ${transactionAccountName}, which no active loan or overdraft uses: ${linkedTo}. If ${transactionAccountName} really belongs to the overdraft, add it to the overdraft's bank accounts in Edit Loan first - it is never added automatically.`;
}

export class LoanTransactionLinkService {
    private readonly transactionRepository = new TransactionRepository();

    private readonly loanRepository = new LoanRepository();

    private readonly paymentRepository = new LoanSchedulePaymentRepository();

    private readonly scheduleRepository = new LoanPaymentScheduleRepository();

    private readonly stateLoader = new LoanImportPaymentService();

    private readonly loanPaymentService = new LoanPaymentService();

    private readonly overdraftService = new OverdraftService();

    async getLinkOptions(transactionId: string): Promise<TransactionLinkOptions> {
        const transaction = await this.transactionRepository.getById(transactionId);

        if (!transaction) {
            throw new Error("The transaction was not found.");
        }

        // The active loans, by the transaction's REAL account (read from the
        // database, never from what a table shows). Which workflow applies
        // follows from these alone: an Overdraft on the account means the
        // OD workflow, never the Term Loan EMI one.
        const activeLoans = (await this.loanRepository.getAll()).filter(
            loan => loan.status !== LoanStatus.CLOSED
        );
        const activeOverdrafts = activeLoans.filter(isOverdraft);
        const overdraftsOnAccount = activeOverdrafts.filter(loan =>
            overdraftAccountIds(loan).includes(transaction.accountId)
        );
        const overdraftsElsewhere = activeOverdrafts.filter(
            loan => !overdraftsOnAccount.includes(loan)
        );
        const loans = activeLoans.filter(
            loan => !isOverdraft(loan) && loan.accountId === transaction.accountId
        );
        const target = linkTargetFor({
            termLoansOnAccount: loans.length,
            overdraftsOnAccount: overdraftsOnAccount.length,
            overdraftsElsewhere: overdraftsElsewhere.length,
        });

        const empty = { transaction, target, loans: [], overdrafts: [], suggestedLoanId: null };

        const overdraftLink = await this.overdraftService.getLinkByTransactionId(transaction.id);

        if (overdraftLink) {
            const linkedTo = await this.loanRepository.getById(overdraftLink.loanId);

            return {
                ...empty,
                target: "OVERDRAFT",
                refusal: `This transaction is already linked to ${linkedTo?.name ?? "an overdraft"}. Unlink it first to link it elsewhere.`,
            };
        }

        const existing = await this.paymentRepository.getByTransactionId(transaction.id);

        if (existing) {
            const loan = await this.loanRepository.getById(existing.loanId);

            return {
                ...empty,
                target: "EMI",
                refusal: `This transaction is already recorded as a payment of ${loan?.name ?? "a loan"}. Reverse that payment from the loan's EMI Schedule first to link it elsewhere.`,
            };
        }

        // The category gate comes first: only a transaction in a loan
        // category can be linked - its account alone never makes it one.
        if (!isLoanLinkEligible(transaction, await loadLoanLinkCategoryIds())) {
            return { ...empty, refusal: NOT_LOAN_CATEGORY_REASON };
        }

        // On an account no active loan uses, while an Overdraft exists on
        // another: say exactly that, with the real account names - the
        // account is never added to the OD for the user.
        if (loans.length === 0 && overdraftsOnAccount.length === 0 && overdraftsElsewhere.length > 0) {
            const accountNames = new Map(
                (await new AccountRepository().getAll()).map(account => [account.id, account.name])
            );

            return {
                ...empty,
                refusal: overdraftAccountMismatchRefusal(
                    accountNames.get(transaction.accountId) ?? "a bank account",
                    overdraftsElsewhere.map(loan => ({
                        loanName: loan.name,
                        accountNames: overdraftAccountIds(loan).map(
                            id => accountNames.get(id) ?? id
                        ),
                    }))
                ),
            };
        }

        // Overdrafts linked to this transaction's account (an OD can have
        // several) - a credit can be a drawdown, a debit a repayment or an
        // interest / charge.
        const overdrafts: OverdraftLinkOption[] = overdraftsOnAccount.map(loan => ({
            loanId: loan.id,
            loanName: loan.name,
            kinds: overdraftKindsFor(transaction),
            refusal: overdraftLinkRefusal(transaction, loan),
        }));

        // Money in can only be an Overdraft movement - never an EMI.
        if (transaction.type !== "expense") {
            return overdrafts.length > 0
                ? {
                      ...empty,
                      target: "OVERDRAFT",
                      overdrafts,
                      suggestedLoanId: overdrafts.length === 1 ? overdrafts[0]!.loanId : null,
                      refusal: null,
                  }
                : {
                      ...empty,
                      refusal: "Only an outgoing (expense) transaction can be a loan EMI payment.",
                  };
        }

        if (loans.length === 0 && overdrafts.length === 0) {
            return {
                ...empty,
                refusal: "No active loan has this transaction's account as its EMI payment account.",
            };
        }

        const states: LoanMatchState[] = [];

        for (const loan of loans) {
            states.push(await this.stateLoader.loadState(loan));
        }

        const termOptions = buildLinkOptions(transaction, states);

        // The one Overdraft on the account is preselected when no Term Loan
        // is there, or when the transaction itself names it.
        const namedOverdrafts = overdraftsOnAccount.filter(loan =>
            transactionNamesLoan(transaction, { loan, lenderName: null, schedule: [], payments: [] })
        );

        return {
            ...termOptions,
            target,
            overdrafts,
            suggestedLoanId:
                termOptions.suggestedLoanId ??
                (overdrafts.length === 1 && (loans.length === 0 || namedOverdrafts.length === 1)
                    ? overdrafts[0]!.loanId
                    : null),
            refusal: null,
        };
    }

    /** Transactions -> Link to Loan, for an Overdraft. See OverdraftService.link. */
    async linkOverdraft(request: {
        transactionId: string;
        loanId: string;
        entryKind: OverdraftEntryKind;
    }) {
        return await this.overdraftService.link({ ...request, source: "MANUAL" });
    }

    /**
     * What an already-linked transaction is linked to - null when it is
     * not a loan EMI payment. Read-only.
     */
    async getLinkDetails(transactionId: string): Promise<TransactionLinkDetails | null> {
        const payment = await this.paymentRepository.getByTransactionId(transactionId);

        if (!payment) {
            const link = await this.overdraftService.getLinkByTransactionId(transactionId);

            if (!link) {
                return null;
            }

            const [loan, transaction] = await Promise.all([
                this.loanRepository.getById(link.loanId),
                this.transactionRepository.getById(transactionId),
            ]);

            return {
                loanName: loan?.name ?? "an overdraft",
                installmentNumber: null,
                amount: transaction?.amount ?? 0,
                overdraftEntryKind: link.entryKind,
            };
        }

        const [loan, schedule] = await Promise.all([
            this.loanRepository.getById(payment.loanId),
            this.scheduleRepository.getById(payment.scheduleId),
        ]);

        return {
            loanName: loan?.name ?? "a loan",
            installmentNumber: schedule?.installmentNumber ?? null,
            amount: payment.amount,
        };
    }

    /**
     * Unlink: removes the transaction's loan EMI payment through the same
     * reversal as the EMI Schedule (the instalment and the loan balances
     * are recomputed exactly as for any reversed payment) - but the
     * transaction itself is always kept, unchanged, and can be linked
     * again. Refused, with nothing written, when it is no longer linked
     * (e.g. a second click).
     */
    async unlink(transactionId: string): Promise<ReversePaymentResult | null> {
        const payment = await this.paymentRepository.getByTransactionId(transactionId);

        if (!payment) {
            // An Overdraft link: only the link is removed.
            if (await this.overdraftService.getLinkByTransactionId(transactionId)) {
                await this.overdraftService.unlink(transactionId);

                return null;
            }

            throw new Error("This transaction is not linked to a loan EMI any more.");
        }

        return await this.loanPaymentService.reversePayment(payment.id, {
            keepTransaction: true,
        });
    }

    async link(request: {
        transactionId: string;
        loanId: string;
        scheduleId: string;
        mode: LoanLinkMode;
    }): Promise<ProcessLoanPaymentResult> {
        // Re-read, so the choice is checked against the current state, not
        // what the dialog showed.
        const options = await this.getLinkOptions(request.transactionId);

        if (options.refusal) {
            throw new Error(options.refusal);
        }

        const installment = options.loans
            .find(loan => loan.loanId === request.loanId)
            ?.installments.find(item => item.scheduleId === request.scheduleId);

        if (!installment) {
            throw new Error("That instalment is not open for payment any more.");
        }

        if (!installment.modes.includes(request.mode)) {
            throw new Error(
                installment.modes.length === 0
                    ? `The transaction is more than the ${money(installment.remaining)} remaining on instalment #${installment.installmentNumber}.`
                    : "That choice does not fit this transaction's amount - please choose again."
            );
        }

        return await this.loanPaymentService.recordPaymentFromTransaction({
            loanId: request.loanId,
            scheduleId: request.scheduleId,
            transactionId: request.transactionId,
            settlesInstallment: request.mode === "settle",
        });
    }
}
