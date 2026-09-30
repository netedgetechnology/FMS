import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
    invoke: (...args: unknown[]) => invoke(...args),
}));

import { DocumentService } from "./DocumentService";
import type { Document } from "../types";

function document(overrides: Partial<Document> = {}): Document {
    return {
        id: "doc-1",
        name: "Passport.pdf",
        documentType: "IDENTITY",
        filePath: "C:\\storage\\documents\\doc-1.pdf",
        fileSize: 1024,
        mimeType: "application/pdf",
        checksum: "abc123",
        relatedEntityType: null,
        relatedEntityId: null,
        description: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

describe("DocumentService.delete", () => {
    const repository = {
        getById: vi.fn(),
        delete: vi.fn(),
    };

    function createService(): DocumentService {
        const service = new DocumentService();

        Object.defineProperty(service, "repository", {
            value: repository,
        });

        return service;
    }

    beforeEach(() => {
        vi.clearAllMocks();
        invoke.mockResolvedValue(undefined);
        repository.delete.mockResolvedValue(undefined);
    });

    it("removes the stored file via the Rust command, then soft-deletes the record", async () => {
        repository.getById.mockResolvedValue(document());

        await createService().delete("doc-1");

        expect(invoke).toHaveBeenCalledWith(
            "delete_document_file",
            { documentId: "doc-1" }
        );
        expect(repository.delete).toHaveBeenCalledWith("doc-1");
    });

    it("is a no-op when the document record no longer exists (already deleted)", async () => {
        repository.getById.mockResolvedValue(null);

        await createService().delete("doc-1");

        expect(invoke).not.toHaveBeenCalled();
        expect(repository.delete).not.toHaveBeenCalled();
    });

    it("propagates the real error when the Rust file-delete command fails", async () => {
        repository.getById.mockResolvedValue(document());

        // A Tauri invoke() rejection is a plain string, never an Error
        // instance - the service must not swallow it, so the caller's
        // error handling (getErrorMessage) can still see the real reason.
        invoke.mockRejectedValue(
            "Selected file does not exist."
        );

        await expect(
            createService().delete("doc-1")
        ).rejects.toBe("Selected file does not exist.");

        expect(repository.delete).not.toHaveBeenCalled();
    });
});
