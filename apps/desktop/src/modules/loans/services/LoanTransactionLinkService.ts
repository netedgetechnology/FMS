import { balanceSide } from "@/core/accounting/transferClassification";
import { AccountRepository } from "@/modules/accounts/repositories/AccountRepository";
import { TransactionRepository } from "@/modules/transactions/repositories/TransactionRepository";
import type { Transaction } from "@/modules/transactions/types";

import { LoanPaymentScheduleRepository } from "../repositories/LoanPaymentScheduleRepository";
import { LoanRepository } from "../repositories/LoanRepository";
import { LoanSchedulePaymentRepository } from "../repositories/LoanSchedulePaymentRepository";
import { LoanStatus } from "../types/LoanStatus";
import { isOverdraft, overdraftAccountIds, type Loan, type OverdraftEntryKind } from "../types";
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
// The same action links a transaction to an Overdraft: there it is a
// Drawdown, a Repayment or an Interest / Charge - never an EMI. See
// OverdraftService; future imports learn from it the same way
// (overdraftImportMatching.ts).
//
// One universal workflow (Link Transaction to Loan): EVERY active loan is
// offered - Term Loan, Overdraft, Dropline, Cash Credit - whatever its
// payment account or the transaction's account. The user chooses; the
// CHOSEN loan's type decides what the link is. Each loan carries its own
// refusal when it cannot take this transaction (e.g. money in can never be
// an EMI; an Overdraft movement must be on one of its linked bank
// accounts, the only ones its Used amount counts - overdraftPositionSql).
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
    /** What the loan is, for the list: "Term Loan". */
    loanType: string;
    installments: LoanLinkInstallmentOption[];
    /**
     * Payments of this loan that created their own transaction for the
     * same amount within a few days of this one - quite possibly this
     * same real payment, entered by hand.
     */
    possibleDuplicates: string[];
    /** Why this transaction cannot be an EMI payment of this loan, or null. */
    refusal: string | null;
}

/** An Overdraft this transaction can be linked to, and as what. */
export interface OverdraftLinkOption {
    loanId: string;
    loanName: string;
    /** What the facility was saved as, for the list: Overdraft, Cash Credit, Dropline Overdraft... */
    loanType: string;
    /** What this transaction's direction allows it to be. */
    kinds: OverdraftEntryKind[];
    /** Why it can't be linked to this overdraft, or null. */
    refusal: string | null;
}

export interface TransactionLinkDetails {
    loanName: string;
    /** null when the instalment can no longer be found (and for an Overdraft). */
    installmentNumber: number | null;
    /** The amount this transaction paid towards the EMI. */
    amount: number;
    /** Present only for an Overdraft link: what the transaction is. */
    overdraftEntryKind?: OverdraftEntryKind;
}

export interface TransactionLinkOptions {
    transaction: Transaction;
    /** Why this transaction cannot be linked at all, or null. */
    refusal: string | null;
    /** Every active Term Loan - linked to an EMI instalment. */
    loans: LoanLinkLoanOption[];
    /** Every active Overdraft / Dropline / Cash Credit - linked as a movement. */
    overdrafts: OverdraftLinkOption[];
}

