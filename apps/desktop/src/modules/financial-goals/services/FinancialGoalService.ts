import {
    FinancialGoalRepository,
} from "../repositories";

import type {
    FinancialGoal,
    CreateFinancialGoalRequest,
    UpdateFinancialGoalRequest,
} from "../types";

export class FinancialGoalService {
    private readonly repository =
        new FinancialGoalRepository();

    async getAll(): Promise<FinancialGoal[]> {
        return await this.repository.getAll();
    }

    async getById(
        id: string
    ): Promise<FinancialGoal | null> {
        return await this.repository.getById(id);
    }

    async create(
        request: CreateFinancialGoalRequest
    ): Promise<string> {
        const now = new Date().toISOString();

        const goal: FinancialGoal = {
            id: crypto.randomUUID(),
            name: request.name.trim(),
            goalType: request.goalType.trim(),
            goalCategory: request.goalCategory,
            goalSubcategory: request.goalSubcategory,
            targetAmount: request.targetAmount,
            currentAmount:
                request.currentAmount ?? 0,
            currencyId: request.currencyId,
            targetDate: request.targetDate || null,
            priority: request.priority,
            status: request.status,
            notes: request.notes?.trim() || undefined,
            createdAt: now,
            updatedAt: now,
        };

        await this.repository.create(goal);

        return goal.id;
    }

    async update(
        request: UpdateFinancialGoalRequest
    ): Promise<void> {
        await this.repository.update({
            ...request,
            name: request.name.trim(),
            goalType: request.goalType.trim(),
            goalCategory: request.goalCategory,
            goalSubcategory: request.goalSubcategory,
            targetAmount: request.targetAmount,
            currentAmount: request.currentAmount,
            targetDate: request.targetDate || null,
            notes: request.notes?.trim() || undefined,
        });
    }

    async delete(id: string): Promise<void> {
        await this.repository.delete(id);
    }
}
