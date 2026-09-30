import { TransactionService } from "@/modules/transactions/services/TransactionService";
import { TransactionRepository } from "@/modules/transactions/repositories/TransactionRepository";
import type {
    PaymentMethod,
} from "@/modules/transactions/types";

import { LoanStatus } from "../types/LoanStatus";
import { LoanRepository } from "../repositories/LoanRepository";
import { LoanPaymentScheduleRepository } from "../repositories/LoanPaymentScheduleRepository";
import { LoanSchedulePaymentRepository } from "../repositories/LoanSchedulePaymentRepository";
import {
    Loan,
    LoanPaymentSchedule,
    LoanPaymentStatus,
    LoanSchedulePayment,
} from "../types";
import {
    paidInterestPortion,
    paidPrincipalPortion,
} from "./loanPaymentAllocation";

export interface ProcessLoanPaymentRequest {
    loanId: string;
    scheduleId: string;
    paymentDate: string;
    /**
     * Amount actually paid, from >0 up to the schedule row's own
     * *remaining* amount (Loans Phase 4 - partial payment of one
     * instalment, completable by a further payment). Omitted (or equal
     * to the remaining amount) reproduces the original, full-EMI-only
     * behaviour exactly on a row with no prior payment. Paying more
     * than what remains on the instalment (an extra principal payment)
     * is not supported yet - see loanPaymentAllocation.ts.
     */
    amount?: number;
    paymentMethod?: PaymentMethod | null;
    referenceNumber?: string | null;
    notes?: string | null;
}

export interface ProcessLoanPaymentResult {
    transactionId: string;
    loan: Loan;
    schedule: LoanPaymentSchedule;
    principalPaid: number;
    interestPaid: number;
    amountPaid: number;
}

export interface ReversePaymentResult {
    payment: LoanSchedulePayment;
    schedule: LoanPaymentSchedule;
    loan: Loan;
}

// ---------------------------------------------------------------------
// Loans Phase 4 (+ correction) - payment flexibility.
//
// A schedule row accepts one or more payments, each for anywhere from
// >0 up to whatever remains of its totalAmount (validated below).
// Every payment - the first or a later top-up - is recorded as its own
// immutable row in loan_schedule_payments, with its own transaction
// link and its own principal/interest allocation snapshot (interest
// allocated first, cumulative across prior payments for this row - see
// loanPaymentAllocation.ts and this table's migration comment). Paying
// the full remaining amount in one go reproduces the original,
// full-EMI-only behaviour exactly (status PAID straight away).
//
// loan_payment_schedule's own paidAmount becomes the running total
// across every loan_schedule_payments row for that schedule; its
// transactionId is set once, from the first payment, and never
// overwritten by a later one - the full list of transactions lives in
// loan_schedule_payments instead. The loan's outstanding
// principal/interest are decremented only by the amount newly
// allocated on *this* payment, never by the cumulative total.
//
// Deliberately NOT supported here (a later phase's scope):
//   - Paying more than what remains on the instalment (an extra
//     principal payment) - rejected outright, not silently capped or
//     credited forward.
//   - Regenerating the schedule.
//
// A loan cannot be marked CLOSED while it still has an outstanding
// balance (LoanService.update()'s Phase 3 guard) - this service adds
// the mirror-image check on the payment side: a CLOSED loan cannot
// receive a new payment either, even defensively (in the normal flow
// a CLOSED loan has no non-PAID schedule rows left to pay).
// ---------------------------------------------------------------------

export class LoanPaymentService {
    private readonly loanRepository =
        new LoanRepository();

    private readonly scheduleRepository =
        new LoanPaymentScheduleRepository();

    private readonly paymentRepository =
        new LoanSchedulePaymentRepository();

    private readonly transactionService =
        new TransactionService();

