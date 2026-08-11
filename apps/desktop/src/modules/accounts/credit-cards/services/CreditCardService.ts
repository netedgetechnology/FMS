import { CreditCardRepository } from "../repositories/CreditCardRepository";
import {
    CreditCard,
    CreateCreditCardRequest,
    UpdateCreditCardRequest,
} from "../types";

export class CreditCardService {
    private readonly repository = new CreditCardRepository();

    async getByAccountId(accountId: string): Promise<CreditCard | null> {
        return await this.repository.getByAccountId(accountId);
    }

    async create(request: CreateCreditCardRequest): Promise<void> {
        await this.repository.create(request);
    }

    async update(request: UpdateCreditCardRequest): Promise<void> {
        await this.repository.update(request);
    }

    async deleteByAccountId(accountId: string): Promise<void> {
        await this.repository.deleteByAccountId(accountId);
    }
}
