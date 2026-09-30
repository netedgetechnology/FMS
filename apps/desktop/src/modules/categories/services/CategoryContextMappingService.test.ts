import { beforeEach, describe, expect, it, vi } from "vitest";

import { CategoryContextMappingService } from "./CategoryContextMappingService";

describe("CategoryContextMappingService.create", () => {
    const repository = {
        create: vi.fn(),
    };

    function createService(): CategoryContextMappingService {
        const service = new CategoryContextMappingService();

        Object.defineProperty(service, "repository", {
            value: repository,
        });

        return service;
    }

    beforeEach(() => {
        vi.clearAllMocks();
        repository.create.mockResolvedValue(undefined);
    });

    it("1. creates an account-specific mapping", async () => {
        const service = createService();

        await service.create({
            categoryId: "cat-salary",
            accountId: "acct-family",
            categoryType: "INCOME",
        });

        expect(repository.create).toHaveBeenCalledTimes(1);
        const mapping = repository.create.mock.calls[0][0];
        expect(mapping.accountId).toBe("acct-family");
        expect(mapping.businessEntityId).toBeNull();
        expect(mapping.categoryType).toBe("INCOME");
    });

    it("2. creates a business-entity-specific mapping", async () => {
        const service = createService();

        await service.create({
            categoryId: "cat-salary",
            businessEntityId: "entity-netedge",
            categoryType: "EXPENSE",
        });

        const mapping = repository.create.mock.calls[0][0];
        expect(mapping.businessEntityId).toBe("entity-netedge");
        expect(mapping.accountId).toBeNull();
        expect(mapping.categoryType).toBe("EXPENSE");
    });

    it("3. rejects a mapping with both an account and a business entity", async () => {
        const service = createService();

        await expect(
            service.create({
                categoryId: "cat-salary",
                accountId: "acct-family",
                businessEntityId: "entity-netedge",
                categoryType: "INCOME",
            })
        ).rejects.toThrow(/exactly one/);

        expect(repository.create).not.toHaveBeenCalled();
    });

    it("4. rejects a mapping with neither an account nor a business entity", async () => {
        const service = createService();

        await expect(
            service.create({
                categoryId: "cat-salary",
                categoryType: "INCOME",
            })
        ).rejects.toThrow(/exactly one/);

        expect(repository.create).not.toHaveBeenCalled();
    });

    it("5. converts a UNIQUE constraint failure into a friendly, actionable error", async () => {
        const service = createService();

        repository.create.mockRejectedValue(
            "error returned from database: (code: 2067) UNIQUE constraint failed: category_context_mappings.category_id, category_context_mappings.account_id"
        );

        await expect(
            service.create({
                categoryId: "cat-salary",
                accountId: "acct-family",
                categoryType: "INCOME",
            })
        ).rejects.toThrow(/mapping already exists for this category and account/);
    });
});

describe("CategoryContextMappingService.update", () => {
    const existing = {
        id: "map-1",
        categoryId: "cat-salary",
        accountId: "acct-family",
        businessEntityId: null,
        categoryType: "INCOME" as const,
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const repository = {
        getById: vi.fn(),
        update: vi.fn(),
    };

    function createService(): CategoryContextMappingService {
        const service = new CategoryContextMappingService();

        Object.defineProperty(service, "repository", {
            value: repository,
        });

        return service;
    }

    beforeEach(() => {
        vi.clearAllMocks();
        repository.getById.mockResolvedValue(existing);
        repository.update.mockResolvedValue(undefined);
    });

    it("1. updates only the changed fields, keeping the existing target", async () => {
        const service = createService();

        await service.update({
            id: "map-1",
            categoryType: "EXPENSE",
        });

        expect(repository.update).toHaveBeenCalledWith({
            id: "map-1",
            accountId: "acct-family",
            businessEntityId: null,
            categoryType: "EXPENSE",
            isActive: true,
        });
    });

    it("2. rejects switching to both an account and a business entity", async () => {
        const service = createService();

        await expect(
            service.update({
                id: "map-1",
                businessEntityId: "entity-netedge",
            })
        ).rejects.toThrow(/exactly one/);

        expect(repository.update).not.toHaveBeenCalled();
    });

    it("3. throws when the mapping no longer exists", async () => {
        repository.getById.mockResolvedValue(null);

        const service = createService();

        await expect(
            service.update({ id: "missing", categoryType: "EXPENSE" })
        ).rejects.toThrow(/no longer exists/);
    });
});
