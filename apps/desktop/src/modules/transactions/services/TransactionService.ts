import {
    Transaction,
    CreateTransactionRequest,
    UpdateTransactionRequest,
} from "../types";

import {
    TransactionRepository,
} from "../repositories";

function createId(): string {
    return crypto.randomUUID();
}

export class TransactionService {
    private readonly repository =
        new TransactionRepository();

    async getAll(): Promise<Transaction[]> {
        return await this.repository.getAll();
    }

    async getById(
        id: string
    ): Promise<Transaction | null> {
        return await this.repository.getById(id);
    }

    async create(
        request: CreateTransactionRequest
    ): Promise<void> {
        const now =
            new Date().toISOString();

        const transaction: Transaction = {
            id: createId(),
            accountId: request.accountId,
            categoryId:
                request.categoryId ?? null,
            payee:
                request.payee?.trim() || "",
            type: request.type,
            amount: request.amount,
            transactionDate:
                request.transactionDate,
            referenceNumber:
                request.referenceNumber?.trim() || null,
            notes:
                request.notes?.trim() || null,
            createdAt: now,
            updatedAt: now,
        };

        await this.repository.create(
            transaction
        );
    }

    async update(
        request: UpdateTransactionRequest
    ): Promise<void> {
        await this.repository.update({
            ...request,
            payee:
                request.payee?.trim() || "",
            categoryId:
                request.categoryId ?? null,
            referenceNumber:
                request.referenceNumber?.trim() || undefined,
            notes:
                request.notes?.trim() || undefined,
        });
    }

    async delete(
        id: string
    ): Promise<void> {
        await this.repository.delete(id);
    }
}



