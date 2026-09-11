import { Repository } from "@/core/database/engine/Repository";

import type {
    CreateGoalAccountLinkRequest,
    GoalAccountLink,
} from "../types";

const SELECT_COLUMNS = `
    id,
    goal_id AS goalId,
    account_id AS accountId,
    is_active AS isActive,
    created_at AS createdAt,
    updated_at AS updatedAt
`;

function coerce(
    row: GoalAccountLink
): GoalAccountLink {
    return {
        ...row,
        isActive: Boolean(row.isActive),
    };
}

export class GoalAccountLinkRepository extends Repository {
    async listByGoal(
        goalId: string
    ): Promise<GoalAccountLink[]> {
        const rows =
            await this.select<GoalAccountLink>(
                `
                SELECT
                    ${SELECT_COLUMNS}
                FROM goal_account_links
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
    ): Promise<GoalAccountLink[]> {
        if (goalIds.length === 0) {
            return [];
        }

        const placeholders = goalIds
            .map(() => "?")
            .join(", ");

        const rows =
            await this.select<GoalAccountLink>(
                `
                SELECT
                    ${SELECT_COLUMNS}
                FROM goal_account_links
                WHERE goal_id IN (${placeholders})
                  AND deleted_at IS NULL
                ORDER BY created_at
                `,
                [...goalIds]
            );

        return rows.map(coerce);
    }

    async create(
        request: CreateGoalAccountLinkRequest & {
            id: string;
        }
    ): Promise<void> {
        await this.execute(
            `
            INSERT INTO goal_account_links
            (
                id,
                goal_id,
                account_id
            )
            VALUES
            (?, ?, ?)
            `,
            [
                request.id,
                request.goalId,
                request.accountId,
            ]
        );
    }

    async softDelete(id: string): Promise<void> {
        await this.execute(
            `
            UPDATE goal_account_links
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
            UPDATE goal_account_links
            SET
                deleted_at = CURRENT_TIMESTAMP
            WHERE goal_id = ?
              AND deleted_at IS NULL
            `,
            [goalId]
        );
    }
}
