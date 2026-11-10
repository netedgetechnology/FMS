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
     * Optional broken-period (pre-EMI) interest collected as instalment 1,
     * one month after the start date, before the regular EMIs. Interest
     * only - it repays no principal. The `tenureMonths` regular EMIs then
     * follow, starting one month later, so the schedule has
     * tenureMonths + 1 instalments. Absent/0: unchanged behaviour.
     */
    firstInstallmentAmount?: number | null;
    /**
     * The lender's ACTUAL first EMI due date (Add Loan setup). When given,
     * instalment 1 is due on this date and every later one a month after
     * the previous, on `paymentDay`. Absent: the legacy rule - instalment n
     * is due n months after `startDate` - unchanged.
     */
    firstEmiDate?: string | null;
    /**
     * Day of the month instalments fall on (1-31, clamped to the month's
     * last day). Only used with `firstEmiDate`; defaults to its day.
     */
    paymentDay?: number | null;
    /**
     * Reducing balance only: a final balloon amount left to pay with the
     * last instalment. The EMI (when not given) is sized to leave exactly
     * this much, and the last instalment clears it.
     */
    balloonAmount?: number | null;
    /**
     * Reducing balance only. MONTHLY_RATE (default, legacy): interest =
     * balance x rate / 12 every instalment. ACTUAL_365: interest = balance
     * x rate x days in the period / 365, the first period running from
     * `startDate` (disbursement) to the first due date.
     */
    interestCalculationMethod?: "MONTHLY_RATE" | "ACTUAL_365" | null;
}

