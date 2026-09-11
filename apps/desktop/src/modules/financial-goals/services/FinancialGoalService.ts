import {
    FinancialGoalRepository,
    GoalAccountLinkRepository,
    GoalCategoryLinkRepository,
    GoalLoanLinkRepository,
    GoalInvestmentLinkRepository,
} from "../repositories";

import { isLinkedGoalMode } from "../constants/goalAccountLinking";

import type {
    FinancialGoal,
    CreateFinancialGoalRequest,
    UpdateFinancialGoalRequest,
} from "../types";

export class FinancialGoalService {
    private readonly repository =
        new FinancialGoalRepository();

    private readonly accountLinkRepository =
        new GoalAccountLinkRepository();

    private readonly categoryLinkRepository =
        new GoalCategoryLinkRepository();

    private readonly loanLinkRepository =
        new GoalLoanLinkRepository();

    private readonly investmentLinkRepository =
        new GoalInvestmentLinkRepository();

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
        const goalMode = request.goalMode ?? "MANUAL";
        const isCategoryMode =
            goalMode === "CATEGORY_CONTRIBUTION_LINKED";
        const isLoanMode =
            goalMode === "LOAN_PAYOFF_LINKED";
        const isInvestmentMode =
            goalMode === "INVESTMENT_LINKED";

        if (
            isCategoryMode &&
            (request.categoryIds?.length ?? 0) === 0
        ) {
            throw new Error(
                "A category-linked goal needs at least one linked category."
            );
        }

        if (
            isLoanMode &&
            (request.loanIds?.length ?? 0) === 0
        ) {
            throw new Error(
                "A loan-linked goal needs at least one linked loan."
            );
        }

        if (
            isInvestmentMode &&
            (request.investmentIds?.length ?? 0) === 0
        ) {
            throw new Error(
                "An investment-linked goal needs at least one linked investment."
            );
        }

        if (
            isLinkedGoalMode(goalMode) &&
            !isCategoryMode &&
            !isLoanMode &&
            !isInvestmentMode &&
            (request.accountIds?.length ?? 0) === 0
        ) {
            throw new Error(
                "An account-linked goal needs at least one linked account."
            );
        }

        const goal: FinancialGoal = {
            id: crypto.randomUUID(),
            name: request.name.trim(),
            goalType: request.goalType.trim(),
            goalCategory: request.goalCategory,
            goalSubcategory: request.goalSubcategory,
            goalMode,
            targetAmount: request.targetAmount,
            // Linked goals never read current_amount back as
            // authoritative (see services/goalActuals.ts) - stored as
            // 0 purely to keep the column non-null.
            currentAmount: isLinkedGoalMode(goalMode)
                ? 0
                : (request.currentAmount ?? 0),
            currencyId: request.currencyId,
            targetDate: request.targetDate || null,
            priority: request.priority,
            status: request.status,
            notes: request.notes?.trim() || undefined,
            createdAt: now,
            updatedAt: now,
        };

        await this.repository.create(goal);

        if (isCategoryMode && request.categoryIds) {
            for (const categoryId of new Set(
                request.categoryIds
            )) {
                await this.categoryLinkRepository.create(
                    {
                        id: crypto.randomUUID(),
                        goalId: goal.id,
                        categoryId,
                    }
                );
            }
        } else if (isLoanMode && request.loanIds) {
            for (const loanId of new Set(
                request.loanIds
            )) {
                await this.loanLinkRepository.create({
                    id: crypto.randomUUID(),
                    goalId: goal.id,
                    loanId,
                });
            }
        } else if (
            isInvestmentMode &&
            request.investmentIds
        ) {
            for (const investmentId of new Set(
                request.investmentIds
            )) {
                await this.investmentLinkRepository.create(
                    {
                        id: crypto.randomUUID(),
                        goalId: goal.id,
                        investmentId,
                    }
                );
            }
        } else if (
            isLinkedGoalMode(goalMode) &&
            request.accountIds
        ) {
            for (const accountId of new Set(
                request.accountIds
            )) {
                await this.accountLinkRepository.create(
                    {
                        id: crypto.randomUUID(),
                        goalId: goal.id,
                        accountId,
                    }
                );
            }
        }

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
        await this.accountLinkRepository.softDeleteByGoal(
            id
        );
        await this.categoryLinkRepository.softDeleteByGoal(
            id
        );
        await this.loanLinkRepository.softDeleteByGoal(
            id
        );
        await this.investmentLinkRepository.softDeleteByGoal(
            id
        );
        await this.repository.delete(id);
    }
}
