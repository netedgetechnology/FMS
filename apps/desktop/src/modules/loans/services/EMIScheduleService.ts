import { LoanRepository } from "../repositories/LoanRepository";
import { LoanPaymentScheduleRepository } from "../repositories/LoanPaymentScheduleRepository";
import { LoanSchedulePaymentRepository } from "../repositories/LoanSchedulePaymentRepository";
import { EMIScheduleGenerator } from "./EMIScheduleGenerator";
import {
    Loan,
    LoanPaymentSchedule,
    LoanPaymentStatus,
    LoanSchedulePayment,
} from "../types";

function roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface LoanScheduleAndBalances {
    schedule: LoanPaymentSchedule[];
    outstandingPrincipal: number;
    outstandingInterest: number;
    status: Loan["status"];
}

/**
 * The EMI schedule + accounting-balance computation, with no database
 * access - pure so it can run before a single atomic persist (see
 * LoanService.create, which computes this and then persists the loan,
 * its schedule and these balances all in one real transaction, rather
 * than through this class's own generateSchedule, whose separate
 * scheduleRepository.create()/loanRepository.updateAccountingBalances()
 * calls are exactly the multi-call, not-connection-pinned pattern that
 * caused loan creation's "database is locked" / stuck-forever bug).
 */
export function computeLoanScheduleAndBalances(
    loan: Pick<
        Loan,
        | "id"
        | "principalAmount"
        | "interestRate"
        | "interestType"
        | "tenureMonths"
        | "emiAmount"
        | "startDate"
        | "paidInstallments"
        | "status"
    >
): LoanScheduleAndBalances {
    if (loan.principalAmount <= 0) {
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

    const schedule = new EMIScheduleGenerator().generate({
        loanId: loan.id,
        principalAmount: loan.principalAmount,
        interestRate: loan.interestRate,
        interestType: loan.interestType,
        tenureMonths: loan.tenureMonths,
        emiAmount: loan.emiAmount,
        startDate: loan.startDate,
        paidInstallments: loan.paidInstallments,
    });

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

    const status: Loan["status"] =
        outstandingPrincipal <= 0 &&
        outstandingInterest <= 0
            ? "CLOSED"
            : loan.status;

    return {
        schedule,
        outstandingPrincipal,
        outstandingInterest,
        status,
    };
}

export class EMIScheduleService {
    private readonly loanRepository =
        new LoanRepository();

    private readonly scheduleRepository =
        new LoanPaymentScheduleRepository();

    private readonly paymentRepository =
        new LoanSchedulePaymentRepository();

    async getSchedule(
        loanId: string
    ): Promise<LoanPaymentSchedule[]> {
        return await this.scheduleRepository.getAllByLoanId(
            loanId
        );
    }

    /**
     * Every individual payment recorded against one schedule row,
     * oldest first - used by the EMI schedule UI to let a user pick
     * exactly which payment to reverse (Loans Phase 6) rather than
     * assuming the schedule's own cached transactionId is the only
     * (or the right) one to act on.
     */
    async getPaymentsForSchedule(
        scheduleId: string
    ): Promise<LoanSchedulePayment[]> {
        return await this.paymentRepository.getAllByScheduleId(
            scheduleId
        );
    }

    /**
     * Map of transaction id -> interest portion, for every EMI payment
     * transaction ever recorded (LoanPaymentService.processPayment) -
     * sourced directly from loan_schedule_payments (Loans Phase 4
     * correction), which stores each payment's own principal/interest
     * allocation snapshot at the time it was made. A schedule row can
     * have more than one payment (a first partial payment, then a
     * later one completing it) - each keeps its own, exact interest
     * figure here; nothing is re-derived or approximated from the
     * schedule row's own (now cumulative) paidAmount.
     *
     * The budget spending engine uses this to count only the interest
     * part of an EMI as expense; the principal repayment is a liability
     * movement and never counts. All loans are included, not just ACTIVE
     * ones - a closed loan's past EMI payments split the same way.
     */
    async getInterestByTransactionId(): Promise<
        Map<string, number>
    > {
        const payments =
            await this.paymentRepository.getAll();

        const interestByTransactionId =
            new Map<string, number>();

        for (const payment of payments) {
            const interest = Number(
                payment.interestAmount
            );

            interestByTransactionId.set(
                payment.transactionId,
                Number.isFinite(interest)
                    ? interest
                    : 0
            );
        }

        return interestByTransactionId;
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

        const {
            schedule,
            outstandingPrincipal,
            outstandingInterest,
            status,
        } = computeLoanScheduleAndBalances(loan);

        for (const installment of schedule) {
            await this.scheduleRepository.create(
                installment
            );
        }

        await this.loanRepository.updateAccountingBalances(
            loan.id,
            outstandingPrincipal,
            outstandingInterest,
            status
        );

        return schedule;
    }
}
