import { Repository } from "@/core/database/engine/Repository";
import {
    Document,
    UpdateDocumentRequest,
} from "../types";

export class DocumentRepository extends Repository {

    async getAll(): Promise<Document[]> {
        return this.select<Document>(
            `
            SELECT
                id,
                name,
                document_type AS documentType,
                file_path AS filePath,
                file_size AS fileSize,
                mime_type AS mimeType,
                checksum,
                related_entity_type AS relatedEntityType,
                related_entity_id AS relatedEntityId,
                description,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM documents
            WHERE deleted_at IS NULL
            ORDER BY created_at DESC
            `
        );
    }

    async getById(id: string): Promise<Document | null> {
        const rows = await this.select<Document>(
            `
            SELECT
                id,
                name,
                document_type AS documentType,
                file_path AS filePath,
                file_size AS fileSize,
                mime_type AS mimeType,
                checksum,
                related_entity_type AS relatedEntityType,
                related_entity_id AS relatedEntityId,
                description,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM documents
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [id]
        );

        return rows[0] ?? null;
    }

    async create(document: Document): Promise<void> {
        await this.execute(
            `
            INSERT INTO documents
            (
                id,
                name,
                document_type,
                file_path,
                file_size,
                mime_type,
                checksum,
                related_entity_type,
                related_entity_id,
                description,
                created_at,
                updated_at
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                document.id,
                document.name,
                document.documentType,
                document.filePath,
                document.fileSize,
                document.mimeType,
                document.checksum,
                document.relatedEntityType,
                document.relatedEntityId,
                document.description,
                document.createdAt,
                document.updatedAt,
            ]
        );
    }

    async update(document: UpdateDocumentRequest): Promise<void> {
        await this.execute(
            `
            UPDATE documents
            SET
                name = ?,
                document_type = ?,
                description = ?,
                related_entity_type = ?,
                related_entity_id = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [
                document.name,
                document.documentType,
                document.description ?? null,
                document.relatedEntityType ?? null,
                document.relatedEntityId ?? null,
                document.id,
            ]
        );
    }

    async delete(id: string): Promise<void> {
        await this.execute(
            `
            UPDATE documents
            SET
                deleted_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [id]
        );
    }
}
