import { AccountRepository } from "../repositories/AccountRepository";
import { InstitutionRepository } from "@/modules/institutions/repositories/InstitutionRepository";
import {
    Account,
    CreateAccountRequest,
    UpdateAccountRequest,
} from "../types";

export class AccountService {
    private readonly repository = new AccountRepository();
    private readonly institutionRepository = new InstitutionRepository();

    private async resolveInstitutionId(
        institutionName?: string | null
    ): Promise<string | null> {
        const name = institutionName?.trim();

        if (!name) {
            return null;
        }

        const existing = await this.institutionRepository.getByName(name);

        if (existing) {
            return existing.id;
        }

        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        await this.institutionRepository.create({
            id,
            name,
            type: "Financial Institution",
            createdAt: now,
            updatedAt: now,
        });

        return id;
    }

    async getAll(): Promise<Account[]> {
        return await this.repository.getAll();
    }

    async getById(id: string): Promise<Account | null> {
        return await this.repository.getById(id);
    }

    async create(
        request: CreateAccountRequest & {
            institutionName?: string | null;
        }
    ): Promise<void> {
        const now = new Date().toISOString();

        const institutionId = await this.resolveInstitutionId(
            request.institutionName
        );

        const account: Account = {
            id: crypto.randomUUID(),
            name: request.name,
            type: request.type,
            institutionId,
            currencyId: request.currencyId,
            openingBalance: request.openingBalance,
            accountNumber: request.accountNumber,
            branchName: request.branchName,
            ifscCode: request.ifscCode,
            swiftCode: request.swiftCode,
            iban: request.iban,
            description: request.description,
            isActive: request.isActive ?? true,
            createdAt: now,
            updatedAt: now,
        };

        await this.repository.create(account);
    }

    async update(
        request: UpdateAccountRequest & {
            institutionName?: string | null;
        }
    ): Promise<void> {
        const institutionId = await this.resolveInstitutionId(
            request.institutionName
        );

        await this.repository.update({
            ...request,
            institutionId,
        });
    }

    async delete(id: string): Promise<void> {
        await this.repository.delete(id);
    }
}


