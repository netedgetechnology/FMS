import { Repository } from "@/core/database/engine/Repository";

import {
    BusinessEntity,
    UpdateBusinessEntityRequest,
} from "../types";

export class BusinessEntityRepository extends Repository {

    async getAll(): Promise<BusinessEntity[]> {

        const rows =
            await this.select<BusinessEntity>(
                `
                SELECT
                    id,
                    name,
                    legal_name AS legalName,
                    tax_identifier AS taxIdentifier,
                    currency_id AS currencyId,
                    description,
                    is_active AS isActive,
                    created_at AS createdAt,
                    updated_at AS updatedAt
                FROM business_entities
                WHERE deleted_at IS NULL
                ORDER BY name
                `
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
    ): Promise<BusinessEntity | null> {

        const rows =
            await this.select<BusinessEntity>(
                `
                SELECT
                    id,
                    name,
                    legal_name AS legalName,
                    tax_identifier AS taxIdentifier,
                    currency_id AS currencyId,
                    description,
                    is_active AS isActive,
                    created_at AS createdAt,
                    updated_at AS updatedAt
                FROM business_entities
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

    async getByName(
        name: string
    ): Promise<BusinessEntity | null> {

        const rows =
            await this.select<BusinessEntity>(
                `
                SELECT
                    id,
                    name,
                    legal_name AS legalName,
                    tax_identifier AS taxIdentifier,
                    currency_id AS currencyId,
                    description,
                    is_active AS isActive,
                    created_at AS createdAt,
                    updated_at AS updatedAt
                FROM business_entities
                WHERE LOWER(TRIM(name)) =
                      LOWER(TRIM(?))
                  AND deleted_at IS NULL
                LIMIT 1
                `,
                [name]
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
        entity: BusinessEntity
    ): Promise<void> {

        await this.execute(
            `
            INSERT INTO business_entities
            (
                id,
                name,
                legal_name,
                tax_identifier,
                currency_id,
                description,
                is_active,
                created_at,
                updated_at
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                entity.id,
                entity.name,
                entity.legalName,
                entity.taxIdentifier,
                entity.currencyId,
                entity.description,
                entity.isActive ? 1 : 0,
                entity.createdAt,
                entity.updatedAt,
            ]
        );
    }

    async update(
        request: UpdateBusinessEntityRequest
    ): Promise<void> {

        await this.execute(
            `
            UPDATE business_entities
            SET
                name = ?,
                legal_name = ?,
                tax_identifier = ?,
                currency_id = ?,
                description = ?,
                is_active = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [
                request.name,
                request.legalName ?? null,
                request.taxIdentifier ?? null,
                request.currencyId,
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
            UPDATE business_entities
            SET
                deleted_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [id]
        );
    }
}
