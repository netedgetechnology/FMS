import { BusinessEntityRepository } from "../repositories";

import {
    BusinessEntity,
    CreateBusinessEntityRequest,
    UpdateBusinessEntityRequest,
} from "../types";

export class BusinessEntityService {

    private readonly repository =
        new BusinessEntityRepository();

    async getAll(): Promise<BusinessEntity[]> {
        return await this.repository.getAll();
    }

    async getById(
        id: string
    ): Promise<BusinessEntity | null> {
        return await this.repository.getById(id);
    }

    async getByName(
        name: string
    ): Promise<BusinessEntity | null> {
        return await this.repository.getByName(
            name
        );
    }

    async create(
        request: CreateBusinessEntityRequest
    ): Promise<string> {

        const now =
            new Date().toISOString();

        const entity: BusinessEntity = {
            id: crypto.randomUUID(),

            name:
                request.name.trim(),

            legalName:
                request.legalName?.trim() || null,

            taxIdentifier:
                request.taxIdentifier?.trim() || null,

            currencyId:
                request.currencyId.trim(),

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
            entity
        );

        return entity.id;
    }

    async update(
        request: UpdateBusinessEntityRequest
    ): Promise<void> {

        await this.repository.update({
            ...request,

            name:
                request.name.trim(),

            legalName:
                request.legalName?.trim() || null,

            taxIdentifier:
                request.taxIdentifier?.trim() || null,

            currencyId:
                request.currencyId.trim(),

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
