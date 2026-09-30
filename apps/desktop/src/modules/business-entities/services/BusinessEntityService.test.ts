import { beforeEach, describe, expect, it, vi } from "vitest";

import { BusinessEntityService } from "./BusinessEntityService";

describe("BusinessEntityService.delete", () => {
    const repository = {
        delete: vi.fn(),
    };

    function createService(): BusinessEntityService {
        const service = new BusinessEntityService();

        Object.defineProperty(service, "repository", {
            value: repository,
        });

        return service;
    }

    beforeEach(() => {
        vi.clearAllMocks();
        repository.delete.mockResolvedValue(undefined);
    });

    it("soft-deletes the business entity by id", async () => {
        await createService().delete("entity-1");

        expect(repository.delete).toHaveBeenCalledWith(
            "entity-1"
        );
    });

    it("propagates the real error when the underlying delete fails, instead of swallowing it", async () => {
        // A @tauri-apps/plugin-sql execute() rejection (e.g. a SQLite
        // error) arrives as a plain string, never an Error instance -
        // the service must let it through unchanged so the UI's
        // getErrorMessage() can still surface the real reason.
        repository.delete.mockRejectedValue(
            "error returned from database: (code: 5) database is locked"
        );

        await expect(
            createService().delete("entity-1")
        ).rejects.toBe(
            "error returned from database: (code: 5) database is locked"
        );
    });
});
