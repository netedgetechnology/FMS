import {
    Transaction,
    TransactionType,
    TransferDirection,
    CreateTransactionRequest,
    UpdateTransactionRequest,
} from "../types";

import {
    TransactionRepository,
} from "../repositories";

import { LoanSchedulePaymentRepository } from "@/modules/loans/repositories/LoanSchedulePaymentRepository";
import { AccountRepository } from "@/modules/accounts/repositories/AccountRepository";

import {
    CategoryContextMappingRepository,
    CategoryRepository,
} from "@/modules/categories/repositories";

import {
    isLockedResolution,
    resolveCategoryTransactionType,
} from "@/modules/categories/utils";

import { incompatibleTransactionIds } from "./bulkCategoryChange";
import { bulkMoveBlockReason } from "./bulkAccountMove";

import {
    applyTransferCategoryRule,
    balanceSide,
    transferDirectionForType,
} from "@/core/accounting/transferClassification";
import { CounterpartyRuleRepository } from "@/modules/imports/repositories/CounterpartyRuleRepository";
import {
    learnRuleFromCorrection,
    learningKeyForCandidate,
} from "@/modules/imports/services/learningKey";

function createId(): string {
    return crypto.randomUUID();
}

export class TransactionService {
    private readonly repository =
        new TransactionRepository();

    // Loans Phase 6 - a transaction that records an EMI payment must
    // be reversed through the loan's own EMI schedule (which also
    // restores the loan's outstanding balances and schedule status),
    // never deleted directly here and left to silently desync those.
    // LoanPaymentService.reversePayment() bypasses this by using
    // TransactionRepository directly, not this service, since it is
    // the one authorized path that both deletes the transaction AND
    // performs the matching loan-side correction.
    private readonly loanSchedulePaymentRepository =
        new LoanSchedulePaymentRepository();

    private readonly accountRepository =
        new AccountRepository();

    private readonly categoryRepository =
        new CategoryRepository();

    private readonly categoryContextMappingRepository =
        new CategoryContextMappingRepository();

    // The Import self-learning store - see learnFromEdit.
    private readonly counterpartyRuleRepository =
        new CounterpartyRuleRepository();

    // Redesigned category Income/Expense behavior - a category can be
    // mapped to a specific transaction type for a specific account or
    // business entity (see resolveCategoryTransactionType). Only those
    // explicit mappings are enforced here as a hard rule; a category's
    // own default categoryType stays a soft suggestion in the form and
    // is never rejected here, since it has never been validated before
    // and many existing categories are already used across both income
    // and expense transactions.
    private async assertCompatibleType(
        categoryId: string | null,
        accountId: string,
        type: TransactionType
    ): Promise<void> {
        if (!categoryId) {
            return;
        }

        const [account, categories, mappings] =
            await Promise.all([
                this.accountRepository.getById(accountId),
                this.categoryRepository.getAll(),
                this.categoryContextMappingRepository.getByCategoryId(
                    categoryId
                ),
            ]);

        const resolution = resolveCategoryTransactionType({
            categoryId,
            accountId,
            businessEntityId: account?.businessEntityId ?? null,
            mappings,
            categories,
        });

        if (
            !isLockedResolution(resolution) ||
            !resolution.categoryType
        ) {
            return;
        }

        const requiredType =
            resolution.categoryType.toLowerCase();

        if (requiredType !== type) {
            const requiredLabel =
                resolution.categoryType === "INCOME"
                    ? "Income"
                    : "Expense";

            const contextLabel =
                resolution.source === "account"
                    ? "account"
                    : "business entity";

            throw new Error(
                `This category is mapped to ${requiredLabel} for the selected ${contextLabel}. Change the transaction type or choose a different category.`
            );
        }
    }

