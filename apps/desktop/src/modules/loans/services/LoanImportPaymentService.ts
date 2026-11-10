import { InstitutionRepository } from "@/modules/institutions/repositories/InstitutionRepository";
import { TransactionRepository } from "@/modules/transactions/repositories/TransactionRepository";
import type { Transaction } from "@/modules/transactions/types";

import { LoanPaymentScheduleRepository } from "../repositories/LoanPaymentScheduleRepository";
import { LoanRepository } from "../repositories/LoanRepository";
import { LoanSchedulePaymentRepository } from "../repositories/LoanSchedulePaymentRepository";
import { OverdraftTransactionLinkRepository } from "../repositories/OverdraftTransactionLinkRepository";
import { isOverdraft, overdraftAccountIds, type Loan, type OverdraftEntryKind } from "../types";
import { LoanStatus } from "../types/LoanStatus";
import { LoanPaymentService } from "./LoanPaymentService";
import {
    decideLoanPaymentForTransaction,
    type LoanImportDecision,
    type LoanMatchState,
} from "./loanImportMatching";
import {
    decideOverdraftForTransaction,
    type OverdraftImportDecision,
    type OverdraftMatchState,
} from "./overdraftImportMatching";
import { OverdraftService } from "./OverdraftService";
import { isLoanLinkEligible, loadLoanLinkCategoryIds } from "./loanLinkEligibility";

export interface AppliedLoanImportPayment {
    transactionId: string;
    loanId: string;
    loanName: string;
    installmentNumber: number;
    amount: number;
    installmentStatus: string;
}

export interface LoanImportPaymentForReview {
    /** The imported transaction - null when the import could not be checked at all. */
    transactionId: string | null;
    transactionDate: string;
    amount: number;
    loanNames: string[];
    reason: string;
    /** It may be an Overdraft movement - linked with the generic Link to Loan. */
    overdraft?: boolean;
}

/** An imported transaction linked to an Overdraft automatically. */
export interface AppliedOverdraftImportEntry {
    transactionId: string;
    loanId: string;
    loanName: string;
    entryKind: OverdraftEntryKind;
    amount: number;
}

export interface LoanImportPaymentSummary {
    applied: AppliedLoanImportPayment[];
    needsReview: LoanImportPaymentForReview[];
    /** Overdraft movements linked automatically - absent when there were none. */
    overdraftApplied?: AppliedOverdraftImportEntry[];
}

// What the user is told when something unexpected stops a payment being
// checked or recorded - never the technical cause, which goes to the
// console. The transaction is left exactly as imported.
export const COULD_NOT_RECORD_REASON =
    "FinWea could not record this loan payment automatically. Use Link to Loan EMI to record it.";

export const COULD_NOT_CHECK_REASON =
    "FinWea could not check this payment against your loans. If it is a loan EMI, use Link to Loan EMI to record it.";

export const COULD_NOT_LINK_OVERDRAFT_REASON =
    "FinWea could not link this transaction to the overdraft automatically. Use Link to Loan to link it.";

export const COULD_NOT_CHECK_IMPORT_REASON =
    "FinWea could not check this import for loan payments. If it included a loan EMI, open it in Transactions and use Link to Loan EMI.";

/**
 * The summary when the check could not run at all - one item for the
 * user's attention, nothing applied.
 */
export function uncheckedLoanImportSummary(): LoanImportPaymentSummary {
    return {
        applied: [],
        needsReview: [
            {
                transactionId: null,
                transactionDate: "",
                amount: 0,
                loanNames: [],
                reason: COULD_NOT_CHECK_IMPORT_REASON,
            },
        ],
    };
}

// ---------------------------------------------------------------------
// Applies statement transactions to loans automatically - run by
// ImportService only once a confirmed import has created its
// transactions (never during Preview, never for a duplicate row, whose
// existing transaction is left alone). Each transaction is decided by
// loanImportMatching.ts and, when confidently one loan's EMI, recorded
// through LoanPaymentService.recordPaymentFromTransaction - the same
// validation, allocation and atomic write as a manual EMI payment, with
// the imported transaction itself as the payment's bank record (no
// second transaction). Transactions are taken in date order and the
// loan's state is re-read after every applied payment, so several EMIs
// (or several partial payments of one EMI) in one statement each land on
// the right instalment.
//
// The Loan Type decides the rules. A Term Loan's debits go through EMI
// matching exactly as before; an Overdraft is never sent through EMI
// matching - its debits AND credits go through Overdraft matching
// (overdraftImportMatching.ts), which only links a transaction on a
// pattern the user taught by linking one by hand. A transaction both
// claim is never applied to either: it goes to review.
// ---------------------------------------------------------------------

export class LoanImportPaymentService {
    private readonly loanRepository = new LoanRepository();

    private readonly scheduleRepository = new LoanPaymentScheduleRepository();

