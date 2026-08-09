import { Repository } from "@/core/database/engine/Repository";
import {
    Institution,
    UpdateInstitutionRequest,
} from "../types";

export class InstitutionRepository extends Repository {
    async getAll(): Promise<Institution[]> {
        return await this.select(
            `
            SELECT
                id,
                name,
                type,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM institutions
            WHERE deleted_at IS NULL
            ORDER BY name
            `
        );
    }

    async getById(id: string): Promise<Institution | null> {
        const rows = await this.select<Institution>(
            `
            SELECT
                id,
                name,
                type,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM institutions
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [id]
        );

        return rows[0] ?? null;
    }

    async getByName(name: string): Promise<Institution | null> {
        const rows = await this.select<Institution>(
            `
            SELECT
                id,
                name,
                type,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM institutions
            WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
              AND deleted_at IS NULL
            LIMIT 1
            `,
            [name]
        );

        return rows[0] ?? null;
    }

    async create(institution: Institution): Promise<void> {
        await this.execute(
            `
            INSERT INTO institutions
            (
                id,
                name,
                type,
                created_at,
                updated_at
            )
            VALUES
            (?, ?, ?, ?, ?)
            `,
            [
                institution.id,
                institution.name,
                institution.type,
                institution.createdAt,
                institution.updatedAt,
            ]
        );
    }

    async update(request: UpdateInstitutionRequest): Promise<void> {
        await this.execute(
            `
            UPDATE institutions
            SET
                name = ?,
                type = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [
                request.name,
                request.type,
                request.id,
            ]
        );
    }

    async delete(id: string): Promise<void> {
        await this.execute(
            `
            UPDATE institutions
            SET
                deleted_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [id]
        );
    }
}