    // The one place a saved transaction's type is reconciled with its
    // category (see applyTransferCategoryRule): a TRANSFER category makes
    // it a transfer, keeping its money direction - from `direction` when
    // given, else its Debit/Credit side (expense -> OUT, income -> IN).
    // Any other category leaves the type exactly as requested.
    private async resolveTransferTyping(
        categoryId: string | null,
        type: TransactionType,
        direction: TransferDirection | null
    ): Promise<{ type: TransactionType; transferDirection: TransferDirection | null }> {
        const category = categoryId
            ? await this.categoryRepository.getById(categoryId)
            : null;

        const resolved = applyTransferCategoryRule(
            { type, transferDirection: direction },
            category?.categoryType === "TRANSFER"
        );

        return {
            type: resolved.type as TransactionType,
            transferDirection: resolved.transferDirection,
        };
    }

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

    // Used by the manual Add Transaction flow (AddTransactionDialog) -
    // see TransactionRepository.findManualDuplicate for why this is a
    // separate check from findDuplicate() above, which import
    // de-duplication relies on unchanged.
    async findManualDuplicate(
        accountId: string,
        categoryId: string | null,
        transactionDate: string,
        type: TransactionType,
        amount: number,
        payee: string
    ): Promise<Transaction | null> {
        return await this.repository.findManualDuplicate(
            accountId,
            categoryId,
            transactionDate,
            type,
            amount,
            payee
        );
    }

