import { AccountRepository } from "@/modules/accounts/repositories/AccountRepository";
import { CategoryRepository } from "@/modules/categories/repositories";
import { InvestmentRepository } from "@/modules/investments/repositories";
import { LoanRepository } from "@/modules/loans/repositories/LoanRepository";

import {
    FinancialPlanComponentRepository,
    FinancialPlanRepository,
} from "../repositories";

import type {
    CreateFinancialPlanComponentRequest,
    FinancialPlan,
    FinancialPlanComponent,
    FinancialPlanComponentView,
    PlanComponentType,
    ReorderFinancialPlanComponentsRequest,
    UpdateFinancialPlanComponentRequest,
} from "../types";

import {
    exceedsComponentLimit,
    findDuplicateComponent,
    validateAccountSource,
    validateCategorySource,
    validateComponentCombo,
    validateComponentCurrency,
    validateComponentFields,
    validateComponentTarget,
    validateInvestmentSource,
    validateLoanSource,
    violatesCashflowMode,
    type ComponentReferenceCheck,
} from "./financialPlanComponentValidation";

interface NormalizedComponent {
    planId: string;
    componentType: PlanComponentType;
    role: FinancialPlanComponent["role"];
    sourceId: string;
    label: string | null;
    targetAmount: number | null;
    notes: string | null;
    isActive: boolean;
    sortOrder: number | null;
}

/** A source resolved from its typed repository (or null when gone). */
interface ResolvedSource {
    name: string | null;
    currencyId: string | null;
    check: ComponentReferenceCheck;
}

export class FinancialPlanComponentService {
    private readonly repository =
        new FinancialPlanComponentRepository();

    private readonly planRepository =
        new FinancialPlanRepository();

    private readonly accountRepository =
        new AccountRepository();

    private readonly categoryRepository =
        new CategoryRepository();

    private readonly investmentRepository =
        new InvestmentRepository();

    private readonly loanRepository =
        new LoanRepository();

    // ------------------------------------------------------------------
    // Reads
    // ------------------------------------------------------------------

    /**
     * Every non-deleted component of a plan, each resolved to its live
     * source name + currency and an availability verdict. Never throws:
     * a missing / deleted / currency-changed / wrong-typed source yields
     * `available: false` with a reason, not an error. Returns [] for a
     * missing or soft-deleted plan.
     */
    async listForPlan(
        planId: string
    ): Promise<FinancialPlanComponentView[]> {
        const plan =
            await this.planRepository.getById(planId);

        if (!plan) {
            return [];
        }

        const components =
            await this.repository.listByPlan(planId);

        const views: FinancialPlanComponentView[] = [];

        for (const component of components) {
            views.push(
                await this.toView(component, plan)
            );
        }

        return views;
    }

    private async toView(
        component: FinancialPlanComponent,
        plan: FinancialPlan
    ): Promise<FinancialPlanComponentView> {
        let resolved: ResolvedSource;

        try {
            resolved = await this.resolveSource(
                component.componentType,
                this.sourceIdOf(component),
                component.role
            );
        } catch {
            resolved = {
                name: null,
                currencyId: null,
                check: {
                    ok: false,
                    unavailableReason: "SOURCE_MISSING",
                },
            };
        }

        let check = resolved.check;

        if (check.ok) {
            check = validateComponentCurrency(
                component.componentType,
                resolved.currencyId,
                plan.currencyId
            );
        }

        return {
            ...component,
            sourceName: resolved.name,
            sourceCurrencyId: resolved.currencyId,
            available: check.ok,
            unavailableReason: check.ok
                ? null
                : check.unavailableReason ??
                  "SOURCE_MISSING",
        };
    }

    // ------------------------------------------------------------------
    // Writes
    // ------------------------------------------------------------------