    private readonly paymentRepository = new LoanSchedulePaymentRepository();

    private readonly transactionRepository = new TransactionRepository();

    private readonly institutionRepository = new InstitutionRepository();

    private readonly loanPaymentService = new LoanPaymentService();

    private readonly overdraftService = new OverdraftService();

    private readonly overdraftLinkRepository = new OverdraftTransactionLinkRepository();

    /**
     * Never throws: an unexpected failure leaves the transactions exactly
     * as imported and is reported as needing the user's attention.
     */
    async applyToImportedTransactions(
        transactionIds: readonly string[]
    ): Promise<LoanImportPaymentSummary> {
        try {
            return await this.applyAll(transactionIds);
        } catch (error) {
            console.error("Failed to check imported transactions for loan EMI payments:", error);

            return uncheckedLoanImportSummary();
        }
    }

    private async applyAll(
        transactionIds: readonly string[]
    ): Promise<LoanImportPaymentSummary> {
        const summary: LoanImportPaymentSummary = {
            applied: [],
            needsReview: [],
        };

        const order = new Map(transactionIds.map((id, index) => [id, index]));

        // Only transactions in a loan category are ever considered - for a
        // match OR a review item. Debits for Term Loans; debits and credits
        // for Overdrafts.
        const loanCategoryIds = await loadLoanLinkCategoryIds();

        const imported = (
            await this.transactionRepository.getByIds(transactionIds)
        )
            .filter(transaction => isLoanLinkEligible(transaction, loanCategoryIds))
            .sort(
            (a, b) =>
                a.transactionDate.localeCompare(b.transactionDate) ||
                order.get(a.id)! - order.get(b.id)!
        );

        if (imported.length === 0) {
            return summary;
        }

        const accountIds = new Set(imported.map(transaction => transaction.accountId));

        // A Term Loan by its EMI payment account; an Overdraft by any of its
        // linked bank accounts.
        const loans = (await this.loanRepository.getAll()).filter(
            loan =>
                loan.status !== LoanStatus.CLOSED &&
                (isOverdraft(loan)
                    ? overdraftAccountIds(loan).some(id => accountIds.has(id))
                    : loan.accountId !== null && accountIds.has(loan.accountId))
        );

        if (loans.length === 0) {
            return summary;
        }

        // Term Loans only - an Overdraft never takes part in EMI matching.
        const states = new Map<string, LoanMatchState>();

        for (const loan of loans.filter(loan => !isOverdraft(loan))) {
            states.set(loan.id, await this.loadState(loan));
        }

        const overdraftStates: OverdraftMatchState[] = [];

        for (const loan of loans.filter(isOverdraft)) {
            overdraftStates.push(await this.overdraftService.loadMatchState(loan));
        }

        const loanNames = new Map(loans.map(loan => [loan.id, loan.name]));

        // Loans whose state could not be re-read after a payment - their
        // later debits are never matched on stale state.
        const unreliable = new Set<string>();

        for (const debit of imported) {
            let decision: LoanImportDecision;
            let overdraftDecision: OverdraftImportDecision;

            try {
                // Never a second payment or link for one transaction (the
                // atomic write and UNIQUE(transaction_id) refuse it too).
                if (
                    (await this.paymentRepository.getByTransactionId(debit.id)) ||
                    (await this.overdraftLinkRepository.getByTransactionId(debit.id))
                ) {
                    continue;
                }

                decision =
                    debit.type === "expense" && states.size > 0
                        ? decideLoanPaymentForTransaction(debit, [...states.values()])
                        : { kind: "none" };

                overdraftDecision = decideOverdraftForTransaction(debit, overdraftStates);
            } catch (error) {
                // Not known to be a loan payment at all - rather than flag
                // every remaining debit, stop here with one notice; what
                // was already applied stays applied.
                console.error("Failed to check an imported transaction for a loan EMI payment:", error);
                summary.needsReview.push(
                    ...uncheckedLoanImportSummary().needsReview
                );
                break;
            }

            // Claimed by a Term Loan AND an Overdraft: never guessed.
            if (decision.kind !== "none" && overdraftDecision.kind !== "none") {
                const loanIds = [
                    ...(decision.kind === "apply" ? [decision.loanId] : decision.loanIds),
                    ...(overdraftDecision.kind === "apply"
                        ? [overdraftDecision.loanId]
                        : overdraftDecision.loanIds),
                ];

                summary.needsReview.push({
                    ...this.forReview(debit, [], "", states),
                    overdraft: true,
                    loanNames: loanIds.flatMap(id => loanNames.get(id) ?? []),
                    reason: `It could belong to more than one loan (${loanIds
                        .map(id => loanNames.get(id) ?? "a loan")
                        .join(", ")}), so it was not applied to any. Use Link to Loan to choose.`,
                });
                continue;
            }

            if (overdraftDecision.kind === "review") {
                summary.needsReview.push({
                    ...this.forReview(debit, [], overdraftDecision.reason, states),
                    overdraft: true,
                    loanNames: overdraftDecision.loanIds.flatMap(id => loanNames.get(id) ?? []),
                });
                continue;
            }

            if (overdraftDecision.kind === "apply") {
                try {
                    const { loan } = await this.overdraftService.link({
                        transactionId: debit.id,
                        loanId: overdraftDecision.loanId,
                        entryKind: overdraftDecision.entryKind,
                        source: "IMPORT",
                    });

                    (summary.overdraftApplied ??= []).push({
                        transactionId: debit.id,
                        loanId: loan.id,
                        loanName: loan.name,
                        entryKind: overdraftDecision.entryKind,
                        amount: debit.amount,
                    });
                } catch (error) {
                    // Refused - nothing was written (one statement); the
                    // transaction stays an ordinary imported transaction.
                    console.error("Failed to link an imported overdraft transaction:", error);
                    summary.needsReview.push({
                        ...this.forReview(debit, [], COULD_NOT_LINK_OVERDRAFT_REASON, states),
                        overdraft: true,
                        loanNames: [loanNames.get(overdraftDecision.loanId) ?? "an overdraft"],
                    });
                }
                continue;
            }

            if (decision.kind === "none") {
                continue;
            }

            const decidedLoanIds =
                decision.kind === "apply" ? [decision.loanId] : decision.loanIds;

            if (decidedLoanIds.some(id => unreliable.has(id))) {
                summary.needsReview.push(
                    this.forReview(debit, decidedLoanIds, COULD_NOT_CHECK_REASON, states)
                );
                continue;
            }

            if (decision.kind === "review") {
                summary.needsReview.push(
                    this.forReview(debit, decision.loanIds, decision.reason, states)
                );
                continue;
            }

            try {
                const result =
                    await this.loanPaymentService.recordPaymentFromTransaction({
                        loanId: decision.loanId,
                        scheduleId: decision.scheduleId,
                        transactionId: debit.id,
                        settlesInstallment: decision.settlesInstallment,
                    });

                summary.applied.push({
                    transactionId: debit.id,
                    loanId: result.loan.id,
                    loanName: result.loan.name,
                    installmentNumber: result.schedule.installmentNumber,
                    amount: result.amountPaid,
                    installmentStatus: result.schedule.status,
                });
            } catch (error) {
                // Refused or failed - nothing was written (atomic); the
                // transaction stays an ordinary imported transaction.
                console.error("Failed to record an imported loan EMI payment:", error);
                summary.needsReview.push(
                    this.forReview(
                        debit,
                        [decision.loanId],
                        COULD_NOT_RECORD_REASON,
                        states
                    )
                );
            }

            // Fresh state for the next transaction - whether or not this
            // one was written. If it cannot be re-read, its later debits
            // in this import are left for the user (see unreliable).
            try {
                const loan = await this.loanRepository.getById(decision.loanId);

                if (loan) {
                    states.set(loan.id, await this.loadState(loan));
                } else {
                    states.delete(decision.loanId);
                }
            } catch (error) {
                console.error("Failed to reload a loan after an imported EMI payment:", error);
                unreliable.add(decision.loanId);
            }
        }

        return summary;
    }

