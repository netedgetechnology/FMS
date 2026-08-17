import { Repository } from "@/core/database/engine/Repository";

import {
    InvestmentTransaction,
} from "../types";

export class InvestmentTransactionRepository
    extends Repository
{
    async getAllByInvestmentId(
        investmentId: string
    ): Promise<InvestmentTransaction[]> {
        return await this.select<InvestmentTransaction>(
            `
            SELECT
                id,
                investment_id AS investmentId,
                transaction_type AS transactionType,
                transaction_date AS transactionDate,
                quantity,
                price,
                amount,
                fees,
                taxes,
                reference_number AS referenceNumber,
                notes,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM investment_transactions
            WHERE investment_id = ?
            ORDER BY transaction_date DESC, created_at DESC
            `,
            [investmentId]
        );
    }

    async getById(
        id: string
    ): Promise<InvestmentTransaction | null> {
        const rows =
            await this.select<InvestmentTransaction>(
                `
                SELECT
                    id,
                    investment_id AS investmentId,
                    transaction_type AS transactionType,
                    transaction_date AS transactionDate,
                    quantity,
                    price,
                    amount,
                    fees,
                    taxes,
                    reference_number AS referenceNumber,
                    notes,
                    created_at AS createdAt,
                    updated_at AS updatedAt
                FROM investment_transactions
                WHERE id = ?
                `,
                [id]
            );

        return rows[0] ?? null;
    }

    async create(
        transaction: InvestmentTransaction
    ): Promise<void> {
        await this.execute(
            `
            INSERT INTO investment_transactions
            (
                id,
                investment_id,
                transaction_type,
                transaction_date,
                quantity,
                price,
                amount,
                fees,
                taxes,
                reference_number,
                notes,
                created_at,
                updated_at
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                transaction.id,
                transaction.investmentId,
                transaction.transactionType,
                transaction.transactionDate,
                transaction.quantity,
                transaction.price,
                transaction.amount,
                transaction.fees,
                transaction.taxes,
                transaction.referenceNumber,
                transaction.notes ?? null,
                transaction.createdAt,
                transaction.updatedAt,
            ]
        );
    }

    async update(
        transaction: InvestmentTransaction
    ): Promise<void> {
        await this.execute(
            `
            UPDATE investment_transactions
            SET
                transaction_type = ?,
                transaction_date = ?,
                quantity = ?,
                price = ?,
                amount = ?,
                fees = ?,
                taxes = ?,
                reference_number = ?,
                notes = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [
                transaction.transactionType,
                transaction.transactionDate,
                transaction.quantity,
                transaction.price,
                transaction.amount,
                transaction.fees,
                transaction.taxes,
                transaction.referenceNumber,
                transaction.notes ?? null,
                transaction.id,
            ]
        );
    }

    async delete(id: string): Promise<void> {
        await this.execute(
            `
            DELETE FROM investment_transactions
            WHERE id = ?
            `,
            [id]
        );
    }
}