/** Money in (Income, Transfer In) can never be a loan EMI payment. */
export const NOT_AN_EMI_PAYMENT_REASON = "Only an outgoing transaction (an Expense or a Transfer Out) can be a loan EMI payment.";

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
): Pick<TransactionLinkOptions, "transaction" | "loans"> {
    const amount = roundMoney(transaction.amount);
    const day = dayNumber(transaction.transactionDate);

    const loans = states.map(state => {
        const scheduleNumber = new Map(
            state.schedule.map(row => [row.id, row.installmentNumber])
        );

        return {
            loanId: state.loan.id,
            loanName: state.loan.name,
            loanType: "Term Loan",
            refusal: null,
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

    return { transaction, loans };
}

/**
 * Why an Overdraft cannot take a transaction on another bank account -
 * naming both, so the user can decide whether to add the account to the
 * OD (Edit Loan). Its Used amount counts only movements on its linked
 * accounts (overdraftPositionSql), so such a link would never count.
 */
export function overdraftAccountMismatchRefusal(
    loanName: string,
    transactionAccountName: string,
    linkedAccountNames: string[]
): string {
    return `This transaction is on ${transactionAccountName}, which is not one of ${loanName}'s linked bank accounts (${
        linkedAccountNames.length > 0 ? linkedAccountNames.join(", ") : "none"
    }). Its Used amount counts only movements on those accounts. If ${transactionAccountName} really belongs to ${loanName}, add it to the overdraft's bank accounts in Edit Loan first - it is never added automatically.`;
}

/** How a facility is listed: its saved type (Overdraft, Cash Credit...), else "Overdraft". */
export function overdraftTypeLabel(loan: Pick<Loan, "loanType">): string {
    return loan.loanType?.trim() || "Overdraft";
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

        const empty = { transaction, loans: [], overdrafts: [] };

        const overdraftLink = await this.overdraftService.getLinkByTransactionId(transaction.id);

        if (overdraftLink) {
            const linkedTo = await this.loanRepository.getById(overdraftLink.loanId);

            return {
                ...empty,
                refusal: `This transaction is already linked to ${linkedTo?.name ?? "an overdraft"}. Unlink it first to link it elsewhere.`,
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

        // The category gate comes first: only a transaction in a loan
        // category can be linked - its account alone never makes it one.
        if (!isLoanLinkEligible(transaction, await loadLoanLinkCategoryIds())) {
            return { ...empty, refusal: NOT_LOAN_CATEGORY_REASON };
        }

        // Every active loan, of every type, whatever its account.
        const activeLoans = (await this.loanRepository.getAll()).filter(
            loan => loan.status !== LoanStatus.CLOSED
        );

        if (activeLoans.length === 0) {
            return { ...empty, refusal: "There is no active loan to link this transaction to." };
        }

        const termLoans = activeLoans.filter(loan => !isOverdraft(loan));
        const facilities = activeLoans.filter(isOverdraft);

        let accountNames: Map<string, string> | null = null;
        const nameOf = async (id: string) => {
            accountNames ??= new Map((await new AccountRepository().getAll()).map(account => [account.id, account.name]));
            return accountNames.get(id) ?? id;
        };

        const overdrafts: OverdraftLinkOption[] = [];

        for (const loan of facilities) {
            const linkedIds = overdraftAccountIds(loan);
            let refusal = overdraftLinkRefusal(transaction, loan);

            if (refusal && !linkedIds.includes(transaction.accountId)) {
                refusal = overdraftAccountMismatchRefusal(
                    loan.name,
                    await nameOf(transaction.accountId),
                    await Promise.all(linkedIds.map(nameOf))
                );
            }

            overdrafts.push({
                loanId: loan.id,
                loanName: loan.name,
                loanType: overdraftTypeLabel(loan),
                kinds: overdraftKindsFor(transaction),
                refusal,
            });
        }

        // Only money out - an Expense or a Transfer Out - can be an EMI
        // payment; money in can only be an Overdraft movement: every Term
        // Loan is still listed, refusing it.
        if (balanceSide(transaction) !== "expense") {
            return {
                transaction,
                refusal: null,
                overdrafts,
                loans: termLoans.map(loan => ({
                    loanId: loan.id,
                    loanName: loan.name,
                    loanType: "Term Loan",
                    installments: [],
                    possibleDuplicates: [],
                    refusal: NOT_AN_EMI_PAYMENT_REASON,
                })),
            };
        }

        const states: LoanMatchState[] = [];

        for (const loan of termLoans) {
            states.push(await this.stateLoader.loadState(loan));
        }

        return { ...buildLinkOptions(transaction, states), overdrafts, refusal: null };
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

        const loanOption = options.loans.find(loan => loan.loanId === request.loanId);

        if (!loanOption) {
            throw new Error(
                options.overdrafts.some(item => item.loanId === request.loanId)
                    ? "That loan is an overdraft: link the transaction as a drawdown, repayment or interest / charge."
                    : "That loan is not open for linking any more."
            );
        }

        if (loanOption.refusal) {
            throw new Error(loanOption.refusal);
        }

        const installment = loanOption.installments.find(
            item => item.scheduleId === request.scheduleId
        );

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
            // The user chose this loan: its EMI payment account is not
            // required to be the transaction's account here.
            fromAnyAccount: true,
        });
    }
}
