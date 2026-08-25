import { Repository } from "@/core/database/engine/Repository";

import {
    Transfer,
    CreateTransferRequest,
} from "../types";

export class TransferRepository extends Repository {

    private readonly selectFields = `
        id,
        source_account_id AS sourceAccountId,
        destination_account_id AS destinationAccountId,
        amount,
        transaction_date AS transactionDate,
        currency_id AS currencyId,
        reference_number AS referenceNumber,
        notes,
        created_at AS createdAt,
        updated_at AS updatedAt,
        deleted_at AS deletedAt
    `;

    async getAll(): Promise<Transfer[]> {
        return await this.select<Transfer>(
            `
            SELECT
                ${this.selectFields}
            FROM transfers
            WHERE deleted_at IS NULL
            ORDER BY transaction_date DESC,
                     created_at DESC
            `
        );
    }

    async getById(
        id: string
    ): Promise<Transfer | null> {

        const rows =
            await this.select<Transfer>(
                `
                SELECT
                    ${this.selectFields}
                FROM transfers
                WHERE id = ?
                  AND deleted_at IS NULL
                `,
                [id]
            );

        return rows[0] ?? null;
    }

    async getAllByAccountId(
        accountId: string
    ): Promise<Transfer[]> {

        return await this.select<Transfer>(
            `
            SELECT
                ${this.selectFields}
            FROM transfers
            WHERE (
                    source_account_id = ?
                    OR destination_account_id = ?
                  )
              AND deleted_at IS NULL
            ORDER BY transaction_date DESC,
                     created_at DESC
            `,
            [
                accountId,
                accountId,
            ]
        );
    }

    async getAllByAccountIdUpToDate(
        accountId: string,
        transactionDate: string
    ): Promise<Transfer[]> {

        return await this.select<Transfer>(
            `
            SELECT
                ${this.selectFields}
            FROM transfers
            WHERE (
                    source_account_id = ?
                    OR destination_account_id = ?
                  )
              AND transaction_date <= ?
              AND deleted_at IS NULL
            ORDER BY transaction_date ASC,
                     created_at ASC
            `,
            [
                accountId,
                accountId,
                transactionDate,
            ]
        );
    }

    async create(
        transfer: CreateTransferRequest
    ): Promise<void> {

        await this.execute(
            `
            INSERT INTO transfers
            (
                id,
                source_account_id,
                destination_account_id,
                amount,
                transaction_date,
                currency_id,
                reference_number,
                notes,
                created_at,
                updated_at
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `,
            [
                transfer.id,
                transfer.sourceAccountId,
                transfer.destinationAccountId,
                transfer.amount,
                transfer.transactionDate,
                transfer.currencyId,
                transfer.referenceNumber ?? null,
                transfer.notes ?? null,
            ]
        );
    }

    async update(
        transfer: Transfer
    ): Promise<void> {

        await this.execute(
            `
            UPDATE transfers
            SET
                source_account_id = ?,
                destination_account_id = ?,
                amount = ?,
                transaction_date = ?,
                currency_id = ?,
                reference_number = ?,
                notes = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [
                transfer.sourceAccountId,
                transfer.destinationAccountId,
                transfer.amount,
                transfer.transactionDate,
                transfer.currencyId,
                transfer.referenceNumber ?? null,
                transfer.notes ?? null,
                transfer.id,
            ]
        );
    }

    async delete(
        id: string
    ): Promise<void> {

        await this.execute(
            `
            UPDATE transfers
            SET
                deleted_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [id]
        );
    }
}
