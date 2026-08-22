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

    async findDuplicate(
        accountId: string,
        transactionDate: string,
        type: string,
        amount: number,
        referenceNumber: string | null,
        payee: string,
        description: string
    ): Promise<Transaction | null> {

        if (referenceNumber) {
            const referenceMatches =
                await this.select<Transaction>(
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
                    WHERE account_id = ?
                      AND reference_number = ?
                      AND deleted_at IS NULL
                    LIMIT 1
                    `,
                    [
                        accountId,
                        referenceNumber,
                    ]
                );

            if (referenceMatches[0]) {
                return referenceMatches[0];
            }
        }

        const matches =
            await this.select<Transaction>(
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
                WHERE account_id = ?
                  AND transaction_date = ?
                  AND type = ?
                  AND amount = ?
                  AND deleted_at IS NULL
                  AND (
                      (
                          ? <> ''
                          AND LOWER(TRIM(payee)) =
                              LOWER(TRIM(?))
                      )
                      OR
                      (
                          ? <> ''
                          AND LOWER(TRIM(notes)) =
                              LOWER(TRIM(?))
                      )
                  )
                LIMIT 1
                `,
                [
                    accountId,
                    transactionDate,
                    type,
                    amount,
                    payee,
                    payee,
                    description,
                    description,
                ]
            );

        return matches[0] ?? null;
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


