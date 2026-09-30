import { invoke } from "@tauri-apps/api/core";

import { Repository } from "@/core/database/engine/Repository";

import {
    Category,
    FinanceScope,
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

    // Inserts many new categories inside ONE database transaction (a
    // dedicated Rust command - see src-tauri/src/category_import.rs for
    // why: execute()/select() each check out their own pooled connection,
    // so a TypeScript BEGIN/COMMIT can't guarantee atomicity). Any
    // failure rolls back every insert. Never updates or deletes an
    // existing category: a name that already exists (case-insensitive,
    // whitespace-normalized) is skipped and counted instead.
    async createManyAtomic(
        categories: readonly Category[]
    ): Promise<{ inserted: number; skippedDuplicates: number }> {
        return await invoke<{
            inserted: number;
            skippedDuplicates: number;
        }>("create_categories_atomic", {
            request: {
                categories: categories.map(category => ({
                    id: category.id,
                    parentId: category.parentId,
                    name: category.name,
                    categoryType: category.categoryType,
                    financeScope: category.financeScope,
                    businessEntityId: category.businessEntityId,
                    description: category.description,
                    isActive: category.isActive,
                    createdAt: category.createdAt,
                    updatedAt: category.updatedAt,
                })),
            },
        });
    }

    // Category details only - finance_scope is managed solely from the
    // Scopes screen (updateScopes), so Edit never changes it.
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
                request.businessEntityId ?? null,
                request.description ?? null,
                request.isActive ? 1 : 0,
                request.id,
            ]
        );
    }

    // Scopes screen "Save Changes": sets each given category's own
    // finance_scope (and updated_at) in ONE statement - SQLite applies a
    // single UPDATE atomically, so either every change lands or none does.
    // The changes travel as one JSON array bind (json_each), so there's no
    // bound-parameter limit however many categories changed. No other
    // column is touched; deleted categories are never updated.
    async updateScopes(
        changes: readonly { id: string; financeScope: FinanceScope }[]
    ): Promise<void> {

        await this.execute(
            `
            UPDATE categories
            SET
                finance_scope = (
                    SELECT json_extract(change.value, '$.financeScope')
                    FROM json_each(?1) AS change
                    WHERE json_extract(change.value, '$.id') = categories.id
                ),
                updated_at = CURRENT_TIMESTAMP
            WHERE id IN (
                SELECT json_extract(change.value, '$.id')
                FROM json_each(?1) AS change
            )
              AND deleted_at IS NULL
            `,
            [JSON.stringify(changes)]
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

