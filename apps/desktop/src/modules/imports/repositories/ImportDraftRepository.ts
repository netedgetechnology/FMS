import { Repository } from "@/core/database/engine/Repository";

import type {
    ImportDraftRecord,
    ImportDraftSummary,
} from "../types";

const SUMMARY_COLUMNS = `
    id,
    format_version AS formatVersion,
    account_id AS accountId,
    import_type AS importType,
    file_name AS fileName,
    row_count AS rowCount,
    created_at AS createdAt,
    updated_at AS updatedAt
`;

// Storage for the unfinished Import Preview draft (import_drafts,
// migration 042). Never touches transactions, import history, mappings or
// any learned/custom rule.
export class ImportDraftRepository extends Repository {
    // The current draft's metadata only - never the large payloads.
    async getSummary(): Promise<ImportDraftSummary | null> {
        const rows = await this.select<ImportDraftSummary>(
            `
            SELECT ${SUMMARY_COLUMNS}
            FROM import_drafts
            ORDER BY updated_at DESC
            LIMIT 1
            `
        );

        return rows[0] ?? null;
    }

    async load(id: string): Promise<ImportDraftRecord | null> {
        const rows = await this.select<ImportDraftRecord>(
            `
            SELECT
                ${SUMMARY_COLUMNS},
                preview_json AS previewJson,
                state_json AS stateJson
            FROM import_drafts
            WHERE id = ?
            `,
            [id]
        );

        return rows[0] ?? null;
    }

    // Writes the whole draft, then removes any other draft - only ever
    // called for a draft the user already chose to start (replacing an
    // older one needs explicit confirmation - see ImportsPage). The new
    // row is written first, so a failure in between never leaves no
    // draft at all.
    async saveFull(record: ImportDraftRecord): Promise<void> {
        await this.execute(
            `
            INSERT INTO import_drafts
            (
                id,
                format_version,
                account_id,
                import_type,
                file_name,
                row_count,
                preview_json,
                state_json,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                format_version = excluded.format_version,
                account_id = excluded.account_id,
                import_type = excluded.import_type,
                file_name = excluded.file_name,
                row_count = excluded.row_count,
                preview_json = excluded.preview_json,
                state_json = excluded.state_json,
                updated_at = excluded.updated_at
            `,
            [
                record.id,
                record.formatVersion,
                record.accountId,
                record.importType,
                record.fileName,
                record.rowCount,
                record.previewJson,
                record.stateJson,
                record.createdAt,
                record.updatedAt,
            ]
        );

        await this.execute(
            `
            DELETE FROM import_drafts
            WHERE id <> ?
            `,
            [record.id]
        );
    }

    // The routine save after an edit: only the small edit-state payload.
    async saveState(
        id: string,
        stateJson: string,
        updatedAt: string
    ): Promise<void> {
        await this.execute(
            `
            UPDATE import_drafts
            SET state_json = ?,
                updated_at = ?
            WHERE id = ?
            `,
            [stateJson, updatedAt, id]
        );
    }

    async delete(id: string): Promise<void> {
        await this.execute(
            `
            DELETE FROM import_drafts
            WHERE id = ?
            `,
            [id]
        );
    }
}
