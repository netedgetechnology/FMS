import { Repository } from "@/core/database/engine/Repository";

import type {
    CreateGoalLoanLinkRequest,
    GoalLoanLink,
} from "../types";

const SELECT_COLUMNS = `
    id,
    goal_id AS goalId,
    loan_id AS loanId,
    is_active AS isActive,
    created_at AS createdAt,
    updated_at AS updatedAt
`;

function coerce(row: GoalLoanLink): GoalLoanLink {
    return {
        ...row,
        isActive: Boolean(row.isActive),
    };
}

export class GoalLoanLinkRepository extends Repository {
    async listByGoal(
        goalId: string
    ): Promise<GoalLoanLink[]> {
        const rows = await this.select<GoalLoanLink>(
            `
            SELECT
                ${SELECT_COLUMNS}
            FROM goal_loan_links
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
    ): Promise<GoalLoanLink[]> {
        if (goalIds.length === 0) {
            return [];
        }

        const placeholders = goalIds
            .map(() => "?")
            .join(", ");

        const rows = await this.select<GoalLoanLink>(
            `
            SELECT
                ${SELECT_COLUMNS}
            FROM goal_loan_links
            WHERE goal_id IN (${placeholders})
              AND deleted_at IS NULL
            ORDER BY created_at
            `,
            [...goalIds]
        );

        return rows.map(coerce);
    }

    async create(
        request: CreateGoalLoanLinkRequest & {
            id: string;
        }
    ): Promise<void> {
        await this.execute(
            `
            INSERT INTO goal_loan_links
            (
                id,
                goal_id,
                loan_id
            )
            VALUES
            (?, ?, ?)
            `,
            [
                request.id,
                request.goalId,
                request.loanId,
            ]
        );
    }

    async softDelete(id: string): Promise<void> {
        await this.execute(
            `
            UPDATE goal_loan_links
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
            UPDATE goal_loan_links
            SET
                deleted_at = CURRENT_TIMESTAMP
            WHERE goal_id = ?
              AND deleted_at IS NULL
            `,
            [goalId]
        );
    }
}
