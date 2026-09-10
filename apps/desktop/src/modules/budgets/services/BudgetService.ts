import { BusinessEntityRepository } from "@/modules/business-entities/repositories";
import { CategoryRepository } from "@/modules/categories/repositories";
import { CurrencyRepository } from "@/modules/currencies/repositories/CurrencyRepository";

import {
    BudgetRepository,
} from "../repositories";

import type {
    Budget,
    BudgetPeriodType,
    CreateBudgetRequest,
    UpdateBudgetRequest,
} from "../types";

import {
    findConflictingBudget,
    validateBudgetBusinessEntity,
    validateBudgetCategory,
    validateBudgetCurrency,
    validateBudgetFields,
} from "./budgetValidation";

interface BudgetIntegrityInput {
    id: string | null;
    name: string;
    amount: number;
    periodType: BudgetPeriodType;
    startDate: string;
    endDate: string | null;
    currencyId: string;
    categoryId: string | null;
    businessEntityId: string | null;
    isActive: boolean;
    /** The budget's category before this change (null on create). */
    previousCategoryId: string | null;
    /** The budget's currency before this change (null on create). */
    previousCurrencyId: string | null;
    /** The budget's business entity before this change (null on create). */
    previousBusinessEntityId: string | null;
}

export class BudgetService {
    private readonly repository =
        new BudgetRepository();

    private readonly categoryRepository =
        new CategoryRepository();

    private readonly currencyRepository =
        new CurrencyRepository();

    private readonly businessEntityRepository =
        new BusinessEntityRepository();

    async getAll(): Promise<Budget[]> {
        const budgets = await this.repository.getAll();

        return budgets.map((budget) => ({
            ...budget,
            isActive: Boolean(budget.isActive),
        }));
    }

    async getById(
        id: string
    ): Promise<Budget | null> {
        const budget =
            await this.repository.getById(id);

        if (!budget) {
            return null;
        }

        return {
            ...budget,
            isActive: Boolean(budget.isActive),
        };
    }

    async create(
        request: CreateBudgetRequest
    ): Promise<string> {
        const categoryId =
            request.categoryId || null;
        const businessEntityId =
            request.businessEntityId || null;
        const endDate = request.endDate || null;
        const isActive = request.isActive ?? true;

        await this.assertBudgetIntegrity({
            id: null,
            name: request.name,
            amount: request.amount,
            periodType: request.periodType,
            startDate: request.startDate,
            endDate,
            currencyId: request.currencyId,
            categoryId,
            businessEntityId,
            isActive,
            previousCategoryId: null,
            previousCurrencyId: null,
            previousBusinessEntityId: null,
        });

        const now = new Date().toISOString();

        const budget: Budget = {
            id: crypto.randomUUID(),
            name: request.name.trim(),
            categoryId,
            businessEntityId,
            amount: request.amount,
            periodType: request.periodType,
            startDate: request.startDate,
            endDate,
            currencyId: request.currencyId,
            alertThreshold:
                request.alertThreshold ?? 80,
            isActive,
            createdAt: now,
            updatedAt: now,
        };

        await this.repository.create(budget);

        return budget.id;
    }

    async update(
        request: UpdateBudgetRequest
    ): Promise<void> {
        const existing =
            await this.repository.getById(
                request.id
            );

        if (!existing) {
            throw new Error(
                "This budget no longer exists."
            );
        }

        const categoryId =
            request.categoryId || null;
        const businessEntityId =
            request.businessEntityId || null;
        const endDate = request.endDate || null;
        const isActive = request.isActive ?? true;

        await this.assertBudgetIntegrity({
            id: request.id,
            name: request.name,
            amount: request.amount,
            periodType: request.periodType,
            startDate: request.startDate,
            endDate,
            currencyId: request.currencyId,
            categoryId,
            businessEntityId,
            isActive,
            previousCategoryId:
                existing.categoryId ?? null,
            previousCurrencyId:
                existing.currencyId ?? null,
            previousBusinessEntityId:
                existing.businessEntityId ?? null,
        });

        await this.repository.update({
            ...request,
            name: request.name.trim(),
            categoryId,
            businessEntityId,
            endDate,
            alertThreshold:
                request.alertThreshold ?? 80,
            isActive,
        });
    }

    async delete(id: string): Promise<void> {
        await this.repository.delete(id);
    }

    // Field validation, then reference checks (category assignability,
    // currency, business entity), then duplicate detection - in that
    // order. Throws an Error whose message is safe to surface directly
    // in the Add/Edit Budget dialog.
    private async assertBudgetIntegrity(
        input: BudgetIntegrityInput
    ): Promise<void> {
        const fieldError = validateBudgetFields({
            name: input.name,
            amount: input.amount,
            periodType: input.periodType,
            startDate: input.startDate,
            endDate: input.endDate,
            currencyId: input.currencyId,
        });

        if (fieldError) {
            throw new Error(fieldError);
        }

        // Validate the category only when it is being assigned (create)
        // or changed (edit). An unchanged category is preserved even if
        // it has since been deactivated or deleted, so historical
        // budgets keep working.
        const categoryChanged =
            input.categoryId !==
            input.previousCategoryId;

        if (
            input.categoryId !== null &&
            categoryChanged
        ) {
            // CategoryRepository.getById returns null for a
            // soft-deleted category and already coerces isActive.
            const category =
                await this.categoryRepository.getById(
                    input.categoryId
                );

            const check = validateBudgetCategory(
                input.categoryId,
                category
            );

            if (!check.ok) {
                throw new Error(
                    check.reason ??
                        "Invalid budget category."
                );
            }
        }

        // Currency reference. Mandatory, so it is re-checked only when it
        // changes - a historical budget in a since-removed currency still
        // opens for an unrelated edit, the same principle as the category
        // rule above.
        const currencyChanged =
            input.currencyId !==
            input.previousCurrencyId;

        if (currencyChanged) {
            const currency =
                await this.currencyRepository.getById(
                    input.currencyId
                );

            const check =
                validateBudgetCurrency(currency);

            if (!check.ok) {
                throw new Error(
                    check.reason ??
                        "Invalid budget currency."
                );
            }
        }

        // Business-entity reference. Optional - a null entity is always
        // valid and never touches the repository. A supplied entity is
        // checked only when it changes.
        const businessEntityChanged =
            input.businessEntityId !==
            input.previousBusinessEntityId;

        if (
            input.businessEntityId !== null &&
            businessEntityChanged
        ) {
            const entity =
                await this.businessEntityRepository.getById(
                    input.businessEntityId
                );

            const check =
                validateBudgetBusinessEntity(
                    input.businessEntityId,
                    entity
                );

            if (!check.ok) {
                throw new Error(
                    check.reason ??
                        "Invalid business entity."
                );
            }
        }

        // Only ACTIVE budgets take part in duplicate detection - an
        // inactive budget is a parked template, not a live one.
        if (!input.isActive) {
            return;
        }

        const existingBudgets =
            await this.getAll();

        const conflict = findConflictingBudget(
            {
                id: input.id,
                categoryId: input.categoryId,
                currencyId: input.currencyId,
                businessEntityId:
                    input.businessEntityId,
                startDate: input.startDate,
                endDate: input.endDate,
            },
            existingBudgets
        );

        if (conflict) {
            throw new Error(
                input.categoryId === null
                    ? `An active overall budget already exists for an overlapping period ("${conflict.name}").`
                    : `An active budget for this category already exists for an overlapping period ("${conflict.name}").`
            );
        }
    }
}
