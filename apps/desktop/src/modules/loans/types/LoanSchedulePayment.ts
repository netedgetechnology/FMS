/**
 * One immutable, historical payment recorded against a
 * LoanPaymentSchedule row (Loans Phase 4 correction). A schedule row
 * can accumulate more than one of these - a first partial payment,
 * then a later one that completes it - each with its own transaction
 * link and its own principal/interest allocation snapshot. Never
 * updated or rewritten after creation; only ever inserted, and deleted
 * only alongside its parent loan (LoanService.delete()).
 */
export interface LoanSchedulePayment {
    id: string;

    loanId: string;

    scheduleId: string;

    transactionId: string;

    paymentDate: string;

    amount: number;

    principalAmount: number;

    interestAmount: number;

    /**
     * Whether the payment records an EXISTING transaction (a statement
     * debit, or one linked by hand) instead of one it created - reversing
     * it then only unlinks that transaction (migration 046).
     */
    transactionLinked: boolean;

    /**
     * Whether this payment settled its instalment in full although it was
     * less than the scheduled amount - the user's explicit choice when a
     * lender's actual debit differs from the calculated EMI. The
     * difference stays visible: the instalment's totalAmount is unchanged
     * and its paidAmount is what was really paid (migration 046).
     */
    settlesInstallment: boolean;

    createdAt: string;
}