    async create(
        request: CreateTransactionRequest
    ): Promise<string> {
        const typing = await this.resolveTransferTyping(
            request.categoryId?.trim() || null,
            request.type,
            request.transferDirection ?? null
        );

        await this.assertCompatibleType(
            request.categoryId ?? null,
            request.accountId,
            typing.type
        );

        const now =
            new Date().toISOString();

        const transaction: Transaction = {
            id: createId(),

            accountId:
                request.accountId,

            // "None" in the Category select submits "" (see
            // TransactionForm), not null/undefined - trim/|| here
            // normalizes that to null so category-less transactions are
            // stored the same way the DB column, findManualDuplicate,
            // and budget spending's `categoryId === null` "Uncategorized"
            // check all expect. A bare `?? null` left "" stored as-is,
            // silently dropping these transactions out of both their
            // category's spending total and the Uncategorized total.
            categoryId:
                request.categoryId?.trim() || null,

            subcategoryId:
                request.subcategoryId ?? null,

            payee:
                request.payee?.trim() || "",

            counterparty:
                request.counterparty?.trim() || null,

            branch:
                request.branch?.trim() || null,

            type:
                typing.type,

            transferDirection:
                typing.transferDirection,

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

            transactionType:
                request.transactionType ?? null,

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
        const existing =
            await this.repository.getById(request.id);

        if (!existing) {
            throw new Error(
                "Transaction not found."
            );
        }

        const typing = await this.resolveTransferTyping(
            (request.categoryId !== undefined
                ? request.categoryId?.trim()
                : existing.categoryId) || null,
            request.type ?? existing.type,
            request.transferDirection !== undefined
                ? request.transferDirection
                : existing.transferDirection ?? null
        );

        // Becoming a transfer with no direction supplied: it is the
        // Debit/Credit this transaction had (Expense -> OUT, Income -> IN).
        if (
            typing.type === "transfer" &&
            !typing.transferDirection
        ) {
            typing.transferDirection =
                transferDirectionForType(existing.type);
        }

        await this.assertCompatibleType(
            request.categoryId !== undefined
                ? request.categoryId
                : existing.categoryId,
            request.accountId ?? existing.accountId,
            typing.type
        );

        await this.repository.update({
            ...request,

            type:
                typing.type,

            transferDirection:
                typing.transferDirection,

            // See the matching comment in create() - normalizes the "None"
            // category's "" submission to null.
            categoryId:
                request.categoryId?.trim() || null,

            subcategoryId:
                request.subcategoryId ?? null,

            payee:
                request.payee?.trim() || "",

            counterparty:
                request.counterparty?.trim() || null,

            branch:
                request.branch?.trim() || null,

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

        await this.learnFromEdit(existing, {
            accountId: request.accountId ?? existing.accountId,
            payee: request.payee?.trim() || "",
            notes: request.notes?.trim() || null,
            categoryId: request.categoryId?.trim() || null,
            originalNarration:
                request.originalNarration?.trim() || null,
            transactionType: request.transactionType ?? null,
            type: typing.type,
            transferDirection: typing.transferDirection,
        });
    }

    // Import self-learning from a Transactions-page edit: when the user
    // changes a transaction's Payee, Category or Notes, the same
    // account-scoped rule an Import Preview correction would teach is
    // updated, so the next import of that narration gets the corrected
    // values. Uses the import's own key (normalized narration + Debit/
    // Credit direction - see learningKeyForCandidate; a transfer counts
    // by its direction) and store (counterparty_rules). Only runs when one
    // of those three fields actually changed, and only for a transaction
    // with a source narration, and only for a genuine correction - never
    // a rule holding only the raw narration, never a narration Payee over
    // a learned one (see learnRuleFromCorrection). Best-effort: a
    // learning failure never fails the save. Bulk Change Category never
    // comes through here, so it never teaches rules.
    private async learnFromEdit(
        existing: Transaction,
        saved: {
            accountId: string;
            payee: string;
            notes: string | null;
            categoryId: string | null;
            originalNarration: string | null;
            transactionType: Transaction["transactionType"];
            type: TransactionType;
            transferDirection: TransferDirection | null;
        }
    ): Promise<void> {
        const changed =
            saved.payee !== (existing.payee ?? "") ||
            saved.notes !== (existing.notes ?? null) ||
            saved.categoryId !== (existing.categoryId ?? null);

        if (!changed || !saved.payee || !saved.originalNarration) {
            return;
        }

        const side = balanceSide(saved);

        if (!side) {
            return;
        }

        const pattern = learningKeyForCandidate({
            description: saved.originalNarration,
            type: side,
        });

        if (!pattern) {
            return;
        }

        try {
            // Only a genuine correction against the transaction's
            // pre-edit values teaches the rule, and a narration Payee
            // never overwrites a learned one (see learnRuleFromCorrection).
            await learnRuleFromCorrection(
                this.counterpartyRuleRepository,
                saved.accountId,
                pattern,
                {
                    description: saved.originalNarration,
                    payee: saved.payee,
                    transactionType: saved.transactionType ?? null,
                    notes: saved.notes,
                    categoryId: saved.categoryId,
                },
                {
                    payee: existing.payee,
                    transactionType: existing.transactionType ?? null,
                    notes: existing.notes ?? null,
                    categoryId: existing.categoryId ?? null,
                }
            );
        } catch (error) {
            console.error(
                "Failed to learn from transaction edit:",
                error
            );
        }
    }

    async delete(
        id: string
    ): Promise<void> {
        const linkedLoanPayment =
            await this.loanSchedulePaymentRepository.getByTransactionId(
                id
            );

        if (linkedLoanPayment) {
            throw new Error(
                "This transaction records a loan EMI payment and can't be deleted here. Open the loan's EMI schedule and reverse the payment instead."
            );
        }

        await this.repository.delete(id);
    }

    /**
     * Which of the given transaction ids currently record a loan EMI
     * payment - used by BulkDeleteTransactionsDialog to pre-validate a
     * whole batch before deleting anything (safer bulk delete), so a
     * batch containing an EMI-linked transaction is refused in full
     * rather than partially processed up to the first one delete()
     * itself would refuse. Reuses the same
     * loanSchedulePaymentRepository lookup delete() already relies on
     * - no loan-payment logic is duplicated here.
     */
    /**
     * Bulk "Change Category": sets `categoryId` on every given live
     * transaction in one atomic update - all or nothing. Nothing else
     * about a transaction changes (type/direction, amount, account,
     * dates, payee, sub-category, reconciliation state), and learned
     * import rules are not touched. Every transaction is checked against
     * the same account/business-entity mapping rule as a single edit
     * (assertCompatibleType) BEFORE anything is written; if any one
     * fails, nothing is changed.
     */
    async changeCategory(
        transactionIds: readonly string[],
        categoryId: string
    ): Promise<{ updated: number }> {
        const ids = [...new Set(transactionIds)];

        if (ids.length === 0) {
            return { updated: 0 };
        }

        const category =
            await this.categoryRepository.getById(categoryId);

        if (!category) {
            throw new Error("Category not found.");
        }

        if (!category.isActive) {
            throw new Error(
                `"${category.name}" is inactive and can't be assigned.`
            );
        }

        const [transactions, accounts, mappings] =
            await Promise.all([
                this.repository.getByIds(ids),
                this.accountRepository.getAll(),
                this.categoryContextMappingRepository.getByCategoryId(
                    categoryId
                ),
            ]);

        if (transactions.length === 0) {
            throw new Error(
                "None of the selected transactions exist any more."
            );
        }

        // A TRANSFER category also makes every row a transfer (below) -
        // checked with that final type, exactly as a single edit is.
        const makeTransfer = category.categoryType === "TRANSFER";

        const incompatible = incompatibleTransactionIds(
            category,
            makeTransfer
                ? transactions.map(transaction => ({
                      ...transaction,
                      type: "transfer" as const,
                  }))
                : transactions,
            mappings,
            new Map(
                accounts.map(account => [
                    account.id,
                    account.businessEntityId ?? null,
                ])
            )
        );

        if (incompatible.length > 0) {
            throw new Error(
                `${incompatible.length} of the selected transactions can't use "${category.name}": it's mapped to a different transaction type for their account or business entity.`
            );
        }

        await this.repository.updateCategoryForIds(
            transactions.map(transaction => transaction.id),
            categoryId,
            makeTransfer
        );

        return { updated: transactions.length };
    }

    /**
     * Bulk "Move to Account": reassigns the given live transactions to
     * `accountId` in one atomic update - all or nothing. Only the account
     * changes (see bulkAccountMove.ts): no transaction is created,
     * deleted or re-typed, no transfer is recorded, no opening balance or
     * learned rule is touched. Every rule (active ledger destination,
     * ledger sources, same currency) is checked BEFORE anything is
     * written; rows already in the destination are left as they are.
     */
    async moveToAccount(
        transactionIds: readonly string[],
        accountId: string
    ): Promise<{ moved: number }> {
        const ids = [...new Set(transactionIds)];

        if (ids.length === 0) {
            return { moved: 0 };
        }

        const [transactions, accounts] = await Promise.all([
            this.repository.getByIds(ids),
            this.accountRepository.getAll(),
        ]);

        const destination =
            accounts.find(account => account.id === accountId) ?? null;

        if (!destination) {
            throw new Error("Destination account not found.");
        }

        if (transactions.length === 0) {
            throw new Error(
                "None of the selected transactions exist any more."
            );
        }

        const blockReason = bulkMoveBlockReason(
            transactions,
            destination,
            new Map(accounts.map(account => [account.id, account]))
        );

        if (blockReason) {
            throw new Error(blockReason);
        }

        const toMove = transactions.filter(
            transaction => transaction.accountId !== accountId
        );

        await this.repository.moveToAccountForIds(
            toMove.map(transaction => transaction.id),
            accountId
        );

        return { moved: toMove.length };
    }

    async findEmiLinkedTransactionIds(
        transactionIds: readonly string[]
    ): Promise<string[]> {
        const payments =
            await this.loanSchedulePaymentRepository.getByTransactionIds(
                transactionIds
            );

        return payments.map(
            payment => payment.transactionId
        );
    }
}