    async create(
        request: CreateFinancialPlanComponentRequest
    ): Promise<string> {
        const plan = await this.planRepository.getById(
            request.planId
        );

        if (!plan) {
            throw new Error(
                "This financial plan no longer exists."
            );
        }

        const existing =
            await this.repository.listByPlan(
                request.planId
            );

        const normalized = this.normalize(
            request,
            existing
        );

        await this.assertComponentIntegrity(
            plan,
            normalized,
            null,
            existing
        );

        const now = new Date().toISOString();

        const component: FinancialPlanComponent = {
            id: crypto.randomUUID(),
            planId: normalized.planId,
            componentType: normalized.componentType,
            role: normalized.role,
            accountId:
                normalized.componentType === "ACCOUNT"
                    ? normalized.sourceId
                    : null,
            categoryId:
                normalized.componentType === "CATEGORY"
                    ? normalized.sourceId
                    : null,
            investmentId:
                normalized.componentType ===
                "INVESTMENT"
                    ? normalized.sourceId
                    : null,
            loanId:
                normalized.componentType === "LOAN"
                    ? normalized.sourceId
                    : null,
            label: normalized.label,
            targetAmount: normalized.targetAmount,
            sortOrder: normalized.sortOrder ?? 0,
            isActive: normalized.isActive,
            notes: normalized.notes,
            createdAt: now,
            updatedAt: now,
        };

        await this.repository.create(component);

        return component.id;
    }

    async update(
        request: UpdateFinancialPlanComponentRequest
    ): Promise<void> {
        const existing =
            await this.repository.getById(request.id);

        if (!existing) {
            throw new Error(
                "This plan component no longer exists."
            );
        }

        const plan = await this.planRepository.getById(
            existing.planId
        );

        if (!plan) {
            throw new Error(
                "This financial plan no longer exists."
            );
        }

        // componentType and the source FK are immutable - only re-check
        // the mutable fields (role against the matrix, target rules).
        const role = request.role;

        const comboError = validateComponentCombo(
            plan.planType,
            existing.componentType,
            role
        );

        if (comboError) {
            throw new Error(comboError);
        }

        const targetAmount =
            request.targetAmount ?? null;

        if (targetAmount !== null) {
            if (
                !Number.isFinite(targetAmount) ||
                targetAmount < 0
            ) {
                throw new Error(
                    "The component target must be a number of zero or more."
                );
            }
        }

        const targetError = validateComponentTarget(
            plan.planType,
            targetAmount
        );

        if (targetError) {
            throw new Error(targetError);
        }

        // Changing the role must not collide with a sibling on the same
        // source (component_type + source are immutable, role is not).
        if (role !== existing.role) {
            const siblings =
                await this.repository.listByPlan(
                    existing.planId
                );

            const duplicate = findDuplicateComponent(
                {
                    id: existing.id,
                    componentType:
                        existing.componentType,
                    role,
                    sourceId:
                        this.sourceIdOf(existing),
                },
                siblings
            );

            if (duplicate) {
                throw new Error(
                    "This plan already has a component for that source in the same role."
                );
            }
        }

        // A CATEGORY component's role stays bound to category_type.
        if (existing.componentType === "CATEGORY") {
            const category =
                await this.categoryRepository.getById(
                    existing.categoryId ?? ""
                );

            const check = validateCategorySource(
                role,
                category
            );

            if (!check.ok && category) {
                throw new Error(
                    check.reason ??
                        "Invalid category role."
                );
            }
        }

        await this.repository.update({
            id: request.id,
            role,
            label:
                request.label?.trim() || null,
            targetAmount,
            sortOrder:
                request.sortOrder ??
                existing.sortOrder,
            isActive:
                request.isActive ??
                existing.isActive,
            notes: request.notes?.trim() || null,
        });
    }

    async setActive(
        id: string,
        isActive: boolean
    ): Promise<void> {
        const existing =
            await this.repository.getById(id);

        if (!existing) {
            throw new Error(
                "This plan component no longer exists."
            );
        }

        await this.repository.update({
            id,
            role: existing.role,
            label: existing.label,
            targetAmount: existing.targetAmount,
            sortOrder: existing.sortOrder,
            isActive,
            notes: existing.notes,
        });
    }

    async reorder(
        request: ReorderFinancialPlanComponentsRequest
    ): Promise<void> {
        const existing =
            await this.repository.listByPlan(
                request.planId
            );

        const existingIds = new Set(
            existing.map(component => component.id)
        );

        const unknown = request.orderedIds.filter(
            id => !existingIds.has(id)
        );

        if (unknown.length > 0) {
            throw new Error(
                "The component order refers to components that are not on this plan."
            );
        }

        for (const [
            index,
            id,
        ] of request.orderedIds.entries()) {
            await this.repository.updateSortOrder(
                id,
                index
            );
        }
    }

    async delete(id: string): Promise<void> {
        await this.repository.softDelete(id);
    }

