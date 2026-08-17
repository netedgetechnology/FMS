import { Repository } from "@/core/database/engine/Repository";

import type {
    InvestmentHolding,
} from "../types";

export class InvestmentHoldingRepository
    extends Repository
{
    async getAllByInvestmentId(
        investmentId: string
    ): Promise<InvestmentHolding[]> {
        return await this.select<InvestmentHolding>(
            `
            SELECT
                id,
                investment_id AS investmentId,
                quantity,
                average_cost AS averageCost,
                current_price AS currentPrice,
                current_value AS currentValue,
                as_of_date AS asOfDate,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM investment_holdings
            WHERE investment_id = ?
            ORDER BY as_of_date DESC, created_at DESC
            `,
            [investmentId]
        );
    }

    async getLatestByInvestmentId(
        investmentId: string
    ): Promise<InvestmentHolding | null> {
        const rows =
            await this.select<InvestmentHolding>(
                `
                SELECT
                    id,
                    investment_id AS investmentId,
                    quantity,
                    average_cost AS averageCost,
                    current_price AS currentPrice,
                    current_value AS currentValue,
                    as_of_date AS asOfDate,
                    created_at AS createdAt,
                    updated_at AS updatedAt
                FROM investment_holdings
                WHERE investment_id = ?
                ORDER BY as_of_date DESC, created_at DESC
                LIMIT 1
                `,
                [investmentId]
            );

        return rows[0] ?? null;
    }

    async create(
        holding: InvestmentHolding
    ): Promise<void> {
        await this.execute(
            `
            INSERT INTO investment_holdings
            (
                id,
                investment_id,
                quantity,
                average_cost,
                current_price,
                current_value,
                as_of_date,
                created_at,
                updated_at
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                holding.id,
                holding.investmentId,
                holding.quantity,
                holding.averageCost,
                holding.currentPrice,
                holding.currentValue,
                holding.asOfDate,
                holding.createdAt,
                holding.updatedAt,
            ]
        );
    }

    async replaceLatest(
        holding: InvestmentHolding
    ): Promise<void> {
        await this.deleteByInvestmentId(
            holding.investmentId
        );

        await this.create(holding);
    }
    async deleteByInvestmentId(
        investmentId: string
    ): Promise<void> {
        await this.execute(
            `
            DELETE FROM investment_holdings
            WHERE investment_id = ?
            `,
            [investmentId]
        );
    }
}

