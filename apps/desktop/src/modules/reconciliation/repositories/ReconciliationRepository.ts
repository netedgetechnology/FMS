import { Repository } from "@/core/database/engine/Repository";

import {
    Reconciliation,
    CreateReconciliationRequest,
    CompleteReconciliationRequest,
} from "../types";

export class ReconciliationRepository extends Repository {

    async getAll(): Promise<Reconciliation[]> {

        return await this.select<Reconciliation>(
            `
            SELECT
                id,
                account_id AS accountId,
                statement_date AS statementDate,
                statement_balance AS statementBalance,
                system_balance AS systemBalance,
                difference,
                status,
                notes,
                reconciled_at AS reconciledAt,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM reconciliations
            ORDER BY statement_date DESC,
                     created_at DESC
            `
        );

    }

    async getById(
        id: string
    ): Promise<Reconciliation | null> {

        const rows = await this.select<Reconciliation>(
            `
            SELECT
                id,
                account_id AS accountId,
                statement_date AS statementDate,
                statement_balance AS statementBalance,
                system_balance AS systemBalance,
                difference,
                status,
                notes,
                reconciled_at AS reconciledAt,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM reconciliations
            WHERE id = ?
            `,
            [id]
        );

        return rows[0] ?? null;

    }

    async getAllByAccountId(
        accountId: string
    ): Promise<Reconciliation[]> {

        return await this.select<Reconciliation>(
            `
            SELECT
                id,
                account_id AS accountId,
                statement_date AS statementDate,
                statement_balance AS statementBalance,
                system_balance AS systemBalance,
                difference,
                status,
                notes,
                reconciled_at AS reconciledAt,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM reconciliations
            WHERE account_id = ?
            ORDER BY statement_date DESC,
                     created_at DESC
            `,
            [accountId]
        );

    }

    async create(
        request: CreateReconciliationRequest & {
            id: string;
            systemBalance: number;
            difference: number;
        }
    ): Promise<void> {

        await this.execute(
            `
            INSERT INTO reconciliations
            (
                id,
                account_id,
                statement_date,
                statement_balance,
                system_balance,
                difference,
                status,
                notes,
                reconciled_at,
                created_at,
                updated_at
            )
            VALUES
            (?, ?, ?, ?, ?, ?, 'OPEN', ?, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `,
            [
                request.id,
                request.accountId,
                request.statementDate,
                request.statementBalance,
                request.systemBalance,
                request.difference,
                request.notes ?? null,
            ]
        );

    }

    async complete(
        request: CompleteReconciliationRequest
    ): Promise<void> {

        await this.execute(
            `
            UPDATE reconciliations
            SET
                status = 'COMPLETED',
                reconciled_at = ?,
                notes = COALESCE(?, notes),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [
                request.reconciledAt ??
                    new Date().toISOString(),
                request.notes ?? null,
                request.id,
            ]
        );

    }

}
