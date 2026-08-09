import { InstitutionRepository } from "../repositories/InstitutionRepository";
import {
    CreateInstitutionRequest,
    Institution,
    UpdateInstitutionRequest,
} from "../types";

export class InstitutionService {
    private readonly repository = new InstitutionRepository();

    async getAll(): Promise<Institution[]> {
        return await this.repository.getAll();
    }

    async getById(id: string): Promise<Institution | null> {
        return await this.repository.getById(id);
    }

    async create(request: CreateInstitutionRequest): Promise<void> {
        const now = new Date().toISOString();

        const institution: Institution = {
            id: crypto.randomUUID(),
            name: request.name,
            type: request.type,
            createdAt: now,
            updatedAt: now,
        };

        await this.repository.create(institution);
    }

    async update(request: UpdateInstitutionRequest): Promise<void> {
        await this.repository.update(request);
    }

    async delete(id: string): Promise<void> {
        await this.repository.delete(id);
    }
}
