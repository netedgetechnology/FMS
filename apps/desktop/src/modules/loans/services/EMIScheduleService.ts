import { LoanRepository } from "../repositories/LoanRepository";
import { LoanPaymentScheduleRepository } from "../repositories/LoanPaymentScheduleRepository";
import { EMIScheduleGenerator } from "./EMIScheduleGenerator";
import { LoanPaymentSchedule, LoanPaymentStatus } from "../types";

function roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

export class EMIScheduleService {
    private readonly loanRepository =
        new LoanRepository();

    private readonly scheduleRepository =
        new LoanPaymentScheduleRepository();

    private readonly generator =
        new EMIScheduleGenerator();

    async getSchedule(
        loanId: string
    ): Promise<LoanPaymentSchedule[]> {
        return await this.scheduleRepository.getAllByLoanId(
            loanId
        );
    }

    async generateSchedule(
        loanId: string
    ): Promise<LoanPaymentSchedule[]> {
        const loan =
            await this.loanRepository.getById(loanId);

        if (!loan) {
            throw new Error("Loan not found.");
        }

        const existing =
            await this.scheduleRepository.getAllByLoanId(
                loanId
            );

        if (existing.length > 0) {
            throw new Error(
                "An EMI schedule already exists for this loan."
            );
        }

        if (
            loan.principalAmount <= 0
        ) {
            throw new Error(
                "Loan principal amount must be greater than zero."
            );
        }

        if (
            loan.tenureMonths === null ||
            loan.tenureMonths <= 0
        ) {
            throw new Error(
                "Loan tenure is required to generate an EMI schedule."
            );
        }

        if (!loan.startDate) {
            throw new Error(
                "Loan start date is required to generate an EMI schedule."
            );
        }

        const schedule =
            this.generator.generate({
                loanId: loan.id,
                principalAmount:
                    loan.principalAmount,
                interestRate:
                    loan.interestRate,
                interestType:
                    loan.interestType,
                tenureMonths:
                    loan.tenureMonths,
                emiAmount:
                    loan.emiAmount,
                startDate:
                    loan.startDate,
                paidInstallments:
                    loan.paidInstallments,
            });

        for (const installment of schedule) {
            await this.scheduleRepository.create(
                installment
            );
        }

        /*
         * Reconcile the loan's outstanding balances with the freshly built
         * schedule so an imported / already-running loan (paid_installments
         * > 0) shows its correct current state. EMI amount and maturity date
         * are untouched - they come from the original loan terms.
         */
        const paidCount = schedule.filter(
            installment =>
                installment.status === LoanPaymentStatus.PAID
        ).length;

        const outstandingPrincipal = roundMoney(
            paidCount === 0
                ? loan.principalAmount
                : schedule[paidCount - 1]?.outstandingPrincipal ?? 0
        );

        const outstandingInterest = roundMoney(
            schedule
                .slice(paidCount)
                .reduce(
                    (sum, installment) =>
                        sum + installment.interestAmount,
                    0
                )
        );

        const nextStatus: typeof loan.status =
            outstandingPrincipal <= 0 &&
            outstandingInterest <= 0
                ? "CLOSED"
                : loan.status;

        await this.loanRepository.updateAccountingBalances(
            loan.id,
            outstandingPrincipal,
            outstandingInterest,
            nextStatus
        );

        return schedule;
    }
}
