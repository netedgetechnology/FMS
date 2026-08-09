import { CurrencyRepository } from "../repositories/CurrencyRepository";
import {
    CreateCurrencyRequest,
    Currency,
    UpdateCurrencyRequest,
} from "../types";

export class CurrencyService {
    private readonly repository = new CurrencyRepository();

    async getAll(): Promise<Currency[]> {
        return await this.repository.getAll();
    }

    async getById(id: string): Promise<Currency | null> {
        return await this.repository.getById(id);
    }

    async create(request: CreateCurrencyRequest): Promise<void> {
        const now = new Date().toISOString();

        const currency: Currency = {
            id: crypto.randomUUID(),
            code: request.code,
            name: request.name,
            symbol: request.symbol,
            isDefault: request.isDefault ?? false,
            createdAt: now,
            updatedAt: now,
        };

        await this.repository.create(currency);
    }

    async update(request: UpdateCurrencyRequest): Promise<void> {
        await this.repository.update(request);
    }

    async delete(id: string): Promise<void> {
        await this.repository.delete(id);
    }
}
