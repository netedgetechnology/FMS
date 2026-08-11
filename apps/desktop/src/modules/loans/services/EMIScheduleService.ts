import { LoanRepository } from "../repositories/LoanRepository";
import { LoanPaymentScheduleRepository } from "../repositories/LoanPaymentScheduleRepository";
import { EMIScheduleGenerator } from "./EMIScheduleGenerator";
import { LoanPaymentSchedule } from "../types";

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
            });

        for (const installment of schedule) {
            await this.scheduleRepository.create(
                installment
            );
        }

        return schedule;
    }
}
