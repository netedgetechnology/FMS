import { Repository } from "@/core/database/engine/Repository";

import type {
    ImportBatch,
    UpdateImportBatchRequest,
} from "../types";

export class ImportBatchRepository
    extends Repository
{
    async getAll(): Promise<ImportBatch[]> {
        return await this.select<ImportBatch>(
            `
            SELECT
                id,
                account_id AS accountId,
                import_type AS importType,
                source_file_name AS sourceFileName,
                status,
                total_rows AS totalRows,
                imported_rows AS importedRows,
                duplicate_rows AS duplicateRows,
                failed_rows AS failedRows,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM import_batches
            ORDER BY created_at DESC
            `
        );
    }

    async getById(
        id: string
    ): Promise<ImportBatch | null> {
        const rows =
            await this.select<ImportBatch>(
                `
                SELECT
                    id,
                    account_id AS accountId,
                    import_type AS importType,
                    source_file_name AS sourceFileName,
                    status,
                    total_rows AS totalRows,
                    imported_rows AS importedRows,
                    duplicate_rows AS duplicateRows,
                    failed_rows AS failedRows,
                    created_at AS createdAt,
                    updated_at AS updatedAt
                FROM import_batches
                WHERE id = ?
                `,
                [id]
            );

        return rows[0] ?? null;
    }

    async create(
        batch: ImportBatch
    ): Promise<void> {
        await this.execute(
            `
            INSERT INTO import_batches
            (
                id,
                account_id,
                import_type,
                source_file_name,
                status,
                total_rows,
                imported_rows,
                duplicate_rows,
                failed_rows,
                created_at,
                updated_at
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                batch.id,
                batch.accountId,
                batch.importType,
                batch.sourceFileName,
                batch.status,
                batch.totalRows,
                batch.importedRows,
                batch.duplicateRows,
                batch.failedRows,
                batch.createdAt,
                batch.updatedAt,
            ]
        );
    }

    async update(
        request: UpdateImportBatchRequest
    ): Promise<void> {
        const fields: string[] = [];
        const values: unknown[] = [];

        if (
            request.status !== undefined
        ) {
            fields.push("status = ?");
            values.push(request.status);
        }

        if (
            request.totalRows !== undefined
        ) {
            fields.push(
                "total_rows = ?"
            );
            values.push(
                request.totalRows
            );
        }

        if (
            request.importedRows !==
            undefined
        ) {
            fields.push(
                "imported_rows = ?"
            );
            values.push(
                request.importedRows
            );
        }

        if (
            request.duplicateRows !==
            undefined
        ) {
            fields.push(
                "duplicate_rows = ?"
            );
            values.push(
                request.duplicateRows
            );
        }

        if (
            request.failedRows !== undefined
        ) {
            fields.push(
                "failed_rows = ?"
            );
            values.push(
                request.failedRows
            );
        }

        if (fields.length === 0) {
            return;
        }

        fields.push(
            "updated_at = CURRENT_TIMESTAMP"
        );

        values.push(request.id);

        await this.execute(
            `
            UPDATE import_batches
            SET ${fields.join(", ")}
            WHERE id = ?
            `,
            values
        );
    }
}
