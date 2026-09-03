import type { LoanPaymentSchedule } from "../types";

import { EMIScheduleGenerator } from "./EMIScheduleGenerator";

export interface LoanEstimateInput {
    principalAmount: number;
    interestRate: number;
    interestType: "REDUCING" | "FLAT";
    tenureMonths: number;
    startDate: string;
    /** EMIs already paid (for an already-running / imported loan). */
    paidInstallments?: number;
}

export interface LoanEstimate {
    emiAmount: number;
    maturityDate: string;
    outstandingPrincipal: number;
    outstandingInterest: number;
}

const generator = new EMIScheduleGenerator();

function round2(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Derives a loan's EMI, maturity date and initial outstanding balances from
 * its core terms by running the existing EMIScheduleGenerator once (so there
 * is a single source of truth for the amortization maths).
 *
 * Returns null when the inputs are incomplete or invalid - callers get a
 * clean "not enough info yet" signal and never a NaN / Infinity.
 */
export function estimateLoan(
    input: LoanEstimateInput
): LoanEstimate | null {
    const {
        principalAmount,
        interestRate,
        interestType,
        tenureMonths,
        startDate,
    } = input;

    const paidInstallments =
        Number.isFinite(input.paidInstallments)
            ? Math.max(0, Math.floor(input.paidInstallments as number))
            : 0;

    const inputsAreValid =
        Number.isFinite(principalAmount) &&
        principalAmount > 0 &&
        Number.isFinite(interestRate) &&
        interestRate >= 0 &&
        Number.isInteger(tenureMonths) &&
        tenureMonths > 0 &&
        typeof startDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(startDate) &&
        !Number.isNaN(new Date(startDate).getTime());

    if (!inputsAreValid) {
        return null;
    }

    let schedule: LoanPaymentSchedule[];

    try {
        schedule = generator.generate({
            loanId: "loan-estimate",
            principalAmount,
            interestRate,
            interestType:
                interestType === "FLAT" ? "FLAT" : "REDUCING",
            tenureMonths,
            emiAmount: null,
            startDate,
        });
    } catch {
        return null;
    }

    if (schedule.length === 0) {
        return null;
    }

    // How many instalments count as already paid, clamped to the schedule.
    const paid = Math.min(paidInstallments, schedule.length);

    // Remaining (unpaid) interest = the interest of the instalments still due.
    const outstandingInterest = schedule
        .slice(paid)
        .reduce((sum, installment) => sum + installment.interestAmount, 0);

    // Remaining principal after the last paid instalment.
    const outstandingPrincipal =
        paid === 0
            ? principalAmount
            : (schedule[paid - 1]?.outstandingPrincipal ?? 0);

    return {
        // EMI and maturity always reflect the original loan terms - the paid
        // count never changes them (the final row may differ by a few cents
        // of rounding).
        emiAmount: round2(schedule[0].totalAmount),
        maturityDate: schedule[schedule.length - 1].dueDate,
        outstandingPrincipal: round2(outstandingPrincipal),
        outstandingInterest: round2(outstandingInterest),
    };
}
