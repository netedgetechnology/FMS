import {
    FinancialPlanRepository,
} from "../repositories";

import type {
    FinancialPlan,
    CreateFinancialPlanRequest,
    UpdateFinancialPlanRequest,
} from "../types";

export class FinancialPlanService {
    private readonly repository =
        new FinancialPlanRepository();

    async getAll(): Promise<FinancialPlan[]> {
        return await this.repository.getAll();
    }

    async getById(
        id: string
    ): Promise<FinancialPlan | null> {
        return await this.repository.getById(id);
    }

    async create(
        request: CreateFinancialPlanRequest
    ): Promise<string> {
        const now = new Date().toISOString();

        const plan: FinancialPlan = {
            id: crypto.randomUUID(),
            name: request.name.trim(),
            planType: request.planType.trim(),
            planCategory: request.planCategory,
            planSubcategory: request.planSubcategory,
            startDate: request.startDate,
            endDate: request.endDate || null,
            currencyId: request.currencyId,
            targetAmount:
                request.targetAmount ?? null,
            notes: request.notes?.trim() || undefined,
            status: request.status,
            createdAt: now,
            updatedAt: now,
        };

        await this.repository.create(plan);

        return plan.id;
    }

    async update(
        request: UpdateFinancialPlanRequest
    ): Promise<void> {
        await this.repository.update({
            ...request,
            name: request.name.trim(),
            planType: request.planType.trim(),
            planCategory: request.planCategory,
            planSubcategory: request.planSubcategory,
            endDate: request.endDate || null,
            targetAmount:
                request.targetAmount ?? null,
            notes: request.notes?.trim() || undefined,
        });
    }

    async delete(id: string): Promise<void> {
        await this.repository.delete(id);
    }
}
