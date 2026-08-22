import { Repository } from "@/core/database/engine/Repository";

import type {
    Budget,
    UpdateBudgetRequest,
} from "../types";

export class BudgetRepository extends Repository {
    async getAll(): Promise<Budget[]> {
        return await this.select<Budget>(
            `
            SELECT
                id,
                name,
                category_id AS categoryId,
                business_entity_id AS businessEntityId,
                amount,
                period_type AS periodType,
                start_date AS startDate,
                end_date AS endDate,
                currency_id AS currencyId,
                alert_threshold AS alertThreshold,
                is_active AS isActive,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM budgets
            WHERE deleted_at IS NULL
            ORDER BY start_date DESC, name
            `
        );
    }

    async getById(
        id: string
    ): Promise<Budget | null> {
        const rows = await this.select<Budget>(
            `
            SELECT
                id,
                name,
                category_id AS categoryId,
                business_entity_id AS businessEntityId,
                amount,
                period_type AS periodType,
                start_date AS startDate,
                end_date AS endDate,
                currency_id AS currencyId,
                alert_threshold AS alertThreshold,
                is_active AS isActive,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM budgets
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [id]
        );

        return rows[0] ?? null;
    }

    async create(
        budget: Budget
    ): Promise<void> {
        await this.execute(
            `
            INSERT INTO budgets
            (
                id,
                name,
                category_id,
                business_entity_id,
                amount,
                period_type,
                start_date,
                end_date,
                currency_id,
                alert_threshold,
                is_active,
                created_at,
                updated_at
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                budget.id,
                budget.name,
                budget.categoryId,
                budget.businessEntityId,
                budget.amount,
                budget.periodType,
                budget.startDate,
                budget.endDate,
                budget.currencyId,
                budget.alertThreshold,
                budget.isActive ? 1 : 0,
                budget.createdAt,
                budget.updatedAt,
            ]
        );
    }

    async update(
        budget: UpdateBudgetRequest
    ): Promise<void> {
        await this.execute(
            `
            UPDATE budgets
            SET
                name = ?,
                category_id = ?,
                business_entity_id = ?,
                amount = ?,
                period_type = ?,
                start_date = ?,
                end_date = ?,
                currency_id = ?,
                alert_threshold = ?,
                is_active = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [
                budget.name,
                budget.categoryId ?? null,
                budget.businessEntityId ?? null,
                budget.amount,
                budget.periodType,
                budget.startDate,
                budget.endDate ?? null,
                budget.currencyId,
                budget.alertThreshold ?? 80,
                budget.isActive ?? true ? 1 : 0,
                budget.id,
            ]
        );
    }

    async delete(id: string): Promise<void> {
        await this.execute(
            `
            UPDATE budgets
            SET
                deleted_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [id]
        );
    }
}