    private forReview(
        debit: Transaction,
        loanIds: string[],
        reason: string,
        states: Map<string, LoanMatchState>
    ): LoanImportPaymentForReview {
        return {
            transactionId: debit.id,
            transactionDate: debit.transactionDate,
            amount: debit.amount,
            loanNames: loanIds.flatMap(id => {
                const name = states.get(id)?.loan.name;

                return name ? [name] : [];
            }),
            reason,
        };
    }

    // Everything the matcher needs about one loan - also used by
    // LoanTransactionLinkService for a link made by hand.
    async loadState(loan: Loan): Promise<LoanMatchState> {
        const [schedule, payments, lender] = await Promise.all([
            this.scheduleRepository.getAllByLoanId(loan.id),
            this.paymentRepository.getAllByLoanId(loan.id),
            loan.lenderInstitutionId
                ? this.institutionRepository.getById(loan.lenderInstitutionId)
                : Promise.resolve(null),
        ]);

        const paymentTransactions = new Map(
            (
                await this.transactionRepository.getByIds(
                    payments.map(payment => payment.transactionId)
                )
            ).map(transaction => [transaction.id, transaction])
        );

        return {
            loan,
            lenderName: lender?.name ?? null,
            schedule,
            payments: payments.map(payment => {
                const transaction = paymentTransactions.get(payment.transactionId);

                return {
                    ...payment,
                    transaction: transaction
                        ? { ...transaction, isImported: Boolean(transaction.isImported) }
                        : null,
                };
            }),
        };
    }
}
