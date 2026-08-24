import { TransactionService } from "@/modules/transactions/services/TransactionService";
import type {
    PaymentMethod,
} from "@/modules/transactions/types";

import { LoanStatus } from "../types/LoanStatus";
import { LoanRepository } from "../repositories/LoanRepository";
import { LoanPaymentScheduleRepository } from "../repositories/LoanPaymentScheduleRepository";
import {
    Loan,
    LoanPaymentSchedule,
    LoanPaymentStatus,
} from "../types";

export interface ProcessLoanPaymentRequest {
    loanId: string;
    scheduleId: string;
    paymentDate: string;
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

export class LoanPaymentService {
    private readonly loanRepository =
        new LoanRepository();

    private readonly scheduleRepository =
        new LoanPaymentScheduleRepository();

    private readonly transactionService =
        new TransactionService();

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

        const amountPaid =
            roundMoney(
                schedule.totalAmount
            );

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

            const newOutstandingPrincipal =
                roundMoney(
                    Math.max(
                        0,
                        loan.outstandingPrincipal -
                            schedule.principalAmount
                    )
                );

            const newOutstandingInterest =
                roundMoney(
                    Math.max(
                        0,
                        loan.outstandingInterest -
                            schedule.interestAmount
                    )
                );

            const loanClosed =
                newOutstandingPrincipal <= 0 &&
                newOutstandingInterest <= 0;

            const updatedSchedule:
                LoanPaymentSchedule = {
                    ...schedule,

                    status:
                        LoanPaymentStatus.PAID,

                    paidDate:
                        request.paymentDate,

                    paidAmount:
                        amountPaid,

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
                principalPaid:
                    schedule.principalAmount,
                interestPaid:
                    schedule.interestAmount,
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
}

function roundMoney(
    value: number
): number {
    return Math.round(
        (value + Number.EPSILON) * 100
    ) / 100;
}
