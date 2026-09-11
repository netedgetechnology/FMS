import { describe, expect, it } from "vitest";

import type { Currency } from "@/modules/currencies/types";
import type { FinancialGoal } from "@/modules/financial-goals/types";

import type {
    CreateFinancialPlanRequest,
    FinancialPlan,
    FinancialPlanComponent,
    PlanComponentRole,
    PlanComponentType,
    UpdateFinancialPlanRequest,
} from "../types";

import { FinancialPlanService } from "./FinancialPlanService";

// FinancialPlanRepository / CurrencyRepository / FinancialGoalRepository
// talk to a live Tauri SQLite connection, unavailable here. Following the
// BudgetService.test.ts pattern, all three are replaced with in-memory
// fakes so the integrity rules can be exercised.

function currency(
    overrides: Partial<Currency> = {}
): Currency {
    return {
        id: "currency-inr",
        code: "INR",
        name: "Indian Rupee",
        symbol: "₹",
        isDefault: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function goal(
    overrides: Partial<FinancialGoal> = {}
): FinancialGoal {
    return {
        id: "goal-1",
        name: "House",
        goalType: "SAVINGS",
        goalCategory: "CORE_PERSONAL_FINANCE",
        goalSubcategory: "HOME_PURCHASE",
        goalMode: "MANUAL",
        targetAmount: 5000000,
        currentAmount: 0,
        currencyId: "currency-inr",
        targetDate: null,
        priority: 0,
        status: "ACTIVE",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function baseCreate(
    overrides: Partial<CreateFinancialPlanRequest> = {}
): CreateFinancialPlanRequest {
    return {
        name: "Retirement Corpus",
        planType: "ACCUMULATION",
        planCategory: "LONG_TERM_WEALTH",
        planSubcategory: "RETIREMENT",
        periodType: "MONTHLY",
        startDate: "2026-09-01",
        endDate: null,
        currencyId: "currency-inr",
        targetAmount: 5000000,
        goalId: null,
        notes: null,
        status: "ACTIVE",
        ...overrides,
    };
}

function makePlan(
    overrides: Partial<FinancialPlan> = {}
): FinancialPlan {
    return {
        id: "plan-1",
        name: "Existing",
        planType: "ACCUMULATION",
        planCategory: "LONG_TERM_WEALTH",
        planSubcategory: "RETIREMENT",
        periodType: "MONTHLY",
        startDate: "2026-09-01",
        endDate: null,
        currencyId: "currency-inr",
        targetAmount: 5000000,
        goalId: null,
        notes: null,
        status: "ACTIVE",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
        ...overrides,
    };
}

function makeComponent(
    componentType: PlanComponentType,
    role: PlanComponentRole,
    overrides: Partial<FinancialPlanComponent> = {}
): FinancialPlanComponent {
    return {
        id: `comp-${componentType}-${role}`,
        planId: "plan-1",
        componentType,
        role,
        accountId:
            componentType === "ACCOUNT"
                ? "acc-1"
                : null,
        categoryId:
            componentType === "CATEGORY"
                ? "cat-1"
                : null,
        investmentId:
            componentType === "INVESTMENT"
                ? "inv-1"
                : null,
        loanId:
            componentType === "LOAN"
                ? "loan-1"
                : null,
        label: null,
        targetAmount: null,
        sortOrder: 0,
        isActive: true,
        notes: null,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
        ...overrides,
    };
}

function createService(options: {
    plans?: FinancialPlan[];
    currencies?: Currency[];
    goals?: FinancialGoal[];
    components?: FinancialPlanComponent[];
}) {
    const store: FinancialPlan[] = (
        options.plans ?? []
    ).map(plan => ({ ...plan }));

    const currenciesById = new Map(
        (options.currencies ?? [currency()]).map(c => [
            c.id,
            c,
        ])
    );

    const goalsById = new Map(
        (options.goals ?? []).map(g => [g.id, g])
    );

    const created: FinancialPlan[] = [];
    const updated: UpdateFinancialPlanRequest[] = [];
    const deleted: string[] = [];
    const componentsClearedFor: string[] = [];
    const componentListCalls: string[] = [];
    // The repository's listByPlan already excludes soft-deleted rows, so
    // this fake only ever holds "live" (active or inactive) components.
    const liveComponents: FinancialPlanComponent[] =
        options.components ?? [];

    const service = new FinancialPlanService();

    Object.defineProperty(service, "repository", {
        value: {
            async getById(id: string) {
                return (
                    store.find(
                        plan => plan.id === id
                    ) ?? null
                );
            },
            async create(plan: FinancialPlan) {
                created.push(plan);
                store.push(plan);
            },
            async update(
                request: UpdateFinancialPlanRequest
            ) {
                updated.push(request);
            },
            async delete(id: string) {
                deleted.push(id);
            },
        },
    });

    Object.defineProperty(
        service,
        "componentRepository",
        {
            value: {
                async softDeleteByPlan(id: string) {
                    componentsClearedFor.push(id);
                },
                async listByPlan(id: string) {
                    componentListCalls.push(id);
                    return liveComponents.filter(
                        c => c.planId === id
                    );
                },
            },
        }
    );

    Object.defineProperty(
        service,
        "currencyRepository",
        {
            value: {
                async getById(id: string) {
                    return (
                        currenciesById.get(id) ?? null
                    );
                },
            },
        }
    );

    Object.defineProperty(
        service,
        "goalRepository",
        {
            value: {
                async getById(id: string) {
                    return goalsById.get(id) ?? null;
                },
            },
        }
    );

    return {
        service,
        created,
        updated,
        deleted,
        componentsClearedFor,
        componentListCalls,
        store,
    };
}

describe("FinancialPlanService.create - field validation", () => {
    it("rejects a missing name", async () => {
        const { service } = createService({});

        await expect(
            service.create(
                baseCreate({ name: "  " })
            )
        ).rejects.toThrow(/name is required/i);
    });

    it("rejects a ONE_TIME plan with no end date", async () => {
        const { service } = createService({});

        await expect(
            service.create(
                baseCreate({
                    periodType: "ONE_TIME",
                    endDate: null,
                })
            )
        ).rejects.toThrow(
            /one-time plan needs an end date/i
        );
    });

    it("rejects EXPENSE_PLAN with no target", async () => {
        const { service } = createService({});

        await expect(
            service.create(
                baseCreate({
                    planType: "EXPENSE_PLAN",
                    planCategory: "CORE_PERSONAL_FINANCE",
                    planSubcategory: "ANNUAL_EXPENSES",
                    targetAmount: null,
                })
            )
        ).rejects.toThrow(
            /expense plan needs a target/i
        );
    });

    it("accepts DEBT_PAYOFF with a null target", async () => {
        const { service, created } = createService(
            {}
        );

        await service.create(
            baseCreate({
                planType: "DEBT_PAYOFF",
                planCategory: "DEBT_LIABILITIES",
                planSubcategory: "DEBT_REDUCTION",
                targetAmount: null,
            })
        );

        expect(created).toHaveLength(1);
        expect(created[0].targetAmount).toBeNull();
    });

    it("creates a valid plan and normalizes blank optional fields to null", async () => {
        const { service, created } = createService(
            {}
        );

        await service.create(
            baseCreate({
                endDate: "  ",
                goalId: "  ",
                notes: "  ",
            })
        );

        expect(created[0].endDate).toBeNull();
        expect(created[0].goalId).toBeNull();
        expect(created[0].notes).toBeNull();
        expect(created[0].periodType).toBe("MONTHLY");
    });
});

describe("FinancialPlanService.create - reference validation", () => {
    it("rejects a currency that does not resolve", async () => {
        const { service } = createService({
            currencies: [currency()],
        });

        await expect(
            service.create(
                baseCreate({
                    currencyId: "currency-gone",
                })
            )
        ).rejects.toThrow(
            /currency no longer exists/i
        );
    });

    it("rejects a goal link when the goal does not exist", async () => {
        const { service } = createService({
            goals: [],
        });

        await expect(
            service.create(
                baseCreate({ goalId: "goal-x" })
            )
        ).rejects.toThrow(/goal no longer exists/i);
    });

    it("rejects a goal link in a different currency", async () => {
        const { service } = createService({
            goals: [
                goal({
                    id: "goal-usd",
                    currencyId: "currency-usd",
                }),
            ],
        });

        await expect(
            service.create(
                baseCreate({ goalId: "goal-usd" })
            )
        ).rejects.toThrow(/different currency/i);
    });

    it("accepts a same-currency goal link and stores only the id", async () => {
        const { service, created } = createService({
            goals: [goal({ id: "goal-1" })],
        });

        await service.create(
            baseCreate({ goalId: "goal-1" })
        );

        expect(created[0].goalId).toBe("goal-1");
        expect(created[0]).not.toHaveProperty(
            "goalTargetAmount"
        );
        expect(created[0]).not.toHaveProperty(
            "goalCurrentAmount"
        );
    });
});

describe("FinancialPlanService.update", () => {
    it("throws when the plan no longer exists", async () => {
        const { service } = createService({
            plans: [],
        });

        await expect(
            service.update({
                id: "missing",
                ...baseCreate(),
            })
        ).rejects.toThrow(/no longer exists/i);
    });

    it("re-validates on update (ONE_TIME still needs an end date)", async () => {
        const { service } = createService({
            plans: [makePlan({ id: "plan-1" })],
        });

        await expect(
            service.update({
                id: "plan-1",
                ...baseCreate({
                    periodType: "ONE_TIME",
                    endDate: null,
                }),
            })
        ).rejects.toThrow(
            /one-time plan needs an end date/i
        );
    });

    it("soft-deleting a plan cascades to its components (Phase 2)", async () => {
        const {
            service,
            deleted,
            componentsClearedFor,
        } = createService({
            plans: [makePlan({ id: "plan-1" })],
        });

        await service.delete("plan-1");

        expect(deleted).toEqual(["plan-1"]);
        expect(componentsClearedFor).toEqual([
            "plan-1",
        ]);
    });

    it("archiving a plan (status update) does NOT clear components", async () => {
        const {
            service,
            componentsClearedFor,
        } = createService({
            plans: [makePlan({ id: "plan-1" })],
        });

        await service.update({
            id: "plan-1",
            ...baseCreate({ status: "ARCHIVED" }),
        });

        expect(componentsClearedFor).toEqual([]);
    });

    it("updates a valid plan", async () => {
        const { service, updated } = createService({
            plans: [makePlan({ id: "plan-1" })],
        });

        await service.update({
            id: "plan-1",
            ...baseCreate({
                name: "Renamed",
                periodType: "QUARTERLY",
            }),
        });

        expect(updated).toHaveLength(1);
        expect(updated[0].name).toBe("Renamed");
        expect(updated[0].periodType).toBe(
            "QUARTERLY"
        );
    });
});

describe("FinancialPlanService.update - plan_type change integrity (Phase 4)", () => {
    function debtPayoffValues(
        over: Partial<CreateFinancialPlanRequest> = {}
    ) {
        return baseCreate({
            planType: "DEBT_PAYOFF",
            planCategory: "DEBT_LIABILITIES",
            planSubcategory: "DEBT_REDUCTION",
            targetAmount: null,
            ...over,
        });
    }

    it("does not fetch components when plan_type is unchanged", async () => {
        const { service, componentListCalls } =
            createService({
                plans: [
                    makePlan({
                        id: "plan-1",
                        planType: "ACCUMULATION",
                    }),
                ],
                components: [
                    makeComponent(
                        "INVESTMENT",
                        "ASSET"
                    ),
                ],
            });

        await service.update({
            id: "plan-1",
            ...baseCreate({
                planType: "ACCUMULATION",
                name: "Renamed",
            }),
        });

        expect(componentListCalls).toEqual([]);
    });

    it("allows a plan_type change when every component stays compatible", async () => {
        // ACCUMULATION <-> PORTFOLIO_GROWTH share ASSET + INVESTMENT·*
        const { service, updated } = createService({
            plans: [
                makePlan({
                    id: "plan-1",
                    planType: "ACCUMULATION",
                }),
            ],
            components: [
                makeComponent("INVESTMENT", "ASSET"),
                makeComponent(
                    "INVESTMENT",
                    "CONTRIBUTION"
                ),
                makeComponent("ACCOUNT", "ASSET"),
            ],
        });

        await service.update({
            id: "plan-1",
            ...baseCreate({
                planType: "PORTFOLIO_GROWTH",
                planCategory: "LONG_TERM_WEALTH",
                planSubcategory: "INVESTMENT_GROWTH",
            }),
        });

        expect(updated).toHaveLength(1);
        expect(updated[0].planType).toBe(
            "PORTFOLIO_GROWTH"
        );
    });

    it("blocks a plan_type change with an incompatible ACTIVE component and names it", async () => {
        const { service, updated } = createService({
            plans: [
                makePlan({
                    id: "plan-1",
                    planType: "ACCUMULATION",
                }),
            ],
            components: [
                makeComponent("INVESTMENT", "ASSET", {
                    label: "Index fund",
                }),
            ],
        });

        await expect(
            service.update({
                id: "plan-1",
                ...debtPayoffValues(),
            })
        ).rejects.toThrow(/Index fund/);

        expect(updated).toHaveLength(0);
    });

    it("blocks a plan_type change with an incompatible INACTIVE component", async () => {
        const { service } = createService({
            plans: [
                makePlan({
                    id: "plan-1",
                    planType: "ACCUMULATION",
                }),
            ],
            components: [
                makeComponent("INVESTMENT", "ASSET", {
                    isActive: false,
                }),
            ],
        });

        await expect(
            service.update({
                id: "plan-1",
                ...debtPayoffValues(),
            })
        ).rejects.toThrow(/can't use these components/i);
    });

    it("does NOT block when the only incompatible component is soft-deleted (repository excludes it)", async () => {
        // listByPlan already filters deleted_at IS NULL, so the fake
        // simply returns no components.
        const { service, updated } = createService({
            plans: [
                makePlan({
                    id: "plan-1",
                    planType: "ACCUMULATION",
                }),
            ],
            components: [],
        });

        await service.update({
            id: "plan-1",
            ...debtPayoffValues(),
        });

        expect(updated).toHaveLength(1);
        expect(updated[0].planType).toBe(
            "DEBT_PAYOFF"
        );
    });

    it("allows a plan_type change on a plan with zero components", async () => {
        const { service, updated } = createService({
            plans: [
                makePlan({
                    id: "plan-1",
                    planType: "ACCUMULATION",
                }),
            ],
        });

        await service.update({
            id: "plan-1",
            ...debtPayoffValues(),
        });

        expect(updated).toHaveLength(1);
    });

    it("blocks a component that carries a target the new plan_type forbids (CASHFLOW_TARGET)", async () => {
        const { service } = createService({
            plans: [
                makePlan({
                    id: "plan-1",
                    planType: "ACCUMULATION",
                }),
            ],
            components: [
                // CATEGORY·CONTRIBUTION is a valid CASHFLOW_TARGET combo,
                // but a per-component target is not allowed there.
                makeComponent(
                    "CATEGORY",
                    "CONTRIBUTION",
                    {
                        label: "Salary",
                        targetAmount: 1000,
                    }
                ),
            ],
        });

        await expect(
            service.update({
                id: "plan-1",
                ...baseCreate({
                    planType: "CASHFLOW_TARGET",
                    planCategory:
                        "BUSINESS_PROFESSIONAL",
                    planSubcategory: "WORKING_CAPITAL",
                    targetAmount: 25_000,
                }),
            })
        ).rejects.toThrow(/Salary/);
    });

    it("field validation still runs first: changing to EXPENSE_PLAN with no target throws before the component check", async () => {
        const { service, componentListCalls } =
            createService({
                plans: [
                    makePlan({
                        id: "plan-1",
                        planType: "ACCUMULATION",
                    }),
                ],
                components: [
                    makeComponent(
                        "INVESTMENT",
                        "ASSET"
                    ),
                ],
            });

        await expect(
            service.update({
                id: "plan-1",
                ...baseCreate({
                    planType: "EXPENSE_PLAN",
                    planCategory:
                        "CORE_PERSONAL_FINANCE",
                    planSubcategory: "ANNUAL_EXPENSES",
                    targetAmount: null,
                }),
            })
        ).rejects.toThrow(
            /expense plan needs a target/i
        );

        expect(componentListCalls).toEqual([]);
    });

    it("blocks a plan_type change even when the plan is ARCHIVED", async () => {
        const { service } = createService({
            plans: [
                makePlan({
                    id: "plan-1",
                    planType: "ACCUMULATION",
                    status: "ARCHIVED",
                }),
            ],
            components: [
                makeComponent("INVESTMENT", "ASSET"),
            ],
        });

        await expect(
            service.update({
                id: "plan-1",
                ...debtPayoffValues({
                    status: "ARCHIVED",
                }),
            })
        ).rejects.toThrow(/can't use these components/i);
    });
});

describe("FinancialPlanService.setStatus (Phase 6 archive / restore)", () => {
    it("archives an ACTIVE plan, preserving every other field", async () => {
        const { service, updated } = createService({
            plans: [
                makePlan({
                    id: "plan-1",
                    status: "ACTIVE",
                    name: "Emergency Fund",
                    targetAmount: 300000,
                }),
            ],
        });

        await service.setStatus(
            "plan-1",
            "ARCHIVED"
        );

        expect(updated).toHaveLength(1);
        expect(updated[0]).toMatchObject({
            id: "plan-1",
            status: "ARCHIVED",
            name: "Emergency Fund",
            targetAmount: 300000,
            planType: "ACCUMULATION",
        });
    });

    it("restores an ARCHIVED plan to ACTIVE", async () => {
        const { service, updated } = createService({
            plans: [
                makePlan({
                    id: "plan-1",
                    status: "ARCHIVED",
                }),
            ],
        });

        await service.setStatus(
            "plan-1",
            "ACTIVE"
        );

        expect(updated[0].status).toBe("ACTIVE");
    });

    it("throws when the plan no longer exists", async () => {
        const { service } = createService({
            plans: [],
        });

        await expect(
            service.setStatus(
                "missing",
                "ARCHIVED"
            )
        ).rejects.toThrow(/no longer exists/i);
    });

    it("rejects a status that is neither ARCHIVED nor ACTIVE", async () => {
        const { service } = createService({
            plans: [makePlan({ id: "plan-1" })],
        });

        await expect(
            service.setStatus(
                "plan-1",
                "PAUSED" as never
            )
        ).rejects.toThrow(
            /can only archive or restore/i
        );
    });

    it("rejects marking a plan COMPLETED through setStatus (that is an Edit-dialog change)", async () => {
        const { service } = createService({
            plans: [
                makePlan({
                    id: "plan-1",
                    status: "ACTIVE",
                }),
            ],
        });

        await expect(
            service.setStatus(
                "plan-1",
                "COMPLETED" as never
            )
        ).rejects.toThrow(
            /can only archive or restore/i
        );
    });

    it("archives a COMPLETED plan (Completed -> Archived is allowed)", async () => {
        const { service, updated } = createService({
            plans: [
                makePlan({
                    id: "plan-1",
                    status: "COMPLETED",
                }),
            ],
        });

        await service.setStatus(
            "plan-1",
            "ARCHIVED"
        );

        expect(updated[0].status).toBe("ARCHIVED");
    });

    it("rejects archiving an already-archived plan", async () => {
        const { service } = createService({
            plans: [
                makePlan({
                    id: "plan-1",
                    status: "ARCHIVED",
                }),
            ],
        });

        await expect(
            service.setStatus(
                "plan-1",
                "ARCHIVED"
            )
        ).rejects.toThrow(/already archived/i);
    });

    it("rejects restoring a plan that is not archived (Active -> Active, Completed -> Active)", async () => {
        const active = createService({
            plans: [
                makePlan({
                    id: "plan-1",
                    status: "ACTIVE",
                }),
            ],
        });
        await expect(
            active.service.setStatus(
                "plan-1",
                "ACTIVE"
            )
        ).rejects.toThrow(
            /only an archived plan can be restored/i
        );

        const completed = createService({
            plans: [
                makePlan({
                    id: "plan-1",
                    status: "COMPLETED",
                }),
            ],
        });
        await expect(
            completed.service.setStatus(
                "plan-1",
                "ACTIVE"
            )
        ).rejects.toThrow(
            /only an archived plan can be restored/i
        );
    });

    it("does not run field or plan_type validation - a plan with stale taxonomy can still be archived", async () => {
        const {
            service,
            updated,
            componentListCalls,
        } = createService({
            plans: [
                makePlan({
                    id: "plan-1",
                    planCategory:
                        "REMOVED_CATEGORY",
                    planSubcategory:
                        "REMOVED_SUBCATEGORY",
                }),
            ],
            components: [
                makeComponent("INVESTMENT", "ASSET"),
            ],
        });

        await service.setStatus(
            "plan-1",
            "ARCHIVED"
        );

        expect(updated[0].status).toBe("ARCHIVED");
        expect(updated[0].planCategory).toBe(
            "REMOVED_CATEGORY"
        );
        // no plan_type change -> no component fetch
        expect(componentListCalls).toEqual([]);
    });
});
