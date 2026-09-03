import {
    LoanPaymentSchedule,
    LoanPaymentStatus,
} from "../types";

export interface GenerateEMIScheduleRequest {
    loanId: string;
    principalAmount: number;
    interestRate: number;
    interestType: "REDUCING" | "FLAT";
    tenureMonths: number;
    emiAmount?: number | null;
    startDate: string;
    /**
     * Number of leading instalments that were already paid before FinanceOS
     * started tracking the loan. Those rows are returned with status PAID
     * (no transaction is created); EMI / dates are unaffected.
     */
    paidInstallments?: number | null;
}

export class EMIScheduleGenerator {
    generate(
        request: GenerateEMIScheduleRequest
    ): LoanPaymentSchedule[] {
        const {
            principalAmount,
            interestRate,
            interestType,
            tenureMonths,
            emiAmount,
            startDate,
        } = request;

        if (principalAmount <= 0) {
            throw new Error("Principal amount must be greater than zero.");
        }

        if (interestRate < 0) {
            throw new Error("Interest rate cannot be negative.");
        }

        if (!Number.isInteger(tenureMonths) || tenureMonths <= 0) {
            throw new Error("Tenure must be a positive number of months.");
        }

        if (!startDate) {
            throw new Error("Loan start date is required.");
        }

        if (
            emiAmount !== undefined &&
            emiAmount !== null &&
            emiAmount < 0
        ) {
            throw new Error("EMI amount cannot be negative.");
        }

        const schedule =
            interestType === "FLAT"
                ? this.generateFlatSchedule(request)
                : this.generateReducingSchedule(request);

        return this.markPaidInstallments(
            schedule,
            request.paidInstallments
        );
    }

    /**
     * Marks the first N instalments as already paid (imported / running
     * loan). No transaction is attached - this only reflects historical
     * state so the remaining schedule and outstanding balances are correct.
     */
    private markPaidInstallments(
        schedule: LoanPaymentSchedule[],
        paidInstallments?: number | null
    ): LoanPaymentSchedule[] {
        const paid = Math.max(
            0,
            Math.min(
                Math.floor(Number(paidInstallments) || 0),
                schedule.length
            )
        );

        for (let index = 0; index < paid; index++) {
            schedule[index].status = LoanPaymentStatus.PAID;
            schedule[index].paidDate = schedule[index].dueDate;
            schedule[index].paidAmount = schedule[index].totalAmount;
        }

        return schedule;
    }

    private generateReducingSchedule(
        request: GenerateEMIScheduleRequest
    ): LoanPaymentSchedule[] {
        const monthlyRate =
            request.interestRate / 12 / 100;

        let calculatedEmi: number;

        if (
            request.emiAmount !== undefined &&
            request.emiAmount !== null &&
            request.emiAmount > 0
        ) {
            calculatedEmi = request.emiAmount;
        } else if (monthlyRate === 0) {
            calculatedEmi =
                request.principalAmount /
                request.tenureMonths;
        } else {
            const factor = Math.pow(
                1 + monthlyRate,
                request.tenureMonths
            );

            calculatedEmi =
                request.principalAmount *
                monthlyRate *
                factor /
                (factor - 1);
        }

        calculatedEmi = this.round(calculatedEmi);

        let remainingPrincipal =
            this.round(request.principalAmount);

        const schedule: LoanPaymentSchedule[] = [];

        for (
            let installment = 1;
            installment <= request.tenureMonths;
            installment++
        ) {
            if (remainingPrincipal <= 0) {
                break;
            }

            const interestAmount =
                this.round(
                    remainingPrincipal * monthlyRate
                );

            let principalAmount = this.round(
                calculatedEmi - interestAmount
            );

            let totalAmount = calculatedEmi;

            if (installment === request.tenureMonths) {
                principalAmount = remainingPrincipal;
                totalAmount = this.round(
                    principalAmount + interestAmount
                );
            } else if (
                principalAmount > remainingPrincipal
            ) {
                principalAmount = remainingPrincipal;
                totalAmount = this.round(
                    principalAmount + interestAmount
                );
            }

            remainingPrincipal = this.round(
                remainingPrincipal - principalAmount
            );

            schedule.push({
                id: crypto.randomUUID(),
                loanId: request.loanId,
                installmentNumber: installment,
                dueDate: this.addMonths(
                    request.startDate,
                    installment
                ),
                principalAmount,
                interestAmount,
                totalAmount,
                outstandingPrincipal: remainingPrincipal,
                status: LoanPaymentStatus.UPCOMING,
                paidDate: null,
                paidAmount: null,
                transactionId: null,
            });
        }

        return schedule;
    }

    private generateFlatSchedule(
        request: GenerateEMIScheduleRequest
    ): LoanPaymentSchedule[] {
        const monthlyPrincipal =
            request.principalAmount /
            request.tenureMonths;

        const totalInterest =
            request.principalAmount *
            request.interestRate *
            request.tenureMonths /
            12 /
            100;

        const monthlyInterest =
            totalInterest /
            request.tenureMonths;

        let remainingPrincipal =
            this.round(request.principalAmount);

        const schedule: LoanPaymentSchedule[] = [];

        for (
            let installment = 1;
            installment <= request.tenureMonths;
            installment++
        ) {
            let principalAmount =
                this.round(monthlyPrincipal);

            const interestAmount =
                this.round(monthlyInterest);

            if (installment === request.tenureMonths) {
                principalAmount = remainingPrincipal;
            }

            const totalAmount =
                this.round(
                    principalAmount +
                    interestAmount
                );

            remainingPrincipal =
                this.round(
                    remainingPrincipal -
                    principalAmount
                );

            schedule.push({
                id: crypto.randomUUID(),
                loanId: request.loanId,
                installmentNumber: installment,
                dueDate: this.addMonths(
                    request.startDate,
                    installment
                ),
                principalAmount,
                interestAmount,
                totalAmount,
                outstandingPrincipal: remainingPrincipal,
                status: LoanPaymentStatus.UPCOMING,
                paidDate: null,
                paidAmount: null,
                transactionId: null,
            });
        }

        return schedule;
    }

    private round(value: number): number {
        return Math.round(
            (value + Number.EPSILON) * 100
        ) / 100;
    }

    private addMonths(
        dateString: string,
        months: number
    ): string {
        const [year, month, day] =
            dateString.split("-").map(Number);

        const date = new Date(
            Date.UTC(year, month - 1, day)
        );

        date.setUTCMonth(
            date.getUTCMonth() + months
        );

        return [
            date.getUTCFullYear(),
            String(date.getUTCMonth() + 1).padStart(2, "0"),
            String(date.getUTCDate()).padStart(2, "0"),
        ].join("-");
    }
}



