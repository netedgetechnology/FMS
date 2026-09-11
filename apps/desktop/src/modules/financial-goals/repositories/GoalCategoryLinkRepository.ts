import { Repository } from "@/core/database/engine/Repository";

import type {
    CreateGoalCategoryLinkRequest,
    GoalCategoryLink,
} from "../types";

const SELECT_COLUMNS = `
    id,
    goal_id AS goalId,
    category_id AS categoryId,
    is_active AS isActive,
    created_at AS createdAt,
    updated_at AS updatedAt
`;

function coerce(
    row: GoalCategoryLink
): GoalCategoryLink {
    return {
        ...row,
        isActive: Boolean(row.isActive),
    };
}

export class GoalCategoryLinkRepository extends Repository {
    async listByGoal(
        goalId: string
    ): Promise<GoalCategoryLink[]> {
        const rows =
            await this.select<GoalCategoryLink>(
                `
                SELECT
                    ${SELECT_COLUMNS}
                FROM goal_category_links
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
    ): Promise<GoalCategoryLink[]> {
        if (goalIds.length === 0) {
            return [];
        }

        const placeholders = goalIds
            .map(() => "?")
            .join(", ");

        const rows =
            await this.select<GoalCategoryLink>(
                `
                SELECT
                    ${SELECT_COLUMNS}
                FROM goal_category_links
                WHERE goal_id IN (${placeholders})
                  AND deleted_at IS NULL
                ORDER BY created_at
                `,
                [...goalIds]
            );

        return rows.map(coerce);
    }

    async create(
        request: CreateGoalCategoryLinkRequest & {
            id: string;
        }
    ): Promise<void> {
        await this.execute(
            `
            INSERT INTO goal_category_links
            (
                id,
                goal_id,
                category_id
            )
            VALUES
            (?, ?, ?)
            `,
            [
                request.id,
                request.goalId,
                request.categoryId,
            ]
        );
    }

    async softDelete(id: string): Promise<void> {
        await this.execute(
            `
            UPDATE goal_category_links
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
            UPDATE goal_category_links
            SET
                deleted_at = CURRENT_TIMESTAMP
            WHERE goal_id = ?
              AND deleted_at IS NULL
            `,
            [goalId]
        );
    }
}
