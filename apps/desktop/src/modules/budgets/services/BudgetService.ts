import {
    BudgetRepository,
} from "../repositories";

import type {
    Budget,
    CreateBudgetRequest,
    UpdateBudgetRequest,
} from "../types";

export class BudgetService {
    private readonly repository =
        new BudgetRepository();

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
        const now = new Date().toISOString();

        const budget: Budget = {
            id: crypto.randomUUID(),
            name: request.name.trim(),
            categoryId: request.categoryId || null,
            businessEntityId:
                request.businessEntityId || null,
            amount: request.amount,
            periodType: request.periodType,
            startDate: request.startDate,
            endDate: request.endDate || null,
            currencyId: request.currencyId,
            alertThreshold:
                request.alertThreshold ?? 80,
            isActive:
                request.isActive ?? true,
            createdAt: now,
            updatedAt: now,
        };

        await this.repository.create(budget);

        return budget.id;
    }

    async update(
        request: UpdateBudgetRequest
    ): Promise<void> {
        await this.repository.update({
            ...request,
            name: request.name.trim(),
            categoryId:
                request.categoryId || null,
            businessEntityId:
                request.businessEntityId || null,
            endDate:
                request.endDate || null,
            alertThreshold:
                request.alertThreshold ?? 80,
            isActive:
                request.isActive ?? true,
        });
    }

    async delete(id: string): Promise<void> {
        await this.repository.delete(id);
    }
}
