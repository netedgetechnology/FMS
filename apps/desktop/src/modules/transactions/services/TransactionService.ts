import {
    Transaction,
    TransactionType,
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

    async findDuplicate(
        accountId: string,
        transactionDate: string,
        type: TransactionType,
        amount: number,
        referenceNumber: string | null,
        payee: string,
        description: string
    ): Promise<Transaction | null> {
        return await this.repository.findDuplicate(
            accountId,
            transactionDate,
            type,
            amount,
            referenceNumber,
            payee,
            description
        );
    }

    async create(
        request: CreateTransactionRequest
    ): Promise<string> {
        const now =
            new Date().toISOString();

        const transaction: Transaction = {
            id: createId(),

            accountId:
                request.accountId,

            categoryId:
                request.categoryId ?? null,

            subcategoryId:
                request.subcategoryId ?? null,

            payee:
                request.payee?.trim() || "",

            type:
                request.type,

            amount:
                request.amount,

            transactionDate:
                request.transactionDate,

            referenceNumber:
                request.referenceNumber?.trim() || null,

            notes:
                request.notes?.trim() || null,

            tags:
                request.tags?.trim() || null,

            status:
                request.status ?? "CLEARED",

            paymentMethod:
                request.paymentMethod ?? null,

            upiReference:
                request.upiReference?.trim() || null,

            bankTransactionReference:
                request.bankTransactionReference?.trim() || null,

            cardReference:
                request.cardReference?.trim() || null,

            reconciled:
                request.reconciled ?? false,

            reconciledAt:
                request.reconciledAt ?? null,

            isImported:
                request.isImported ?? false,

            sourceStatement:
                request.sourceStatement?.trim() || null,

            externalTransactionId:
                request.externalTransactionId?.trim() || null,

            originalNarration:
                request.originalNarration?.trim() || null,

            createdAt:
                now,

            updatedAt:
                now,
        };

        await this.repository.create(
            transaction
        );

        return transaction.id;
    }

    async update(
        request: UpdateTransactionRequest
    ): Promise<void> {
        await this.repository.update({
            ...request,

            categoryId:
                request.categoryId ?? null,

            subcategoryId:
                request.subcategoryId ?? null,

            payee:
                request.payee?.trim() || "",

            referenceNumber:
                request.referenceNumber?.trim() || null,

            notes:
                request.notes?.trim() || null,

            tags:
                request.tags?.trim() || null,

            status:
                request.status ?? "CLEARED",

            paymentMethod:
                request.paymentMethod ?? null,

            upiReference:
                request.upiReference?.trim() || null,

            bankTransactionReference:
                request.bankTransactionReference?.trim() || null,

            cardReference:
                request.cardReference?.trim() || null,

            reconciled:
                request.reconciled ?? false,

            reconciledAt:
                request.reconciledAt ?? null,

            isImported:
                request.isImported ?? false,

            sourceStatement:
                request.sourceStatement?.trim() || null,

            externalTransactionId:
                request.externalTransactionId?.trim() || null,

            originalNarration:
                request.originalNarration?.trim() || null,
        });
    }

    async delete(
        id: string
    ): Promise<void> {
        await this.repository.delete(id);
    }
}
