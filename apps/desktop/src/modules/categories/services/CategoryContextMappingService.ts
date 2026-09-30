import { CategoryContextMappingRepository } from "../repositories";

import {
    CategoryContextMapping,
    CreateCategoryContextMappingRequest,
    UpdateCategoryContextMappingRequest,
} from "../types";

const UNIQUE_CONSTRAINT_PATTERN = /UNIQUE constraint failed/i;
const CHECK_CONSTRAINT_PATTERN = /CHECK constraint failed/i;

// tauri-plugin-sql rejects with the raw SQLite error text (a plain
// string, not an Error instance) - see CategoryService.test.ts. Convert
// the two constraint failures this table can raise into a message a
// user can act on, and let anything else through unchanged.
function toFriendlyError(
    error: unknown,
    target: "account" | "business entity"
): unknown {
    const message =
        error instanceof Error
            ? error.message
            : typeof error === "string"
                ? error
                : "";

    if (UNIQUE_CONSTRAINT_PATTERN.test(message)) {
        return new Error(
            `A mapping already exists for this category and ${target}. Edit or remove the existing mapping instead.`
        );
    }

    if (CHECK_CONSTRAINT_PATTERN.test(message)) {
        return new Error(
            "A mapping must target exactly one account or business entity, with an Income or Expense type."
        );
    }

    return error;
}

export class CategoryContextMappingService {

    private readonly repository =
        new CategoryContextMappingRepository();

    async getAll(): Promise<CategoryContextMapping[]> {
        return await this.repository.getAll();
    }

    async getByCategoryId(
        categoryId: string
    ): Promise<CategoryContextMapping[]> {
        return await this.repository.getByCategoryId(
            categoryId
        );
    }

    async create(
        request: CreateCategoryContextMappingRequest
    ): Promise<string> {

        const accountId =
            request.accountId?.trim() || null;

        const businessEntityId =
            request.businessEntityId?.trim() || null;

        if (
            (accountId && businessEntityId) ||
            (!accountId && !businessEntityId)
        ) {
            throw new Error(
                "A mapping must target exactly one account or business entity."
            );
        }

        const now =
            new Date().toISOString();

        const mapping: CategoryContextMapping = {
            id: crypto.randomUUID(),

            categoryId:
                request.categoryId,

            accountId,

            businessEntityId,

            categoryType:
                request.categoryType,

            isActive:
                request.isActive ?? true,

            createdAt: now,

            updatedAt: now,
        };

        try {
            await this.repository.create(mapping);
        } catch (error) {
            throw toFriendlyError(
                error,
                accountId ? "account" : "business entity"
            );
        }

        return mapping.id;
    }

    async update(
        request: UpdateCategoryContextMappingRequest
    ): Promise<void> {

        const existing =
            await this.repository.getById(request.id);

        if (!existing) {
            throw new Error(
                "This category mapping no longer exists."
            );
        }

        const accountId =
            request.accountId !== undefined
                ? request.accountId?.trim() || null
                : existing.accountId;

        const businessEntityId =
            request.businessEntityId !== undefined
                ? request.businessEntityId?.trim() || null
                : existing.businessEntityId;

        if (
            (accountId && businessEntityId) ||
            (!accountId && !businessEntityId)
        ) {
            throw new Error(
                "A mapping must target exactly one account or business entity."
            );
        }

        try {
            await this.repository.update({
                id: request.id,
                accountId,
                businessEntityId,
                categoryType:
                    request.categoryType ?? existing.categoryType,
                isActive:
                    request.isActive ?? existing.isActive,
            });
        } catch (error) {
            throw toFriendlyError(
                error,
                accountId ? "account" : "business entity"
            );
        }
    }

    async delete(
        id: string
    ): Promise<void> {

        await this.repository.delete(id);
    }
}