    // reversePayment() deliberately uses the repository directly, not
    // TransactionService - TransactionService.delete() refuses to
    // delete an EMI-linked transaction (Loans Phase 6), since deleting
    // one outside this reversal flow would desync the loan's schedule
    // and outstanding balances. This is the one authorized path that
    // deletes the transaction AND performs the matching correction
    // atomically, so it does not go through that guard.
    private readonly transactionRepository =
        new TransactionRepository();

    async processPayment(
        request: ProcessLoanPaymentRequest
    ): Promise<ProcessLoanPaymentResult> {
        if (!request.loanId) {
            throw new Error("Loan is required.");
        }

        if (!request.scheduleId) {
            throw new Error(
                "EMI installment is required."
            );
        }

        if (!request.paymentDate) {
            throw new Error(
                "Payment date is required."
            );
        }

        const loan =
            await this.loanRepository.getById(
                request.loanId
            );

        if (!loan) {
            throw new Error(
                "Loan not found."
            );
        }

        if (!loan.accountId) {
            throw new Error(
                "This loan does not have a linked account."
            );
        }

        if (loan.status === LoanStatus.CLOSED) {
            throw new Error(
                "This loan is closed. No further payments can be recorded."
            );
        }

        const schedule =
            await this.scheduleRepository.getById(
                request.scheduleId
            );

        if (!schedule) {
            throw new Error(
                "EMI installment not found."
            );
        }

        if (schedule.loanId !== loan.id) {
            throw new Error(
                "The EMI installment does not belong to this loan."
            );
        }

        if (
            schedule.status ===
            LoanPaymentStatus.PAID
        ) {
            throw new Error(
                "This EMI installment has already been paid."
            );
        }

        // The ledger of individual payments is authoritative for how
        // much has actually been paid so far - not the schedule row's
        // own cached paidAmount - so a stale cache can never cause an
        // over- or under-payment to be accepted.
        const existingPayments =
            await this.paymentRepository.getAllByScheduleId(
                schedule.id
            );

        const cumulativePaidBefore = roundMoney(
            existingPayments.reduce(
                (sum, payment) => sum + payment.amount,
                0
            )
        );

        const scheduledAmount = roundMoney(
            schedule.totalAmount
        );

        const remainingScheduled = roundMoney(
            Math.max(
                0,
                scheduledAmount - cumulativePaidBefore
            )
        );

        if (remainingScheduled <= 0) {
            throw new Error(
                "This EMI installment has already been paid."
            );
        }

        const amountPaid = roundMoney(
            request.amount ?? remainingScheduled
        );

        if (amountPaid <= 0) {
            throw new Error(
                "Payment amount must be greater than zero."
            );
        }

        // Paying more than what remains on the instalment is an extra
        // principal payment - a different feature, not supported yet.
        if (amountPaid > remainingScheduled) {
            throw new Error(
                `Payment amount cannot exceed the remaining scheduled amount of ${remainingScheduled} for this instalment. Paying more than what remains isn't supported yet.`
            );
        }

        const cumulativePaidAfter = roundMoney(
            cumulativePaidBefore + amountPaid
        );

        // Interest is allocated before principal, standard
        // loan-servicing convention, applied cumulatively so a second
        // (or later) payment against the same row only ever gets
        // credited for what its own contribution actually covers -
        // see loanPaymentAllocation.ts. For a first payment on a row
        // (cumulativePaidBefore === 0) this always resolves to exactly
        // the same split as before this correction.
        const interestPaid = roundMoney(
            paidInterestPortion(
                schedule,
                cumulativePaidAfter
            ) -
                paidInterestPortion(
                    schedule,
                    cumulativePaidBefore
                )
        );

        const principalPaid = roundMoney(
            paidPrincipalPortion(
                schedule,
                cumulativePaidAfter
            ) -
                paidPrincipalPortion(
                    schedule,
                    cumulativePaidBefore
                )
        );

        const isFullyPaid =
            cumulativePaidAfter >= scheduledAmount;

        await this.loanRepository.beginTransaction();

        try {
            const transactionId =
                await this.transactionService.create({
                    accountId:
                        loan.accountId,

                    payee:
                        loan.name,

                    type:
                        "expense",

                    amount:
                        amountPaid,

                    transactionDate:
                        request.paymentDate,

                    referenceNumber:
                        request.referenceNumber ??
                        null,

                    notes:
                        request.notes ??
                        `EMI payment - Installment ${schedule.installmentNumber}`,

                    status:
                        "CLEARED",

                    paymentMethod:
                        request.paymentMethod ??
                        null,
                });

            await this.paymentRepository.create({
                id: crypto.randomUUID(),
                loanId: loan.id,
                scheduleId: schedule.id,
                transactionId,
                paymentDate: request.paymentDate,
                amount: amountPaid,
                principalAmount: principalPaid,
                interestAmount: interestPaid,
                createdAt: new Date().toISOString(),
            });

            const newOutstandingPrincipal =
                roundMoney(
                    Math.max(
                        0,
                        loan.outstandingPrincipal -
                            principalPaid
                    )
                );

            const newOutstandingInterest =
                roundMoney(
                    Math.max(
                        0,
                        loan.outstandingInterest -
                            interestPaid
                    )
                );

            const loanClosed =
                newOutstandingPrincipal <= 0 &&
                newOutstandingInterest <= 0;

            const updatedSchedule:
                LoanPaymentSchedule = {
                    ...schedule,

                    status:
                        isFullyPaid
                            ? LoanPaymentStatus.PAID
                            : LoanPaymentStatus.PARTIAL,

                    paidDate:
                        request.paymentDate,

                    // Running total across every payment recorded
                    // against this row, not just this one.
                    paidAmount:
                        cumulativePaidAfter,

                    // Set once, from the first payment, and never
                    // overwritten by a later top-up - the full list of
                    // transactions lives in loan_schedule_payments.
                    transactionId:
                        schedule.transactionId ??
                        transactionId,

                    outstandingPrincipal:
                        schedule.outstandingPrincipal,
                };

            await this.scheduleRepository.update(
                updatedSchedule
            );

            const updatedLoan: Loan = {
                ...loan,

                outstandingPrincipal:
                    newOutstandingPrincipal,

                outstandingInterest:
                    newOutstandingInterest,

                status:
                    loanClosed
                        ? LoanStatus.CLOSED
                        : loan.status,
            };

            await this.loanRepository.updateAccountingBalances(
                updatedLoan.id,
                updatedLoan.outstandingPrincipal,
                updatedLoan.outstandingInterest,
                updatedLoan.status
            );

            await this.loanRepository.commit();

            return {
                transactionId,
                loan: updatedLoan,
                schedule: updatedSchedule,
                principalPaid,
                interestPaid,
                amountPaid,
            };
        } catch (error) {
            try {
                await this.loanRepository.rollback();
            } catch (rollbackError) {
                console.error(
                    "Failed to rollback EMI payment transaction:",
                    rollbackError
                );
            }

            throw error;
        }
    }

