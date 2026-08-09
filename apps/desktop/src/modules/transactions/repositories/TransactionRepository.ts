import { Repository } from "@/core/database/engine/Repository";

import {
    Transaction,
    UpdateTransactionRequest,
} from "../types";

export class TransactionRepository extends Repository {

    async getAll(): Promise<Transaction[]> {

        return await this.select<Transaction>(
            `
            SELECT
                id,
                account_id AS accountId,
                category_id AS categoryId,
                payee,
                type,
                amount,
                transaction_date AS transactionDate,
                reference_number AS referenceNumber,
                notes,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM transactions
            WHERE deleted_at IS NULL
            ORDER BY transaction_date DESC,
                     created_at DESC
            `
        );

    }

    async getById(id: string): Promise<Transaction | null> {

        const rows = await this.select<Transaction>(
            `
            SELECT
                id,
                account_id AS accountId,
                category_id AS categoryId,
                payee,
                type,
                amount,
                transaction_date AS transactionDate,
                reference_number AS referenceNumber,
                notes,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM transactions
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [id]
        );

        return rows[0] ?? null;

    }

    async create(transaction: Transaction): Promise<void> {

        await this.execute(
            `
            INSERT INTO transactions
            (
                id,
                account_id,
                category_id,
                payee,
                type,
                amount,
                transaction_date,
                reference_number,
                notes,
                created_at,
                updated_at
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                transaction.id,
                transaction.accountId,
                transaction.categoryId,
                transaction.payee,
                transaction.type,
                transaction.amount,
                transaction.transactionDate,
                transaction.referenceNumber,
                transaction.notes,
                transaction.createdAt,
                transaction.updatedAt,
            ]
        );

    }

    async update(
        transaction: UpdateTransactionRequest
    ): Promise<void> {

        await this.execute(
            `
            UPDATE transactions
            SET
                account_id = ?,
                category_id = ?,
                payee = ?,
                type = ?,
                amount = ?,
                transaction_date = ?,
                reference_number = ?,
                notes = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [
                transaction.accountId,
                transaction.categoryId,
                transaction.payee,
                transaction.type,
                transaction.amount,
                transaction.transactionDate,
                transaction.referenceNumber,
                transaction.notes,
                transaction.id,
            ]
        );

    }

    async delete(id: string): Promise<void> {

        await this.execute(
            `
            UPDATE transactions
            SET deleted_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [id]
        );

    }

}
