import { CategoryRepository } from "../repositories";

import {
    Category,
    CreateCategoryRequest,
    UpdateCategoryRequest,
} from "../types";

export class CategoryService {

    private readonly repository =
        new CategoryRepository();

    async getAll(): Promise<Category[]> {
        return await this.repository.getAll();
    }

    async getById(
        id: string
    ): Promise<Category | null> {
        return await this.repository.getById(id);
    }

    async getByParentId(
        parentId: string | null
    ): Promise<Category[]> {
        return await this.repository.getByParentId(
            parentId
        );
    }

    async create(
        request: CreateCategoryRequest
    ): Promise<string> {

        const now =
            new Date().toISOString();

        const category: Category = {
            id: crypto.randomUUID(),

            parentId:
                request.parentId?.trim() || null,

            name:
                request.name.trim(),

            categoryType:
                request.categoryType,

            financeScope:
                request.financeScope,

            businessEntityId:
                request.businessEntityId?.trim() || null,

            description:
                request.description?.trim() || null,

            isActive:
                request.isActive ?? true,

            createdAt:
                now,

            updatedAt:
                now,
        };

        await this.repository.create(
            category
        );

        return category.id;
    }

    async update(
        request: UpdateCategoryRequest
    ): Promise<void> {

        await this.repository.update({
            ...request,

            parentId:
                request.parentId?.trim() || null,

            name:
                request.name.trim(),

            businessEntityId:
                request.businessEntityId?.trim() || null,

            description:
                request.description?.trim() || null,
        });
    }

    async delete(
        id: string
    ): Promise<void> {

        await this.repository.delete(id);
    }
}
