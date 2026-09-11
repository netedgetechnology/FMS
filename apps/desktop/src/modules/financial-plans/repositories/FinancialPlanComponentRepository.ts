import { Repository } from "@/core/database/engine/Repository";

import type {
    FinancialPlanComponent,
    UpdateFinancialPlanComponentRequest,
} from "../types";

const SELECT_COLUMNS = `
    id,
    plan_id AS planId,
    component_type AS componentType,
    role,
    account_id AS accountId,
    category_id AS categoryId,
    investment_id AS investmentId,
    loan_id AS loanId,
    label,
    target_amount AS targetAmount,
    sort_order AS sortOrder,
    is_active AS isActive,
    notes,
    created_at AS createdAt,
    updated_at AS updatedAt
`;

function coerce(
    row: FinancialPlanComponent
): FinancialPlanComponent {
    return {
        ...row,
        isActive: Boolean(row.isActive),
        sortOrder: Number(row.sortOrder ?? 0),
        targetAmount:
            row.targetAmount === null ||
            row.targetAmount === undefined
                ? null
                : Number(row.targetAmount),
    };
}

export class FinancialPlanComponentRepository extends Repository {
    async listByPlan(
        planId: string
    ): Promise<FinancialPlanComponent[]> {
        const rows =
            await this.select<FinancialPlanComponent>(
                `
                SELECT
                    ${SELECT_COLUMNS}
                FROM financial_plan_components
                WHERE plan_id = ?
                  AND deleted_at IS NULL
                ORDER BY sort_order, created_at
                `,
                [planId]
            );

        return rows.map(coerce);
    }

    async getById(
        id: string
    ): Promise<FinancialPlanComponent | null> {
        const rows =
            await this.select<FinancialPlanComponent>(
                `
                SELECT
                    ${SELECT_COLUMNS}
                FROM financial_plan_components
                WHERE id = ?
                  AND deleted_at IS NULL
                `,
                [id]
            );

        return rows[0] ? coerce(rows[0]) : null;
    }

    async countByPlan(planId: string): Promise<number> {
        const rows = await this.select<{ count: number }>(
            `
            SELECT COUNT(*) AS count
            FROM financial_plan_components
            WHERE plan_id = ?
              AND deleted_at IS NULL
            `,
            [planId]
        );

        return Number(rows[0]?.count ?? 0);
    }

    async create(
        component: FinancialPlanComponent
    ): Promise<void> {
        await this.execute(
            `
            INSERT INTO financial_plan_components
            (
                id,
                plan_id,
                component_type,
                role,
                account_id,
                category_id,
                investment_id,
                loan_id,
                label,
                target_amount,
                sort_order,
                is_active,
                notes,
                created_at,
                updated_at
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                component.id,
                component.planId,
                component.componentType,
                component.role,
                component.accountId,
                component.categoryId,
                component.investmentId,
                component.loanId,
                component.label,
                component.targetAmount,
                component.sortOrder,
                component.isActive ? 1 : 0,
                component.notes,
                component.createdAt,
                component.updatedAt,
            ]
        );
    }

    async update(
        request: UpdateFinancialPlanComponentRequest & {
            sortOrder: number;
            isActive: boolean;
            label: string | null;
            targetAmount: number | null;
            notes: string | null;
        }
    ): Promise<void> {
        await this.execute(
            `
            UPDATE financial_plan_components
            SET
                role = ?,
                label = ?,
                target_amount = ?,
                sort_order = ?,
                is_active = ?,
                notes = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [
                request.role,
                request.label,
                request.targetAmount,
                request.sortOrder,
                request.isActive ? 1 : 0,
                request.notes,
                request.id,
            ]
        );
    }

    async updateSortOrder(
        id: string,
        sortOrder: number
    ): Promise<void> {
        await this.execute(
            `
            UPDATE financial_plan_components
            SET
                sort_order = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [sortOrder, id]
        );
    }

    async softDelete(id: string): Promise<void> {
        await this.execute(
            `
            UPDATE financial_plan_components
            SET
                deleted_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [id]
        );
    }

    async softDeleteByPlan(
        planId: string
    ): Promise<void> {
        await this.execute(
            `
            UPDATE financial_plan_components
            SET
                deleted_at = CURRENT_TIMESTAMP
            WHERE plan_id = ?
              AND deleted_at IS NULL
            `,
            [planId]
        );
    }
}
