import { Repository } from "@/core/database/engine/Repository";

import type {
    ImportMapping,
    SaveImportMappingRequest,
} from "../types";

interface ImportMappingRow {
    id: string;
    name: string;
    institutionName: string | null;
    importType: ImportMapping["importType"];
    headerSignature: string;
    headers: string;
    mapping: string;
    createdAt: string;
    updatedAt: string;
}

export class ImportMappingRepository
    extends Repository
{
    async findBySignature(
        headerSignature: string
    ): Promise<ImportMapping | null> {
        const rows =
            await this.select<ImportMappingRow>(
                `
                SELECT
                    id,
                    name,
                    institution_name AS institutionName,
                    import_type AS importType,
                    header_signature AS headerSignature,
                    headers,
                    mapping,
                    created_at AS createdAt,
                    updated_at AS updatedAt
                FROM import_mappings
                WHERE header_signature = ?
                `,
                [headerSignature]
            );

        return this.mapRow(rows[0]);
    }

    async findById(
        id: string
    ): Promise<ImportMapping | null> {
        const rows =
            await this.select<ImportMappingRow>(
                `
                SELECT
                    id,
                    name,
                    institution_name AS institutionName,
                    import_type AS importType,
                    header_signature AS headerSignature,
                    headers,
                    mapping,
                    created_at AS createdAt,
                    updated_at AS updatedAt
                FROM import_mappings
                WHERE id = ?
                `,
                [id]
            );

        return this.mapRow(rows[0]);
    }

    // Every Saved Mapping, for the "Saved Mappings" management list (see
    // ImportsPage's Saved Mappings section) - not scoped to the currently
    // uploaded file's header structure, unlike findBySignature above.
    async getAll(): Promise<ImportMapping[]> {
        const rows =
            await this.select<ImportMappingRow>(
                `
                SELECT
                    id,
                    name,
                    institution_name AS institutionName,
                    import_type AS importType,
                    header_signature AS headerSignature,
                    headers,
                    mapping,
                    created_at AS createdAt,
                    updated_at AS updatedAt
                FROM import_mappings
                ORDER BY name COLLATE NOCASE ASC
                `
            );

        return rows
            .map(row => this.mapRow(row))
            .filter(
                (mapping): mapping is ImportMapping =>
                    mapping !== null
            );
    }

    // Renames a saved mapping in place - only `name`/`updated_at` change.
    // The mapping's headers/column mapping/header_signature are never
    // touched, so every existing behavior that keys off them (auto-reuse
    // on future imports, self-learning, etc.) is unaffected.
    async rename(
        id: string,
        name: string
    ): Promise<ImportMapping> {
        await this.execute(
            `
            UPDATE import_mappings
            SET name = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [name, id]
        );

        const renamed = await this.findById(id);

        if (!renamed) {
            throw new Error(
                "Import mapping not found."
            );
        }

        return renamed;
    }

    // Persists a confirmed mapping. A mapping already saved for the same
    // header structure (header_signature is UNIQUE) is refreshed in place
    // - same id, updated name/institution/mapping - rather than
    // duplicated, so re-confirming a mapping just keeps it current.
    async upsert(
        request: SaveImportMappingRequest
    ): Promise<ImportMapping> {
        const existing =
            await this.findBySignature(
                request.headerSignature
            );

        const id = existing?.id ?? crypto.randomUUID();

        await this.execute(
            `
            INSERT INTO import_mappings
            (
                id,
                name,
                institution_name,
                import_type,
                header_signature,
                headers,
                mapping,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(header_signature) DO UPDATE SET
                name = excluded.name,
                institution_name = excluded.institution_name,
                import_type = excluded.import_type,
                headers = excluded.headers,
                mapping = excluded.mapping,
                updated_at = CURRENT_TIMESTAMP
            `,
            [
                id,
                request.name,
                request.institutionName,
                request.importType,
                request.headerSignature,
                JSON.stringify(request.headers),
                JSON.stringify(request.mapping),
            ]
        );

        const saved =
            await this.findBySignature(
                request.headerSignature
            );

        if (!saved) {
            throw new Error(
                "Failed to save import mapping."
            );
        }

        return saved;
    }

    private mapRow(
        row: ImportMappingRow | undefined
    ): ImportMapping | null {
        if (!row) {
            return null;
        }

        return {
            id: row.id,
            name: row.name,
            institutionName: row.institutionName,
            importType: row.importType,
            headerSignature: row.headerSignature,
            headers: this.parseJson(
                row.headers
            ) as string[],
            mapping: this.parseJson(
                row.mapping
            ) as ImportMapping["mapping"],
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };
    }

    private parseJson(value: string): unknown {
        try {
            return JSON.parse(value);
        } catch {
            return null;
        }
    }
}
