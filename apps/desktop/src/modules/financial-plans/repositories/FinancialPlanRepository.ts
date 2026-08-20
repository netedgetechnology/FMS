import { Repository } from "@/core/database/engine/Repository";

import type {
    FinancialPlan,
    UpdateFinancialPlanRequest,
} from "../types";

export class FinancialPlanRepository extends Repository {
    async getAll(): Promise<FinancialPlan[]> {
        return await this.select<FinancialPlan>(
            `
            SELECT
                id,
                name,
                plan_type AS planType,
                plan_category AS planCategory,
                plan_subcategory AS planSubcategory,
                start_date AS startDate,
                end_date AS endDate,
                currency_id AS currencyId,
                target_amount AS targetAmount,
                notes,
                status,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM financial_plans
            WHERE deleted_at IS NULL
            ORDER BY start_date DESC, name
            `
        );
    }

    async getById(
        id: string
    ): Promise<FinancialPlan | null> {
        const rows = await this.select<FinancialPlan>(
            `
            SELECT
                id,
                name,
                plan_type AS planType,
                plan_category AS planCategory,
                plan_subcategory AS planSubcategory,
                start_date AS startDate,
                end_date AS endDate,
                currency_id AS currencyId,
                target_amount AS targetAmount,
                notes,
                status,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM financial_plans
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [id]
        );

        return rows[0] ?? null;
    }

    async create(
        plan: FinancialPlan
    ): Promise<void> {
        await this.execute(
            `
            INSERT INTO financial_plans
            (
                id,
                name,
                plan_type,
                plan_category,
                plan_subcategory,
                start_date,
                end_date,
                currency_id,
                target_amount,
                notes,
                status,
                created_at,
                updated_at
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                plan.id,
                plan.name,
                plan.planType,
                plan.planCategory,
                plan.planSubcategory,
                plan.startDate,
                plan.endDate,
                plan.currencyId,
                plan.targetAmount,
                plan.notes ?? null,
                plan.status,
                plan.createdAt,
                plan.updatedAt,
            ]
        );
    }

    async update(
        plan: UpdateFinancialPlanRequest
    ): Promise<void> {
        await this.execute(
            `
            UPDATE financial_plans
            SET
                name = ?,
                plan_type = ?,
                plan_category = ?,
                plan_subcategory = ?,
                start_date = ?,
                end_date = ?,
                currency_id = ?,
                target_amount = ?,
                notes = ?,
                status = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [
                plan.name,
                plan.planType,
                plan.planCategory,
                plan.planSubcategory,
                plan.startDate,
                plan.endDate ?? null,
                plan.currencyId,
                plan.targetAmount ?? null,
                plan.notes ?? null,
                plan.status,
                plan.id,
            ]
        );
    }

    async delete(id: string): Promise<void> {
        await this.execute(
            `
            UPDATE financial_plans
            SET
                deleted_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [id]
        );
    }
}
