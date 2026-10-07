import { TransactionRepository } from "@/modules/transactions/repositories/TransactionRepository";
import type { Transaction } from "@/modules/transactions/types";

import { LoanPaymentScheduleRepository } from "../repositories/LoanPaymentScheduleRepository";
import { LoanRepository } from "../repositories/LoanRepository";
import { LoanSchedulePaymentRepository } from "../repositories/LoanSchedulePaymentRepository";
import { LoanStatus } from "../types/LoanStatus";
import { LoanImportPaymentService } from "./LoanImportPaymentService";
import {
    LoanPaymentService,
    type ProcessLoanPaymentResult,
    type ReversePaymentResult,
} from "./LoanPaymentService";
import {
    MANUAL_PAYMENT_MATCH_WINDOW_DAYS,
    transactionIdentifiesLoan,
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

/** What an already-linked transaction is linked to - for its details popup. */
export interface TransactionLinkDetails {
    loanName: string;
    /** null when the instalment can no longer be found. */
    installmentNumber: number | null;
    /** The amount this transaction paid towards the EMI. */
    amount: number;
}

export interface TransactionLinkOptions {
    transaction: Transaction;
    /** Why this transaction cannot be linked at all, or null. */
    refusal: string | null;
    loans: LoanLinkLoanOption[];
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
): Omit<TransactionLinkOptions, "refusal"> {
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

export class LoanTransactionLinkService {
    private readonly transactionRepository = new TransactionRepository();

    private readonly loanRepository = new LoanRepository();

    private readonly paymentRepository = new LoanSchedulePaymentRepository();

    private readonly scheduleRepository = new LoanPaymentScheduleRepository();

    private readonly stateLoader = new LoanImportPaymentService();

    private readonly loanPaymentService = new LoanPaymentService();

    async getLinkOptions(transactionId: string): Promise<TransactionLinkOptions> {
        const transaction = await this.transactionRepository.getById(transactionId);

        if (!transaction) {
            throw new Error("The transaction was not found.");
        }

        const empty = { transaction, loans: [], suggestedLoanId: null };

        if (transaction.type !== "expense") {
            return {
                ...empty,
                refusal: "Only an outgoing (expense) transaction can be a loan EMI payment.",
            };
        }

        const existing = await this.paymentRepository.getByTransactionId(transaction.id);

        if (existing) {
            const loan = await this.loanRepository.getById(existing.loanId);

            return {
                ...empty,
                refusal: `This transaction is already recorded as a payment of ${loan?.name ?? "a loan"}. Reverse that payment from the loan's EMI Schedule first to link it elsewhere.`,
            };
        }

        const loans = (await this.loanRepository.getAll()).filter(
            loan =>
                loan.status !== LoanStatus.CLOSED &&
                loan.accountId === transaction.accountId
        );

        if (loans.length === 0) {
            return {
                ...empty,
                refusal: "No active loan has this transaction's account as its EMI payment account.",
            };
        }

        const states: LoanMatchState[] = [];

        for (const loan of loans) {
            states.push(await this.stateLoader.loadState(loan));
        }

        return { ...buildLinkOptions(transaction, states), refusal: null };
    }

    /**
     * What an already-linked transaction is linked to - null when it is
     * not a loan EMI payment. Read-only.
     */
    async getLinkDetails(transactionId: string): Promise<TransactionLinkDetails | null> {
        const payment = await this.paymentRepository.getByTransactionId(transactionId);

        if (!payment) {
            return null;
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
    async unlink(transactionId: string): Promise<ReversePaymentResult> {
        const payment = await this.paymentRepository.getByTransactionId(transactionId);

        if (!payment) {
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
