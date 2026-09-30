import { Repository } from "@/core/database/engine/Repository";

import {
    CategoryContextMapping,
    UpdateCategoryContextMappingRequest,
} from "../types";

export class CategoryContextMappingRepository extends Repository {

    async getAll(): Promise<CategoryContextMapping[]> {
        return await this.select<CategoryContextMapping>(
            `
            SELECT
                id,
                category_id AS categoryId,
                account_id AS accountId,
                business_entity_id AS businessEntityId,
                category_type AS categoryType,
                is_active AS isActive,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM category_context_mappings
            WHERE deleted_at IS NULL
            ORDER BY created_at
            `
        ).then(
            (rows) =>
                rows.map((row) => ({
                    ...row,
                    isActive: Boolean(row.isActive),
                }))
        );
    }

    async getByCategoryId(
        categoryId: string
    ): Promise<CategoryContextMapping[]> {

        const rows =
            await this.select<CategoryContextMapping>(
                `
                SELECT
                    id,
                    category_id AS categoryId,
                    account_id AS accountId,
                    business_entity_id AS businessEntityId,
                    category_type AS categoryType,
                    is_active AS isActive,
                    created_at AS createdAt,
                    updated_at AS updatedAt
                FROM category_context_mappings
                WHERE category_id = ?
                  AND deleted_at IS NULL
                ORDER BY created_at
                `,
                [categoryId]
            );

        return rows.map(
            (row) => ({
                ...row,
                isActive: Boolean(row.isActive),
            })
        );
    }

    async getById(
        id: string
    ): Promise<CategoryContextMapping | null> {

        const rows =
            await this.select<CategoryContextMapping>(
                `
                SELECT
                    id,
                    category_id AS categoryId,
                    account_id AS accountId,
                    business_entity_id AS businessEntityId,
                    category_type AS categoryType,
                    is_active AS isActive,
                    created_at AS createdAt,
                    updated_at AS updatedAt
                FROM category_context_mappings
                WHERE id = ?
                  AND deleted_at IS NULL
                `,
                [id]
            );

        const row = rows[0];

        if (!row) {
            return null;
        }

        return {
            ...row,
            isActive: Boolean(row.isActive),
        };
    }

    async create(
        mapping: CategoryContextMapping
    ): Promise<void> {

        await this.execute(
            `
            INSERT INTO category_context_mappings
            (
                id,
                category_id,
                account_id,
                business_entity_id,
                category_type,
                is_active,
                created_at,
                updated_at
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                mapping.id,
                mapping.categoryId,
                mapping.accountId,
                mapping.businessEntityId,
                mapping.categoryType,
                mapping.isActive ? 1 : 0,
                mapping.createdAt,
                mapping.updatedAt,
            ]
        );
    }

    async update(
        request: UpdateCategoryContextMappingRequest & {
            categoryType: CategoryContextMapping["categoryType"];
            accountId: string | null;
            businessEntityId: string | null;
            isActive: boolean;
        }
    ): Promise<void> {

        await this.execute(
            `
            UPDATE category_context_mappings
            SET
                account_id = ?,
                business_entity_id = ?,
                category_type = ?,
                is_active = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [
                request.accountId,
                request.businessEntityId,
                request.categoryType,
                request.isActive ? 1 : 0,
                request.id,
            ]
        );
    }

    async delete(
        id: string
    ): Promise<void> {

        await this.execute(
            `
            UPDATE category_context_mappings
            SET
                deleted_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [id]
        );
    }
}
