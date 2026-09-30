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

    createdAt: string;
}
