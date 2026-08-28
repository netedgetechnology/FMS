import { invoke } from "@tauri-apps/api/core";
import { DocumentRepository } from "../repositories/DocumentRepository";
import {
    Document,
    UpdateDocumentRequest,
} from "../types";

export interface StoredFile {
    filePath: string;
    fileSize: number;
    checksum: string;
}

export class DocumentService {

    private readonly repository: DocumentRepository;

    constructor() {
        this.repository = new DocumentRepository();
    }

    async getAll(): Promise<Document[]> {
        return this.repository.getAll();
    }

    async getById(id: string): Promise<Document | null> {
        return this.repository.getById(id);
    }

    async create(document: Document): Promise<void> {
        await this.repository.create(document);
    }

    async update(document: UpdateDocumentRequest): Promise<void> {
        await this.repository.update(document);
    }

    async delete(id: string): Promise<void> {
        const document = await this.repository.getById(id);

        if (!document) {
            return;
        }

        if (document.filePath) {
            await invoke("delete_document_file", {
                documentId: id,
            });
        }

        await this.repository.delete(id);
    }

    async openFile(filePath: string): Promise<void> {
        await invoke("open_document_file", {
            filePath,
        });
    }

    async storeFile(
        sourcePath: string,
        documentId: string,
    ): Promise<StoredFile> {
        return invoke<StoredFile>(
            "store_document_file",
            {
                sourcePath,
                documentId,
            },
        );
    }
}


