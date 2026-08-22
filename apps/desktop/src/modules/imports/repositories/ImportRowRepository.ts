import { Repository } from "@/core/database/engine/Repository";

import type {
    ImportRow,
    UpdateImportRowRequest,
} from "../types";

export class ImportRowRepository
    extends Repository
{
    async getById(
        id: string
    ): Promise<ImportRow | null> {
        const rows =
            await this.select<ImportRow>(
                `
                SELECT
                    id,
                    import_batch_id AS importBatchId,
                    row_number AS rowNumber,
                    raw_data AS rawData,
                    normalized_data AS normalizedData,
                    transaction_id AS transactionId,
                    status,
                    error_message AS errorMessage,
                    created_at AS createdAt
                FROM import_rows
                WHERE id = ?
                `,
                [id]
            );

        return this.mapRow(
            rows[0]
        );
    }

    async getByBatchId(
        importBatchId: string
    ): Promise<ImportRow[]> {
        const rows =
            await this.select<ImportRow>(
                `
                SELECT
                    id,
                    import_batch_id AS importBatchId,
                    row_number AS rowNumber,
                    raw_data AS rawData,
                    normalized_data AS normalizedData,
                    transaction_id AS transactionId,
                    status,
                    error_message AS errorMessage,
                    created_at AS createdAt
                FROM import_rows
                WHERE import_batch_id = ?
                ORDER BY row_number ASC
                `,
                [importBatchId]
            );

        return rows.map(row =>
            this.mapRow(row)!
        );
    }

    async create(
        row: ImportRow
    ): Promise<void> {
        await this.execute(
            `
            INSERT INTO import_rows
            (
                id,
                import_batch_id,
                row_number,
                raw_data,
                normalized_data,
                transaction_id,
                status,
                error_message,
                created_at
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                row.id,
                row.importBatchId,
                row.rowNumber,
                JSON.stringify(
                    row.rawData
                ),
                row.normalizedData
                    ? JSON.stringify(
                          row.normalizedData
                      )
                    : null,
                row.transactionId,
                row.status,
                row.errorMessage,
                row.createdAt,
            ]
        );
    }

    async update(
        request: UpdateImportRowRequest
    ): Promise<void> {
        const fields: string[] = [];
        const values: unknown[] = [];

        if (
            request.normalizedData !==
            undefined
        ) {
            fields.push(
                "normalized_data = ?"
            );
            values.push(
                request.normalizedData
                    ? JSON.stringify(
                          request.normalizedData
                      )
                    : null
            );
        }

        if (
            request.transactionId !==
            undefined
        ) {
            fields.push(
                "transaction_id = ?"
            );
            values.push(
                request.transactionId
            );
        }

        if (
            request.status !== undefined
        ) {
            fields.push("status = ?");
            values.push(request.status);
        }

        if (
            request.errorMessage !==
            undefined
        ) {
            fields.push(
                "error_message = ?"
            );
            values.push(
                request.errorMessage
            );
        }

        if (fields.length === 0) {
            return;
        }

        values.push(request.id);

        await this.execute(
            `
            UPDATE import_rows
            SET ${fields.join(", ")}
            WHERE id = ?
            `,
            values
        );
    }

    private mapRow(
        row: ImportRow | undefined
    ): ImportRow | null {
        if (!row) {
            return null;
        }

        return {
            ...row,
            rawData:
                this.parseJson(
                    row.rawData
                ) as Record<
                    string,
                    unknown
                >,
            normalizedData:
                row.normalizedData
                    ? (this.parseJson(
                          row.normalizedData
                      ) as Record<
                          string,
                          unknown
                      >)
                    : null,
        };
    }

    private parseJson(
        value: unknown
    ): unknown {
        if (
            typeof value !==
            "string"
        ) {
            return value;
        }

        try {
            return JSON.parse(value);
        } catch {
            return {};
        }
    }
}

