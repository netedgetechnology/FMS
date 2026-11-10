import { LoanPaymentStatus } from "./LoanPaymentStatus";

export interface LoanPaymentSchedule {
    id: string;

    loanId: string;

    installmentNumber: number;

    dueDate: string;

    principalAmount: number;

    interestAmount: number;

    totalAmount: number;

    outstandingPrincipal: number;

    /**
     * The lender's own opening principal for this instalment (a
     * lender-imported schedule, migration 051). Absent / null: the opening
     * is the previous instalment's closing (outstandingPrincipal).
     */
    openingPrincipal?: number | null;

    status: LoanPaymentStatus;

    paidDate: string | null;

    paidAmount: number | null;

    transactionId: string | null;

    /**
     * PAID because the user declared it "Settled before FinWea" when adding
     * a loan that was already running (migration 052): there is no bank
     * transaction and no payment record behind it. A PAID instalment with a
     * real payment keeps false and has its loan_schedule_payments row.
     */
    settledBeforeFinwea?: boolean;

    notes?: string;
}
