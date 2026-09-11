import { Repository } from "@/core/database/engine/Repository";

import type {
    CreateGoalInvestmentLinkRequest,
    GoalInvestmentLink,
} from "../types";

const SELECT_COLUMNS = `
    id,
    goal_id AS goalId,
    investment_id AS investmentId,
    is_active AS isActive,
    created_at AS createdAt,
    updated_at AS updatedAt
`;

function coerce(
    row: GoalInvestmentLink
): GoalInvestmentLink {
    return {
        ...row,
        isActive: Boolean(row.isActive),
    };
}

export class GoalInvestmentLinkRepository extends Repository {
    async listByGoal(
        goalId: string
    ): Promise<GoalInvestmentLink[]> {
        const rows =
            await this.select<GoalInvestmentLink>(
                `
                SELECT
                    ${SELECT_COLUMNS}
                FROM goal_investment_links
                WHERE goal_id = ?
                  AND deleted_at IS NULL
                ORDER BY created_at
                `,
                [goalId]
            );

        return rows.map(coerce);
    }

    async listByGoals(
        goalIds: readonly string[]
    ): Promise<GoalInvestmentLink[]> {
        if (goalIds.length === 0) {
            return [];
        }

        const placeholders = goalIds
            .map(() => "?")
            .join(", ");

        const rows =
            await this.select<GoalInvestmentLink>(
                `
                SELECT
                    ${SELECT_COLUMNS}
                FROM goal_investment_links
                WHERE goal_id IN (${placeholders})
                  AND deleted_at IS NULL
                ORDER BY created_at
                `,
                [...goalIds]
            );

        return rows.map(coerce);
    }

    async create(
        request: CreateGoalInvestmentLinkRequest & {
            id: string;
        }
    ): Promise<void> {
        await this.execute(
            `
            INSERT INTO goal_investment_links
            (
                id,
                goal_id,
                investment_id
            )
            VALUES
            (?, ?, ?)
            `,
            [
                request.id,
                request.goalId,
                request.investmentId,
            ]
        );
    }

    async softDelete(id: string): Promise<void> {
        await this.execute(
            `
            UPDATE goal_investment_links
            SET
                deleted_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [id]
        );
    }

    async softDeleteByGoal(
        goalId: string
    ): Promise<void> {
        await this.execute(
            `
            UPDATE goal_investment_links
            SET
                deleted_at = CURRENT_TIMESTAMP
            WHERE goal_id = ?
              AND deleted_at IS NULL
            `,
            [goalId]
        );
    }
}
