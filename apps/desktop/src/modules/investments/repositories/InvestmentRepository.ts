import { Repository } from "@/core/database/engine/Repository";

import {
    Investment,
    UpdateInvestmentRequest,
} from "../types";

export class InvestmentRepository extends Repository {
    async getAll(): Promise<Investment[]> {
        return await this.select<Investment>(
            `
            SELECT
                id,
                account_id AS accountId,
                name,
                investment_type AS investmentType,
                investment_subtype AS investmentSubtype,
                symbol,
                isin,
                currency_id AS currencyId,
                broker_institution_id AS brokerInstitutionId,
                quantity,
                average_cost AS averageCost,
                current_price AS currentPrice,
                current_value AS currentValue,
                purchase_date AS purchaseDate,
                status,
                notes,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM investments
            WHERE deleted_at IS NULL
            ORDER BY name
            `
        );
    }

    async getById(
        id: string
    ): Promise<Investment | null> {
        const rows = await this.select<Investment>(
            `
            SELECT
                id,
                account_id AS accountId,
                name,
                investment_type AS investmentType,
                investment_subtype AS investmentSubtype,
                symbol,
                isin,
                currency_id AS currencyId,
                broker_institution_id AS brokerInstitutionId,
                quantity,
                average_cost AS averageCost,
                current_price AS currentPrice,
                current_value AS currentValue,
                purchase_date AS purchaseDate,
                status,
                notes,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM investments
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [id]
        );

        return rows[0] ?? null;
    }

    async create(
        investment: Investment
    ): Promise<void> {
        await this.execute(
            `
            INSERT INTO investments
            (
                id,
                account_id,
                name,
                investment_type,
                investment_subtype,
                symbol,
                isin,
                currency_id,
                broker_institution_id,
                quantity,
                average_cost,
                current_price,
                current_value,
                purchase_date,
                status,
                notes,
                created_at,
                updated_at
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                investment.id,
                investment.accountId,
                investment.name,
                investment.investmentType,
                investment.investmentSubtype ?? null,
                investment.symbol,
                investment.isin,
                investment.currencyId,
                investment.brokerInstitutionId,
                investment.quantity,
                investment.averageCost,
                investment.currentPrice,
                investment.currentValue,
                investment.purchaseDate,
                investment.status,
                investment.notes ?? null,
                investment.createdAt,
                investment.updatedAt,
            ]
        );
    }

    async update(
        investment: UpdateInvestmentRequest & {
            brokerInstitutionId: string | null;
        }
    ): Promise<void> {
        await this.execute(
            `
            UPDATE investments
            SET
                account_id = ?,
                name = ?,
                investment_type = ?,
                investment_subtype = ?,
                symbol = ?,
                isin = ?,
                currency_id = ?,
                broker_institution_id = ?,
                quantity = ?,
                average_cost = ?,
                current_price = ?,
                current_value = ?,
                purchase_date = ?,
                status = ?,
                notes = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [
                investment.accountId,
                investment.name,
                investment.investmentType,
                investment.investmentSubtype ?? null,
                investment.symbol,
                investment.isin,
                investment.currencyId,
                investment.brokerInstitutionId,
                investment.quantity,
                investment.averageCost,
                investment.currentPrice,
                investment.currentValue,
                investment.purchaseDate,
                investment.status,
                investment.notes ?? null,
                investment.id,
            ]
        );
    }

    async updatePortfolioValues(
        id: string,
        quantity: number,
        averageCost: number,
        currentValue: number
    ): Promise<void> {
        await this.execute(
            `
            UPDATE investments
            SET
                quantity = ?,
                average_cost = ?,
                current_value = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [
                quantity,
                averageCost,
                currentValue,
                id,
            ]
        );
    }
    async delete(
        id: string
    ): Promise<void> {
        await this.execute(
            `
            UPDATE investments
            SET
                deleted_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [id]
        );
    }
}

