import { CurrencyRepository } from "@/modules/currencies/repositories/CurrencyRepository";
import { FinancialGoalRepository } from "@/modules/financial-goals/repositories";

import {
    FinancialPlanComponentRepository,
    FinancialPlanRepository,
} from "../repositories";

import type {
    CreateFinancialPlanRequest,
    FinancialPlan,
    FinancialPlanStatus,
    UpdateFinancialPlanRequest,
} from "../types";

import {
    getPlanComponentComboLabel,
    getPlanTypeLabel,
} from "../constants";

import {
    validateFinancialPlanCurrency,
    validateFinancialPlanFields,
    validateFinancialPlanGoal,
} from "./financialPlanValidation";
import { findComponentsIncompatibleWithPlanType } from "./financialPlanComponentValidation";

/** The plan fields as stored - trimmed, with optional fields resolved to null. */
interface NormalizedPlan {
    name: string;
    planType: FinancialPlan["planType"];
    planCategory: string;
    planSubcategory: string;
    periodType: FinancialPlan["periodType"];
    startDate: string;
    endDate: string | null;
    currencyId: string;
    targetAmount: number | null;
    goalId: string | null;
    notes: string | null;
    status: FinancialPlan["status"];
}

export class FinancialPlanService {
    private readonly repository =
        new FinancialPlanRepository();

    private readonly currencyRepository =
        new CurrencyRepository();

    private readonly goalRepository =
        new FinancialGoalRepository();

    private readonly componentRepository =
        new FinancialPlanComponentRepository();

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
        const normalized = this.normalize(request);

        await this.assertFinancialPlanIntegrity(
            normalized
        );

        const now = new Date().toISOString();

        const plan: FinancialPlan = {
            id: crypto.randomUUID(),
            ...normalized,
            createdAt: now,
            updatedAt: now,
        };

        await this.repository.create(plan);

        return plan.id;
    }

    async update(
        request: UpdateFinancialPlanRequest
    ): Promise<void> {
        const existing =
            await this.repository.getById(request.id);

        if (!existing) {
            throw new Error(
                "This financial plan no longer exists."
            );
        }

        const normalized = this.normalize(request);

        await this.assertFinancialPlanIntegrity(
            normalized
        );

        await this.assertPlanTypeChangeIsSafe(
            existing.planType,
            normalized.planType,
            request.id
        );

        await this.repository.update({
            id: request.id,
            ...normalized,
        });
    }

    // Phase 6/7: the archive / restore primitive. It is deliberately
    // limited to exactly two lifecycle moves:
    //   Active | Completed  ->  Archived   (archive)
    //   Archived            ->  Active     (restore)
    // Marking a plan Active <-> Completed is a manual edit and goes
    // through update() / the Edit dialog, not here. Only the status
    // field moves; taxonomy / dates / target / currency / goal are left
    // exactly as stored, so a plan whose taxonomy has since become stale
    // can still be archived or restored. Components are untouched
    // (archiving never cascades - only delete() does).
    async setStatus(
        id: string,
        status: FinancialPlanStatus
    ): Promise<void> {
        if (
            status !== "ARCHIVED" &&
            status !== "ACTIVE"
        ) {
            throw new Error(
                "This action can only archive or restore a plan."
            );
        }

        const existing =
            await this.repository.getById(id);

        if (!existing) {
            throw new Error(
                "This financial plan no longer exists."
            );
        }

        if (
            status === "ARCHIVED" &&
            existing.status === "ARCHIVED"
        ) {
            throw new Error(
                "This plan is already archived."
            );
        }

        if (
            status === "ACTIVE" &&
            existing.status !== "ARCHIVED"
        ) {
            throw new Error(
                "Only an archived plan can be restored. Use the Edit dialog to change a plan between Active and Completed."
            );
        }

        await this.repository.update({
            id,
            name: existing.name,
            planType: existing.planType,
            planCategory: existing.planCategory,
            planSubcategory: existing.planSubcategory,
            periodType: existing.periodType,
            startDate: existing.startDate,
            endDate: existing.endDate,
            currencyId: existing.currencyId,
            targetAmount: existing.targetAmount,
            goalId: existing.goalId,
            notes: existing.notes,
            status,
        });
    }

    // Soft-deleting a plan cascades to its components (Phase 2). Setting
    // status = ARCHIVED does NOT - that goes through update() / setStatus()
    // and leaves components untouched.
    async delete(id: string): Promise<void> {
        await this.repository.delete(id);
        await this.componentRepository.softDeleteByPlan(
            id
        );
    }

    // Phase 4: a plan_type change must not leave a component that is
    // invalid for the new type (its (type, role) combo out of the
    // matrix, or a target the new type forbids). Every non-deleted
    // component - active or inactive - is checked; soft-deleted
    // components are excluded by the repository. Only runs when the type
    // actually changes; a plan with no components is never blocked. The
    // thrown message is safe to show directly in the Edit Plan dialog.
    private async assertPlanTypeChangeIsSafe(
        previousPlanType: FinancialPlan["planType"],
        nextPlanType: FinancialPlan["planType"],
        planId: string
    ): Promise<void> {
        if (previousPlanType === nextPlanType) {
            return;
        }

        const components =
            await this.componentRepository.listByPlan(
                planId
            );

        const incompatible =
            findComponentsIncompatibleWithPlanType(
                nextPlanType,
                components
            );

        if (incompatible.length === 0) {
            return;
        }

        const names = incompatible
            .map(
                component =>
                    component.label?.trim() ||
                    getPlanComponentComboLabel(
                        component.componentType,
                        component.role
                    )
            )
            .join(", ");

        throw new Error(
            `A ${getPlanTypeLabel(
                nextPlanType
            )} plan can't use these components: ${names}. Remove or delete them before changing the plan type.`
        );
    }

    private normalize(
        request:
            | CreateFinancialPlanRequest
            | UpdateFinancialPlanRequest
    ): NormalizedPlan {
        return {
            name: request.name.trim(),
            planType: request.planType,
            planCategory: request.planCategory,
            planSubcategory: request.planSubcategory,
            periodType: request.periodType,
            startDate: request.startDate,
            endDate:
                request.endDate?.trim() || null,
            currencyId: request.currencyId,
            targetAmount:
                request.targetAmount ?? null,
            goalId:
                request.goalId?.trim() || null,
            notes: request.notes?.trim() || null,
            status: request.status,
        };
    }

    // Field validation, then reference checks (currency exists, linked
    // Goal exists + same currency). Throws an Error whose message is
    // safe to surface directly in the Add / Edit Plan dialog. No
    // duplicate rule - plans may legitimately overlap.
    private async assertFinancialPlanIntegrity(
        plan: NormalizedPlan
    ): Promise<void> {
        const fieldError =
            validateFinancialPlanFields(plan);

        if (fieldError) {
            throw new Error(fieldError);
        }

        const currency =
            await this.currencyRepository.getById(
                plan.currencyId
            );

        const currencyCheck =
            validateFinancialPlanCurrency(currency);

        if (!currencyCheck.ok) {
            throw new Error(
                currencyCheck.reason ??
                    "Invalid plan currency."
            );
        }

        if (plan.goalId !== null) {
            // FinancialGoalRepository.getById returns null for a
            // soft-deleted goal.
            const goal =
                await this.goalRepository.getById(
                    plan.goalId
                );

            const goalCheck =
                validateFinancialPlanGoal(
                    plan.goalId,
                    goal,
                    plan.currencyId
                );

            if (!goalCheck.ok) {
                throw new Error(
                    goalCheck.reason ??
                        "Invalid goal link."
                );
            }
        }
    }
}
