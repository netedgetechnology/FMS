import { AccountRepository } from "@/modules/accounts/repositories/AccountRepository";
import { TransactionRepository } from "@/modules/transactions/repositories/TransactionRepository";

import {
    Reconciliation,
    CreateReconciliationRequest,
    CompleteReconciliationRequest,
} from "../types";

import {
    TransferRepository,
} from "@/modules/transfers/repositories";

import { ReconciliationRepository } from "../repositories";

export class ReconciliationService {

    private readonly repository =
        new ReconciliationRepository();

    private readonly accountRepository =
        new AccountRepository();

    private readonly transactionRepository =
        new TransactionRepository();

    
    private readonly transferRepository =
        new TransferRepository();
async getAll(): Promise<Reconciliation[]> {
        return await this.repository.getAll();
    }

    async getById(
        id: string
    ): Promise<Reconciliation | null> {
        return await this.repository.getById(id);
    }

    async getAllByAccountId(
        accountId: string
    ): Promise<Reconciliation[]> {
        return await this.repository.getAllByAccountId(
            accountId
        );
    }

    async getTransactionsForReview(
        accountId: string,
        statementDate?: string
    ) {
        if (!accountId) {
            throw new Error(
                "Account is required for transaction review."
            );
        }

        const account =
            await this.accountRepository.getById(
                accountId
            );

        if (!account) {
            throw new Error(
                "Account not found."
            );
        }

        const transactions =
            await this.transactionRepository.getAll();

        return transactions.filter(
            transaction => {
                if (
                    transaction.accountId !==
                    accountId
                ) {
                    return false;
                }

                if (
                    statementDate &&
                    transaction.transactionDate >
                        statementDate
                ) {
                    return false;
                }

                return true;
            }
        );
    }

    async markTransactionReconciled(
        transactionId: string,
        reconciled: boolean
    ): Promise<void> {
        if (typeof reconciled !== "boolean") {
            throw new Error("Reconciliation status must be a boolean.");
        }
        if (!transactionId) {
            throw new Error(
                "Transaction ID is required."
            );
        }

        const transaction =
            await this.transactionRepository.getById(
                transactionId
            );

        if (!transaction) {
            throw new Error(
                "Transaction not found."
            );
        }

        const now =
            reconciled
                ? new Date().toISOString()
                : null;

        await this.transactionRepository.update({
            ...transaction,
            reconciled,
            reconciledAt: now,
        });
    }

    async calculateAccountBalance(
        accountId: string,
        statementDate?: string
    ): Promise<number> {

        if (!accountId) {
            throw new Error(
                "Account is required for balance calculation."
            );
        }

        const account =
            await this.accountRepository.getById(
                accountId
            );

        if (!account) {
            throw new Error(
                "Account not found."
            );
        }

        const transactions =
            await this.transactionRepository.getAll();

        const accountTransactions =
            transactions.filter(
                transaction => {
                    if (
                        transaction.accountId !==
                        accountId
                    ) {
                        return false;
                    }

                    if (
                        statementDate &&
                        transaction.transactionDate >
                            statementDate
                    ) {
                        return false;
                    }

                    return true;
                }
            );

        const transfers =
            statementDate
                ? await this.transferRepository
                      .getAllByAccountIdUpToDate(
                          accountId,
                          statementDate
                      )
                : await this.transferRepository
                      .getAllByAccountId(
                          accountId
                      );

        let balance =
            account.openingBalance;

        for (const transaction of accountTransactions) {

            if (transaction.type === "income") {
                balance += transaction.amount;
                continue;
            }

            if (transaction.type === "expense") {
                balance -= transaction.amount;
                continue;
            }
        }

        for (const transfer of transfers) {

            if (
                transfer.sourceAccountId ===
                accountId
            ) {
                balance -= transfer.amount;
            }

            if (
                transfer.destinationAccountId ===
                accountId
            ) {
                balance += transfer.amount;
            }
        }

        return balance;
    }

    calculateDifference(
        statementBalance: number,
        systemBalance: number
    ): number {

        if (!Number.isFinite(statementBalance)) {
            throw new Error(
                "Statement balance must be a valid number."
            );
        }

        if (!Number.isFinite(systemBalance)) {
            throw new Error(
                "System balance must be a valid number."
            );
        }

        return statementBalance - systemBalance;
    }

    async create(
        request: CreateReconciliationRequest
    ): Promise<string> {

        if (!request.accountId) {
            throw new Error(
                "Account is required for reconciliation."
            );
        }

        if (!request.statementDate) {
            throw new Error(
                "Statement date is required."
            );
        }

        if (!Number.isFinite(request.statementBalance)) {
            throw new Error(
                "Statement balance must be a valid number."
            );
        }

        const systemBalance =
            await this.calculateAccountBalance(
                request.accountId,
                request.statementDate
            );

        const difference =
            this.calculateDifference(
                request.statementBalance,
                systemBalance
            );

        const id =
            crypto.randomUUID();

        await this.repository.create({
            id,
            accountId:
                request.accountId,
            statementDate:
                request.statementDate,
            statementBalance:
                request.statementBalance,
            notes:
                request.notes?.trim() || null,
            systemBalance,
            difference,
        });

        return id;
    }

    async getUnreconciledTransactionsForReview(
        accountId: string,
        statementDate: string
    ) {
        if (!accountId) {
            throw new Error(
                "Account is required for transaction review."
            );
        }

        if (!statementDate) {
            throw new Error(
                "Statement date is required for transaction review."
            );
        }

        const account =
            await this.accountRepository.getById(
                accountId
            );

        if (!account) {
            throw new Error(
                "Account not found."
            );
        }

        const transactions =
            await this.transactionRepository.getAll();

        return transactions.filter(
            transaction =>
                transaction.accountId ===
                    accountId &&
                transaction.transactionDate <=
                    statementDate &&
                !transaction.reconciled
        );
    }

    async complete(
        request: CompleteReconciliationRequest
    ): Promise<void> {

        if (!request.id) {
            throw new Error(
                "Reconciliation ID is required."
            );
        }

        const reconciliation =
            await this.repository.getById(
                request.id
            );

        if (!reconciliation) {
            throw new Error(
                "Reconciliation not found."
            );
        }

        if (
            reconciliation.status ===
            "COMPLETED"
        ) {
            throw new Error(
                "Reconciliation is already completed."
            );
        }


        await this.repository.complete({
            id:
                request.id,
            reconciledAt:
                request.reconciledAt ??
                new Date().toISOString(),
            notes:
                request.notes?.trim() || null,
        });
    }
}