    /**
     * Reverses one specific loan_schedule_payments row (Loans Phase
     * 6) - not the whole schedule. Soft-deletes its linked bank
     * transaction (never hard-deleted; a no-op if it was already
     * deleted independently), removes the payment from the ledger,
     * recomputes the owning schedule row from whatever payments
     * survive, restores the loan's outstanding balances by exactly
     * this payment's own stored principal/interest allocation (never
     * a cumulative amount), and reopens the loan if it had auto-closed
     * and the reversal leaves a real balance again. Refuses safely,
     * with no writes at all, if the payment record itself cannot be
     * found (already reversed, or never existed).
     */
    async reversePayment(
        paymentId: string
    ): Promise<ReversePaymentResult> {
        if (!paymentId) {
            throw new Error("Payment is required.");
        }

        const payment =
            await this.paymentRepository.getById(
                paymentId
            );

        if (!payment) {
            throw new Error(
                "This payment record was not found. It may have already been reversed."
            );
        }

        const schedule =
            await this.scheduleRepository.getById(
                payment.scheduleId
            );

        if (!schedule) {
            throw new Error(
                "EMI installment not found."
            );
        }

        const loan =
            await this.loanRepository.getById(
                payment.loanId
            );

        if (!loan) {
            throw new Error("Loan not found.");
        }

        await this.loanRepository.beginTransaction();

        try {
            // 1. Soft-delete the linked bank transaction if it still
            // exists - never hard-deleted, and a no-op (not an error)
            // if it was already removed independently.
            const transaction =
                await this.transactionRepository.getById(
                    payment.transactionId
                );

            if (transaction) {
                await this.transactionRepository.delete(
                    payment.transactionId
                );
            }

            // 2. Remove the reversed payment from the ledger.
            await this.paymentRepository.delete(
                payment.id
            );

            // 3. Recompute the schedule from whatever payments
            // survive - never by simply decrementing the old cached
            // values, so repeated corrections can never drift.
            const remainingPayments =
                await this.paymentRepository.getAllByScheduleId(
                    schedule.id
                );

            const remainingTotal = roundMoney(
                remainingPayments.reduce(
                    (sum, item) => sum + item.amount,
                    0
                )
            );

            const scheduledAmount = roundMoney(
                schedule.totalAmount
            );

            // getAllByScheduleId orders by created_at, so [0] is the
            // earliest surviving payment - its date and transaction
            // become the schedule's reference, exactly like a fresh
            // first payment would set them.
            const earliestSurviving =
                remainingPayments[0] ?? null;

            const newStatus =
                remainingTotal <= 0
                    ? LoanPaymentStatus.UPCOMING
                    : remainingTotal >= scheduledAmount
                      ? LoanPaymentStatus.PAID
                      : LoanPaymentStatus.PARTIAL;

            const updatedSchedule:
                LoanPaymentSchedule = {
                    ...schedule,

                    status: newStatus,

                    paidAmount:
                        remainingTotal > 0
                            ? remainingTotal
                            : null,

                    paidDate:
                        earliestSurviving?.paymentDate ??
                        null,

                    transactionId:
                        earliestSurviving?.transactionId ??
                        null,

                    outstandingPrincipal:
                        schedule.outstandingPrincipal,
                };

            await this.scheduleRepository.update(
                updatedSchedule
            );

            // 4. Restore outstanding balances by exactly this
            // payment's own stored allocation - never the cumulative
            // total, so reversing one payment can never disturb what
            // any other payment already correctly contributed.
            const newOutstandingPrincipal = roundMoney(
                loan.outstandingPrincipal +
                    payment.principalAmount
            );

            const newOutstandingInterest = roundMoney(
                loan.outstandingInterest +
                    payment.interestAmount
            );

            // 5. Reopen the loan if this reversal leaves it with a
            // real outstanding balance again - the mirror image of
            // processPayment's auto-close.
            const newLoanStatus =
                loan.status === LoanStatus.CLOSED &&
                (newOutstandingPrincipal > 0 ||
                    newOutstandingInterest > 0)
                    ? LoanStatus.ACTIVE
                    : loan.status;

            await this.loanRepository.updateAccountingBalances(
                loan.id,
                newOutstandingPrincipal,
                newOutstandingInterest,
                newLoanStatus
            );

            await this.loanRepository.commit();

            return {
                payment,
                schedule: updatedSchedule,
                loan: {
                    ...loan,
                    outstandingPrincipal:
                        newOutstandingPrincipal,
                    outstandingInterest:
                        newOutstandingInterest,
                    status: newLoanStatus,
                },
            };
        } catch (error) {
            try {
                await this.loanRepository.rollback();
            } catch (rollbackError) {
                console.error(
                    "Failed to rollback loan payment reversal transaction:",
                    rollbackError
                );
            }

            throw error;
        }
    }
}

function roundMoney(
    value: number
): number {
    return Math.round(
        (value + Number.EPSILON) * 100
    ) / 100;
}
