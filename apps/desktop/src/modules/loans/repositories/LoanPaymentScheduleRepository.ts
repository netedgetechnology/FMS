import { Repository } from "@/core/database/engine/Repository";

import {
    LoanPaymentSchedule,
} from "../types";

export class LoanPaymentScheduleRepository extends Repository {
    async getAllByLoanId(
        loanId: string
    ): Promise<LoanPaymentSchedule[]> {
        return await this.select<LoanPaymentSchedule>(
            `
            SELECT
                id,
                loan_id AS loanId,
                installment_number AS installmentNumber,
                due_date AS dueDate,
                principal_amount AS principalAmount,
                interest_amount AS interestAmount,
                total_amount AS totalAmount,
                outstanding_principal AS outstandingPrincipal,
                status,
                paid_date AS paidDate,
                paid_amount AS paidAmount,
                transaction_id AS transactionId,
                notes
            FROM loan_payment_schedule
            WHERE loan_id = ?
            ORDER BY installment_number
            `,
            [loanId]
        );
    }

    async getById(
        id: string
    ): Promise<LoanPaymentSchedule | null> {
        const rows = await this.select<LoanPaymentSchedule>(
            `
            SELECT
                id,
                loan_id AS loanId,
                installment_number AS installmentNumber,
                due_date AS dueDate,
                principal_amount AS principalAmount,
                interest_amount AS interestAmount,
                total_amount AS totalAmount,
                outstanding_principal AS outstandingPrincipal,
                status,
                paid_date AS paidDate,
                paid_amount AS paidAmount,
                transaction_id AS transactionId,
                notes
            FROM loan_payment_schedule
            WHERE id = ?
            `,
            [id]
        );

        return rows[0] ?? null;
    }

    async create(
        schedule: LoanPaymentSchedule
    ): Promise<void> {
        await this.execute(
            `
            INSERT INTO loan_payment_schedule
            (
                id,
                loan_id,
                installment_number,
                due_date,
                principal_amount,
                interest_amount,
                total_amount,
                outstanding_principal,
                status,
                paid_date,
                paid_amount,
                transaction_id,
                notes,
                created_at,
                updated_at
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `,
            [
                schedule.id,
                schedule.loanId,
                schedule.installmentNumber,
                schedule.dueDate,
                schedule.principalAmount,
                schedule.interestAmount,
                schedule.totalAmount,
                schedule.outstandingPrincipal,
                schedule.status,
                schedule.paidDate,
                schedule.paidAmount,
                schedule.transactionId,
                schedule.notes ?? null,
            ]
        );
    }

    async update(
        schedule: LoanPaymentSchedule
    ): Promise<void> {
        await this.execute(
            `
            UPDATE loan_payment_schedule
            SET
                due_date = ?,
                principal_amount = ?,
                interest_amount = ?,
                total_amount = ?,
                outstanding_principal = ?,
                status = ?,
                paid_date = ?,
                paid_amount = ?,
                transaction_id = ?,
                notes = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [
                schedule.dueDate,
                schedule.principalAmount,
                schedule.interestAmount,
                schedule.totalAmount,
                schedule.outstandingPrincipal,
                schedule.status,
                schedule.paidDate,
                schedule.paidAmount,
                schedule.transactionId,
                schedule.notes ?? null,
                schedule.id,
            ]
        );
    }

    async deleteByLoanId(
        loanId: string
    ): Promise<void> {
        await this.execute(
            `
            DELETE FROM loan_payment_schedule
            WHERE loan_id = ?
            `,
            [loanId]
        );
    }

    async delete(id: string): Promise<void> {
        await this.execute(
            `
            DELETE FROM loan_payment_schedule
            WHERE id = ?
            `,
            [id]
        );
    }
}