    /** Used by FinancialPlanService.delete - a plan cascade to components. */
    async deleteByPlan(planId: string): Promise<void> {
        await this.repository.softDeleteByPlan(planId);
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    private sourceIdOf(
        component: FinancialPlanComponent
    ): string {
        return (
            component.accountId ??
            component.categoryId ??
            component.investmentId ??
            component.loanId ??
            ""
        );
    }

    private normalize(
        request: CreateFinancialPlanComponentRequest,
        existing: readonly FinancialPlanComponent[]
    ): NormalizedComponent {
        const nextSortOrder =
            existing.reduce(
                (max, component) =>
                    Math.max(max, component.sortOrder),
                -1
            ) + 1;

        return {
            planId: request.planId,
            componentType: request.componentType,
            role: request.role,
            sourceId: request.sourceId?.trim() ?? "",
            label: request.label?.trim() || null,
            targetAmount:
                request.targetAmount ?? null,
            notes: request.notes?.trim() || null,
            isActive: request.isActive ?? true,
            sortOrder:
                request.sortOrder ?? nextSortOrder,
        };
    }

    // Field checks -> matrix -> source resolution / type / status ->
    // currency -> CASHFLOW_TARGET single-mode -> target rules ->
    // duplicate -> per-plan cap. Throws a dialog-safe Error.
    private async assertComponentIntegrity(
        plan: FinancialPlan,
        input: NormalizedComponent,
        currentId: string | null,
        existing: readonly FinancialPlanComponent[]
    ): Promise<void> {
        const fieldError = validateComponentFields({
            componentType: input.componentType,
            role: input.role,
            sourceId: input.sourceId,
            label: input.label,
            targetAmount: input.targetAmount,
            notes: input.notes,
        });

        if (fieldError) {
            throw new Error(fieldError);
        }

        const comboError = validateComponentCombo(
            plan.planType,
            input.componentType,
            input.role
        );

        if (comboError) {
            throw new Error(comboError);
        }

        const resolved = await this.resolveSource(
            input.componentType,
            input.sourceId,
            input.role
        );

        if (!resolved.check.ok) {
            throw new Error(
                resolved.check.reason ??
                    "The selected source is not valid for this component."
            );
        }

        const currencyCheck =
            validateComponentCurrency(
                input.componentType,
                resolved.currencyId,
                plan.currencyId
            );

        if (!currencyCheck.ok) {
            throw new Error(
                currencyCheck.reason ??
                    "The selected source uses a different currency to this plan."
            );
        }

        if (
            violatesCashflowMode(
                plan.planType,
                input.componentType,
                existing.filter(
                    component =>
                        component.id !== currentId
                )
            )
        ) {
            throw new Error(
                "A cash-flow plan is either account-scoped or category-scoped - it cannot mix account and category components."
            );
        }

        const targetError = validateComponentTarget(
            plan.planType,
            input.targetAmount
        );

        if (targetError) {
            throw new Error(targetError);
        }

        const duplicate = findDuplicateComponent(
            {
                id: currentId,
                componentType: input.componentType,
                role: input.role,
                sourceId: input.sourceId,
            },
            existing
        );

        if (duplicate) {
            throw new Error(
                "This plan already has a component for that source in the same role."
            );
        }

        if (
            currentId === null &&
            exceedsComponentLimit(existing.length)
        ) {
            throw new Error(
                "This plan already has the maximum number of components."
            );
        }
    }

    private async resolveSource(
        componentType: PlanComponentType,
        sourceId: string,
        role: FinancialPlanComponent["role"]
    ): Promise<ResolvedSource> {
        if (componentType === "ACCOUNT") {
            const account =
                await this.accountRepository.getById(
                    sourceId
                );

            return {
                name: account?.name ?? null,
                currencyId:
                    account?.currencyId ?? null,
                check: validateAccountSource(
                    role,
                    account
                ),
            };
        }

        if (componentType === "CATEGORY") {
            const category =
                await this.categoryRepository.getById(
                    sourceId
                );

            return {
                name: category?.name ?? null,
                currencyId: null,
                check: validateCategorySource(
                    role,
                    category
                ),
            };
        }

        if (componentType === "INVESTMENT") {
            const investment =
                await this.investmentRepository.getById(
                    sourceId
                );

            return {
                name: investment?.name ?? null,
                currencyId:
                    investment?.currencyId ?? null,
                check: validateInvestmentSource(
                    investment
                ),
            };
        }

        const loan =
            await this.loanRepository.getById(
                sourceId
            );

        return {
            name: loan?.name ?? null,
            currencyId: loan?.currencyId ?? null,
            check: validateLoanSource(loan),
        };
    }
}
