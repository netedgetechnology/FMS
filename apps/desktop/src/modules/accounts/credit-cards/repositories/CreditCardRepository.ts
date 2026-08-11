import { Repository } from "@/core/database/engine/Repository";
import {
    CreditCard,
    CreateCreditCardRequest,
    UpdateCreditCardRequest,
} from "../types";

export class CreditCardRepository extends Repository {
    async getByAccountId(accountId: string): Promise<CreditCard | null> {
        const rows = await this.select<CreditCard>(
            `
            SELECT
                id,
                account_id AS accountId,
                card_network AS cardNetwork,
                credit_limit AS creditLimit,
                statement_day AS statementDay,
                payment_due_day AS paymentDueDay,
                opening_outstanding_balance AS openingOutstandingBalance,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM credit_cards
            WHERE account_id = ?
              AND deleted_at IS NULL
            `,
            [accountId]
        );

        return rows[0] ?? null;
    }

    async create(request: CreateCreditCardRequest): Promise<void> {
        await this.execute(
            `
            INSERT INTO credit_cards
            (
                id,
                account_id,
                card_network,
                credit_limit,
                statement_day,
                payment_due_day,
                opening_outstanding_balance
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            [
                crypto.randomUUID(),
                request.accountId,
                request.cardNetwork,
                request.creditLimit,
                request.statementDay ?? null,
                request.paymentDueDay ?? null,
                request.openingOutstandingBalance,
            ]
        );
    }

    async update(request: UpdateCreditCardRequest): Promise<void> {
        await this.execute(
            `
            UPDATE credit_cards
            SET
                card_network = ?,
                credit_limit = ?,
                statement_day = ?,
                payment_due_day = ?,
                opening_outstanding_balance = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [
                request.cardNetwork,
                request.creditLimit,
                request.statementDay ?? null,
                request.paymentDueDay ?? null,
                request.openingOutstandingBalance,
                request.id,
            ]
        );
    }

    async deleteByAccountId(accountId: string): Promise<void> {
        await this.execute(
            `
            UPDATE credit_cards
            SET deleted_at = CURRENT_TIMESTAMP
            WHERE account_id = ?
              AND deleted_at IS NULL
            `,
            [accountId]
        );
    }
}