/** Internal: where the first instalment's interest period starts. */
type ScheduleRequest = GenerateEMIScheduleRequest & {
    interestPeriodStart?: string;
};

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

        const firstInstallment = request.firstInstallmentAmount;

        if (
            firstInstallment !== undefined &&
            firstInstallment !== null &&
            (!Number.isFinite(firstInstallment) || firstInstallment < 0)
        ) {
            throw new Error("First instalment amount cannot be negative.");
        }

        const hasFirstInstallment =
            typeof firstInstallment === "number" &&
            firstInstallment > 0;

        this.validateSetupOptions(request);

        // With a first (broken-period) instalment, the regular schedule is
        // exactly the one these terms always produce, shifted one month
        // later; the first instalment is put in front of it.
        const regularRequest: ScheduleRequest = hasFirstInstallment
            ? request.firstEmiDate
                ? {
                    ...request,
                    firstEmiDate: this.addMonthsOnDay(
                        request.firstEmiDate,
                        1,
                        this.paymentDayFor(request)
                    ),
                    interestPeriodStart: request.firstEmiDate,
                }
                : {
                    ...request,
                    startDate: this.addMonths(startDate, 1),
                }
            : request;

        const regular =
            interestType === "FLAT"
                ? this.generateFlatSchedule(regularRequest)
                : this.generateReducingSchedule(regularRequest);

        const schedule = hasFirstInstallment
            ? [
                this.firstInstallmentRow(
                    request,
                    this.round(firstInstallment as number)
                ),
                ...regular.map(row => ({
                    ...row,
                    installmentNumber: row.installmentNumber + 1,
                })),
            ]
            : regular;

        // Every instalment is generated UPCOMING. Historical instalments are
        // never marked paid by a count: each one is either linked to its
        // real bank debit or explicitly declared "Settled before FinWea"
        // (setup/historicalInstalments.ts), and create_loan_atomic refuses
        // any PAID row that is neither.
        return schedule;
    }

    /**
     * The broken-period (pre-EMI) first instalment: due one month after
     * the start date, all interest, no principal - the full principal is
     * still outstanding after it.
     */
    private firstInstallmentRow(
        request: GenerateEMIScheduleRequest,
        amount: number
    ): LoanPaymentSchedule {
        return {
            id: crypto.randomUUID(),
            loanId: request.loanId,
            installmentNumber: 1,
            dueDate: request.firstEmiDate
                ? request.firstEmiDate
                : this.addMonths(request.startDate, 1),
            principalAmount: 0,
            interestAmount: amount,
            totalAmount: amount,
            outstandingPrincipal: this.round(request.principalAmount),
            status: LoanPaymentStatus.UPCOMING,
            paidDate: null,
            paidAmount: null,
            transactionId: null,
        };
    }

    private generateReducingSchedule(
        request: ScheduleRequest
    ): LoanPaymentSchedule[] {
        const monthlyRate =
            request.interestRate / 12 / 100;

        const balloon = this.balloonFor(request);
        const actualDays =
            request.interestCalculationMethod === "ACTUAL_365";

        let calculatedEmi: number;

        if (
            request.emiAmount !== undefined &&
            request.emiAmount !== null &&
            request.emiAmount > 0
        ) {
            calculatedEmi = request.emiAmount;
        } else if (monthlyRate === 0) {
            calculatedEmi =
                (request.principalAmount - balloon) /
                request.tenureMonths;
        } else {
            const factor = Math.pow(
                1 + monthlyRate,
                request.tenureMonths
            );

            // P - B / (1+r)^n is the part of the principal the EMIs repay;
            // with no balloon this is exactly the classic annuity formula.
            calculatedEmi =
                (request.principalAmount - balloon / factor) *
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

            const dueDate = this.dueDateFor(request, installment);

            const interestAmount = actualDays
                ? this.round(
                    remainingPrincipal *
                    (request.interestRate / 100) *
                    this.daysBetween(
                        installment === 1
                            ? request.interestPeriodStart ?? request.startDate
                            : this.dueDateFor(request, installment - 1),
                        dueDate
                    ) /
                    365
                )
                : this.round(
                    remainingPrincipal * monthlyRate
                );

            let principalAmount = this.round(
                calculatedEmi - interestAmount
            );

            let totalAmount = calculatedEmi;

            // Interest above the EMI (a long first period on actual days):
            // the instalment is that interest alone and repays no principal,
            // rather than a negative principal that would grow the loan.
            if (principalAmount < 0) {
                principalAmount = 0;
                totalAmount = interestAmount;
            }

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
                dueDate,
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
                dueDate: this.dueDateFor(request, installment),
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

    private validateSetupOptions(
        request: GenerateEMIScheduleRequest
    ): void {
        if (request.firstEmiDate && !this.isIsoDate(request.firstEmiDate)) {
            throw new Error("First EMI date must be a valid date.");
        }

        if (
            request.firstEmiDate &&
            request.startDate &&
            request.firstEmiDate < request.startDate
        ) {
            throw new Error("The first EMI date cannot be before the loan start date.");
        }

        const day = request.paymentDay;

        if (
            day !== undefined &&
            day !== null &&
            (!Number.isInteger(day) || day < 1 || day > 31)
        ) {
            throw new Error("Payment day must be a day of the month (1-31).");
        }

        const balloon = this.balloonFor(request);

        if (balloon > 0 && request.interestType === "FLAT") {
            throw new Error("A balloon payment is only supported for reducing-balance loans.");
        }

        if (balloon > 0 && balloon >= request.principalAmount) {
            throw new Error("The balloon payment must be less than the principal.");
        }

        if (
            request.interestCalculationMethod === "ACTUAL_365" &&
            request.interestType === "FLAT"
        ) {
            throw new Error("Actual-days interest applies to reducing-balance loans only.");
        }
    }

    private balloonFor(request: GenerateEMIScheduleRequest): number {
        const balloon = Number(request.balloonAmount ?? 0);

        if (!Number.isFinite(balloon) || balloon < 0) {
            throw new Error("Balloon payment cannot be negative.");
        }

        return this.round(balloon);
    }

    private paymentDayFor(request: GenerateEMIScheduleRequest): number {
        return (
            request.paymentDay ??
            Number((request.firstEmiDate ?? request.startDate).slice(8, 10))
        );
    }

    /** Instalment n's due date (n counts from 1). */
    private dueDateFor(
        request: GenerateEMIScheduleRequest,
        installment: number
    ): string {
        if (request.firstEmiDate) {
            return this.addMonthsOnDay(
                request.firstEmiDate,
                installment - 1,
                this.paymentDayFor(request)
            );
        }

        return this.addMonths(request.startDate, installment);
    }

    /**
     * `months` after the date's month, on `day` - clamped to that month's
     * last day (31 Jan + 1 month on day 31 = 28/29 Feb, never 3 Mar).
     */
    private addMonthsOnDay(
        dateString: string,
        months: number,
        day: number
    ): string {
        const [year, month] = dateString.split("-").map(Number);
        const target = new Date(Date.UTC(year, month - 1 + months, 1));
        const lastDay = new Date(
            Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
        ).getUTCDate();

        return [
            target.getUTCFullYear(),
            String(target.getUTCMonth() + 1).padStart(2, "0"),
            String(Math.min(day, lastDay)).padStart(2, "0"),
        ].join("-");
    }

    private daysBetween(from: string, to: string): number {
        const start = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
        const end = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);

        return Math.max(0, Math.round((end - start) / 86_400_000));
    }

    private isIsoDate(value: string): boolean {
        return (
            /^\d{4}-\d{2}-\d{2}$/.test(value) &&
            !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
        );
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



