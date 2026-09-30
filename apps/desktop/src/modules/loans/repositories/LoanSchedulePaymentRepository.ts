import { Repository } from "@/core/database/engine/Repository";

import { LoanSchedulePayment } from "../types";

export class LoanSchedulePaymentRepository extends Repository {
    async getAllByScheduleId(
        scheduleId: string
    ): Promise<LoanSchedulePayment[]> {
        return await this.select<LoanSchedulePayment>(
            `
            SELECT
                id,
                loan_id AS loanId,
                schedule_id AS scheduleId,
                transaction_id AS transactionId,
                payment_date AS paymentDate,
                amount,
                principal_amount AS principalAmount,
                interest_amount AS interestAmount,
                created_at AS createdAt
            FROM loan_schedule_payments
            WHERE schedule_id = ?
            ORDER BY created_at ASC, id ASC
            `,
            [scheduleId]
        );
    }

    /**
     * Every payment recorded against any of a loan's schedule rows -
     * used to decide whether the loan can be deleted at all (Loans -
     * Delete Loan policy: a loan with any recorded payment must be
     * refused, not silently stripped of its payment history).
     */
    async getAllByLoanId(
        loanId: string
    ): Promise<LoanSchedulePayment[]> {
        return await this.select<LoanSchedulePayment>(
            `
            SELECT
                id,
                loan_id AS loanId,
                schedule_id AS scheduleId,
                transaction_id AS transactionId,
                payment_date AS paymentDate,
                amount,
                principal_amount AS principalAmount,
                interest_amount AS interestAmount,
                created_at AS createdAt
            FROM loan_schedule_payments
            WHERE loan_id = ?
            ORDER BY created_at ASC, id ASC
            `,
            [loanId]
        );
    }

    async getById(
        id: string
    ): Promise<LoanSchedulePayment | null> {
        const rows = await this.select<LoanSchedulePayment>(
            `
            SELECT
                id,
                loan_id AS loanId,
                schedule_id AS scheduleId,
                transaction_id AS transactionId,
                payment_date AS paymentDate,
                amount,
                principal_amount AS principalAmount,
                interest_amount AS interestAmount,
                created_at AS createdAt
            FROM loan_schedule_payments
            WHERE id = ?
            `,
            [id]
        );

        return rows[0] ?? null;
    }

    /**
     * Whether a transaction is (still) the record of a loan EMI
     * payment - used by TransactionService.delete() to refuse direct
     * deletion of an EMI-linked transaction outside the loan reversal
     * flow (Loans Phase 6).
     */
    async getByTransactionId(
        transactionId: string
    ): Promise<LoanSchedulePayment | null> {
        const rows = await this.select<LoanSchedulePayment>(
            `
            SELECT
                id,
                loan_id AS loanId,
                schedule_id AS scheduleId,
                transaction_id AS transactionId,
                payment_date AS paymentDate,
                amount,
                principal_amount AS principalAmount,
                interest_amount AS interestAmount,
                created_at AS createdAt
            FROM loan_schedule_payments
            WHERE transaction_id = ?
            `,
            [transactionId]
        );

        return rows[0] ?? null;
    }

    /**
     * Which of the given transaction ids currently record a loan EMI
     * payment - used by TransactionService.findEmiLinkedTransactionIds
     * to pre-validate a bulk-delete batch before deleting anything
     * (Transactions - safer bulk delete), so a batch containing an
     * EMI-linked transaction is refused in full rather than partially
     * processed up to the first one delete() itself would refuse.
     * Mirrors GoalLoanLinkRepository.listByGoals' batched-IN-clause
     * shape. A missing/already-deleted transaction id simply matches
     * no row here, the same as getByTransactionId for one id.
     */
    async getByTransactionIds(
        transactionIds: readonly string[]
    ): Promise<LoanSchedulePayment[]> {
        if (transactionIds.length === 0) {
            return [];
        }

        const placeholders = transactionIds
            .map(() => "?")
            .join(", ");

        return await this.select<LoanSchedulePayment>(
            `
            SELECT
                id,
                loan_id AS loanId,
                schedule_id AS scheduleId,
                transaction_id AS transactionId,
                payment_date AS paymentDate,
                amount,
                principal_amount AS principalAmount,
                interest_amount AS interestAmount,
                created_at AS createdAt
            FROM loan_schedule_payments
            WHERE transaction_id IN (${placeholders})
            `,
            [...transactionIds]
        );
    }

    async getAll(): Promise<LoanSchedulePayment[]> {
        return await this.select<LoanSchedulePayment>(
            `
            SELECT
                id,
                loan_id AS loanId,
                schedule_id AS scheduleId,
                transaction_id AS transactionId,
                payment_date AS paymentDate,
                amount,
                principal_amount AS principalAmount,
                interest_amount AS interestAmount,
                created_at AS createdAt
            FROM loan_schedule_payments
            `
        );
    }

    async create(
        payment: LoanSchedulePayment
    ): Promise<void> {
        await this.execute(
            `
            INSERT INTO loan_schedule_payments
            (
                id,
                loan_id,
                schedule_id,
                transaction_id,
                payment_date,
                amount,
                principal_amount,
                interest_amount
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                payment.id,
                payment.loanId,
                payment.scheduleId,
                payment.transactionId,
                payment.paymentDate,
                payment.amount,
                payment.principalAmount,
                payment.interestAmount,
            ]
        );
    }

    async deleteByLoanId(loanId: string): Promise<void> {
        await this.execute(
            `
            DELETE FROM loan_schedule_payments
            WHERE loan_id = ?
            `,
            [loanId]
        );
    }

    /**
     * Removes exactly one payment row - used by
     * LoanPaymentService.reversePayment() (Loans Phase 6). Never used
     * to remove more than the single reversed payment; the schedule
     * row and loan balances are recomputed/restored separately.
     */
    async delete(id: string): Promise<void> {
        await this.execute(
            `
            DELETE FROM loan_schedule_payments
            WHERE id = ?
            `,
            [id]
        );
    }
}
