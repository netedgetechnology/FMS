import { Repository } from "@/core/database/engine/Repository";

import type {
    FinancialGoal,
    UpdateFinancialGoalRequest,
} from "../types";

export class FinancialGoalRepository extends Repository {
    async getAll(): Promise<FinancialGoal[]> {
        return await this.select<FinancialGoal>(
            `
            SELECT
                id,
                name,
                goal_type AS goalType,
                goal_category AS goalCategory,
                goal_subcategory AS goalSubcategory,
                target_amount AS targetAmount,
                current_amount AS currentAmount,
                currency_id AS currencyId,
                target_date AS targetDate,
                priority,
                status,
                notes,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM goals
            WHERE deleted_at IS NULL
            ORDER BY priority DESC, target_date ASC, name
            `
        );
    }

    async getById(
        id: string
    ): Promise<FinancialGoal | null> {
        const rows = await this.select<FinancialGoal>(
            `
            SELECT
                id,
                name,
                goal_type AS goalType,
                goal_category AS goalCategory,
                goal_subcategory AS goalSubcategory,
                target_amount AS targetAmount,
                current_amount AS currentAmount,
                currency_id AS currencyId,
                target_date AS targetDate,
                priority,
                status,
                notes,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM goals
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [id]
        );

        return rows[0] ?? null;
    }

    async create(
        goal: FinancialGoal
    ): Promise<void> {
        await this.execute(
            `
            INSERT INTO goals
            (
                id,
                name,
                goal_type,
                goal_category,
                goal_subcategory,
                target_amount,
                current_amount,
                currency_id,
                target_date,
                priority,
                status,
                notes,
                created_at,
                updated_at
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                goal.id,
                goal.name,
                goal.goalType,
                goal.goalCategory,
                goal.goalSubcategory,
                goal.targetAmount,
                goal.currentAmount,
                goal.currencyId,
                goal.targetDate,
                goal.priority,
                goal.status,
                goal.notes ?? null,
                goal.createdAt,
                goal.updatedAt,
            ]
        );
    }

    async update(
        goal: UpdateFinancialGoalRequest
    ): Promise<void> {
        await this.execute(
            `
            UPDATE goals
            SET
                name = ?,
                goal_type = ?,
                goal_category = ?,
                goal_subcategory = ?,
                target_amount = ?,
                current_amount = ?,
                currency_id = ?,
                target_date = ?,
                priority = ?,
                status = ?,
                notes = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [
                goal.name,
                goal.goalType,
                goal.goalCategory,
                goal.goalSubcategory,
                goal.targetAmount,
                goal.currentAmount,
                goal.currencyId,
                goal.targetDate ?? null,
                goal.priority,
                goal.status,
                goal.notes ?? null,
                goal.id,
            ]
        );
    }

    async delete(id: string): Promise<void> {
        await this.execute(
            `
            UPDATE goals
            SET
                deleted_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [id]
        );
    }
}
