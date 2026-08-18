import { Repository } from "@/core/database/engine/Repository";

import {
    Category,
    UpdateCategoryRequest,
} from "../types";

export class CategoryRepository extends Repository {

    async getAll(): Promise<Category[]> {
        return await this.select<Category>(
            `
            SELECT
                id,
                parent_id AS parentId,
                name,
                category_type AS categoryType,
                finance_scope AS financeScope,
                business_entity_id AS businessEntityId,
                description,
                is_active AS isActive,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM categories
            WHERE deleted_at IS NULL
            ORDER BY
                parent_id IS NOT NULL,
                name
            `
        ).then(
            (rows) =>
                rows.map((row) => ({
                    ...row,
                    isActive: Boolean(row.isActive),
                }))
        );
    }

    async getById(
        id: string
    ): Promise<Category | null> {

        const rows =
            await this.select<Category>(
                `
                SELECT
                    id,
                    parent_id AS parentId,
                    name,
                    category_type AS categoryType,
                    finance_scope AS financeScope,
                    business_entity_id AS businessEntityId,
                    description,
                    is_active AS isActive,
                    created_at AS createdAt,
                    updated_at AS updatedAt
                FROM categories
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

    async getByParentId(
        parentId: string | null
    ): Promise<Category[]> {

        const rows =
            parentId === null
                ? await this.select<Category>(
                      `
                      SELECT
                          id,
                          parent_id AS parentId,
                          name,
                          category_type AS categoryType,
                          finance_scope AS financeScope,
                          business_entity_id AS businessEntityId,
                          description,
                          is_active AS isActive,
                          created_at AS createdAt,
                          updated_at AS updatedAt
                      FROM categories
                      WHERE parent_id IS NULL
                        AND deleted_at IS NULL
                      ORDER BY name
                      `
                  )
                : await this.select<Category>(
                      `
                      SELECT
                          id,
                          parent_id AS parentId,
                          name,
                          category_type AS categoryType,
                          finance_scope AS financeScope,
                          business_entity_id AS businessEntityId,
                          description,
                          is_active AS isActive,
                          created_at AS createdAt,
                          updated_at AS updatedAt
                      FROM categories
                      WHERE parent_id = ?
                        AND deleted_at IS NULL
                      ORDER BY name
                      `,
                      [parentId]
                  );

        return rows.map(
            (row) => ({
                ...row,
                isActive: Boolean(row.isActive),
            })
        );
    }

    async create(
        category: Category
    ): Promise<void> {

        await this.execute(
            `
            INSERT INTO categories
            (
                id,
                parent_id,
                name,
                category_type,
                finance_scope,
                business_entity_id,
                description,
                is_active,
                created_at,
                updated_at
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                category.id,
                category.parentId,
                category.name,
                category.categoryType,
                category.financeScope,
                category.businessEntityId,
                category.description,
                category.isActive ? 1 : 0,
                category.createdAt,
                category.updatedAt,
            ]
        );
    }

    async update(
        request: UpdateCategoryRequest
    ): Promise<void> {

        await this.execute(
            `
            UPDATE categories
            SET
                parent_id = ?,
                name = ?,
                category_type = ?,
                finance_scope = ?,
                business_entity_id = ?,
                description = ?,
                is_active = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [
                request.parentId ?? null,
                request.name,
                request.categoryType,
                request.financeScope,
                request.businessEntityId ?? null,
                request.description ?? null,
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
            UPDATE categories
            SET
                deleted_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [id]
        );
    }
}

