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

    status: LoanPaymentStatus;

    paidDate: string | null;

    paidAmount: number | null;

    transactionId: string | null;

    notes?: string;
}
