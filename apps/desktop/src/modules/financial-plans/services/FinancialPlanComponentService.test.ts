import { describe, expect, it } from "vitest";

import type { Account } from "@/modules/accounts/types";
import type { Category } from "@/modules/categories/types";
import type { Investment } from "@/modules/investments/types";
import type { Loan } from "@/modules/loans/types";

import type {
    CreateFinancialPlanComponentRequest,
    FinancialPlan,
    FinancialPlanComponent,
    PlanType,
} from "../types";

import { FinancialPlanComponentService } from "./FinancialPlanComponentService";

// FinancialPlanComponentRepository / FinancialPlanRepository and the four
// source repositories all talk to a live Tauri SQLite connection,
// unavailable here. Following BudgetService.test.ts, every repository is
// replaced with an in-memory fake.

function plan(
    overrides: Partial<FinancialPlan> = {}
): FinancialPlan {
    return {
        id: "plan-1",
        name: "Plan",
        planType: "ACCUMULATION",
        planCategory: "CORE_PERSONAL_FINANCE",
        planSubcategory: "SAVINGS",
        periodType: "MONTHLY",
        startDate: "2026-09-01",
        endDate: null,
        currencyId: "INR",
        targetAmount: 1000000,
        goalId: null,
        notes: null,
        status: "ACTIVE",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
        ...overrides,
    };
}

function account(
    overrides: Partial<Account> = {}
): Account {
    return {
        id: "acc-1",
        name: "Savings",
        type: "SAVINGS" as Account["type"],
        institutionId: null,
        businessEntityId: null,
        currencyId: "INR",
        openingBalance: 0,
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function category(
    overrides: Partial<Category> = {}
): Category {
    return {
        id: "cat-1",
        parentId: null,
        name: "Salary",
        categoryType: "INCOME",
        financeScope: "PERSONAL" as Category["financeScope"],
        businessEntityId: null,
        description: null,
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function investment(
    overrides: Partial<Investment> = {}
): Investment {
    return {
        id: "inv-1",
        accountId: null,
        businessEntityId: null,
        name: "Index Fund",
        investmentType: "MUTUAL_FUND",
        investmentSubtype: null,
        symbol: null,
        isin: null,
        currencyId: "INR",
        brokerInstitutionId: null,
        quantity: 10,
        averageCost: 100,
        currentPrice: 120,
        currentValue: 1200,
        purchaseDate: null,
        status: "ACTIVE" as Investment["status"],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function loan(overrides: Partial<Loan> = {}): Loan {
    return {
        id: "loan-1",
        accountId: null,
        loanAccountId: null,
        lenderInstitutionId: null,
        loanType: "PERSONAL",
        name: "Car Loan",
        principalAmount: 500000,
        interestRate: 9,
        interestType: "REDUCING",
        tenureMonths: 60,
        emiAmount: 10000,
        startDate: "2026-01-01",
        maturityDate: null,
        outstandingPrincipal: 400000,
        outstandingInterest: 20000,
        paidInstallments: 0,
        currencyId: "INR",
        status: "ACTIVE",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

interface SetupOptions {
    plans?: FinancialPlan[];
    accounts?: Account[];
    categories?: Category[];
    investments?: Investment[];
    loans?: Loan[];
    components?: FinancialPlanComponent[];
}

function createService(options: SetupOptions = {}) {
    const plansById = new Map(
        (options.plans ?? [plan()]).map(p => [p.id, p])
    );
    const accountsById = new Map(
        (options.accounts ?? [account()]).map(a => [
            a.id,
            a,
        ])
    );
    const categoriesById = new Map(
        (options.categories ?? [category()]).map(c => [
            c.id,
            c,
        ])
    );
    const investmentsById = new Map(
        (options.investments ?? [investment()]).map(
            i => [i.id, i]
        )
    );
    const loansById = new Map(
        (options.loans ?? [loan()]).map(l => [l.id, l])
    );

    const store: FinancialPlanComponent[] = (
        options.components ?? []
    ).map(c => ({ ...c }));

    const componentRepo = {
        async listByPlan(planId: string) {
            return store
                .filter(c => c.planId === planId)
                .map(c => ({ ...c }))
                .sort(
                    (a, b) =>
                        a.sortOrder - b.sortOrder
                );
        },
        async getById(id: string) {
            const found = store.find(
                c => c.id === id
            );
            return found ? { ...found } : null;
        },
        async countByPlan(planId: string) {
            return store.filter(
                c => c.planId === planId
            ).length;
        },
        async create(component: FinancialPlanComponent) {
            store.push({ ...component });
        },
        async update(request: {
            id: string;
            role: FinancialPlanComponent["role"];
            label: string | null;
            targetAmount: number | null;
            sortOrder: number;
            isActive: boolean;
            notes: string | null;
        }) {
            const found = store.find(
                c => c.id === request.id
            );
            if (found) {
                found.role = request.role;
                found.label = request.label;
                found.targetAmount =
                    request.targetAmount;
                found.sortOrder = request.sortOrder;
                found.isActive = request.isActive;
                found.notes = request.notes;
            }
        },
        async updateSortOrder(
            id: string,
            sortOrder: number
        ) {
            const found = store.find(
                c => c.id === id
            );
            if (found) {
                found.sortOrder = sortOrder;
            }
        },
        async softDelete(id: string) {
            const index = store.findIndex(
                c => c.id === id
            );
            if (index >= 0) {
                store.splice(index, 1);
            }
        },
        async softDeleteByPlan(planId: string) {
            for (
                let i = store.length - 1;
                i >= 0;
                i--
            ) {
                if (store[i].planId === planId) {
                    store.splice(i, 1);
                }
            }
        },
    };

    const service = new FinancialPlanComponentService();

    Object.defineProperty(service, "repository", {
        value: componentRepo,
    });
    Object.defineProperty(service, "planRepository", {
        value: {
            async getById(id: string) {
                return plansById.get(id) ?? null;
            },
        },
    });
    Object.defineProperty(
        service,
        "accountRepository",
        {
            value: {
                async getById(id: string) {
                    return (
                        accountsById.get(id) ?? null
                    );
                },
            },
        }
    );
    Object.defineProperty(
        service,
        "categoryRepository",
        {
            value: {
                async getById(id: string) {
                    return (
                        categoriesById.get(id) ?? null
                    );
                },
            },
        }
    );
    Object.defineProperty(
        service,
        "investmentRepository",
        {
            value: {
                async getById(id: string) {
                    return (
                        investmentsById.get(id) ??
                        null
                    );
                },
            },
        }
    );
    Object.defineProperty(
        service,
        "loanRepository",
        {
            value: {
                async getById(id: string) {
                    return loansById.get(id) ?? null;
                },
            },
        }
    );

    return { service, store };
}

function baseCreate(
    overrides: Partial<CreateFinancialPlanComponentRequest> = {}
): CreateFinancialPlanComponentRequest {
    return {
        planId: "plan-1",
        componentType: "ACCOUNT",
        role: "ASSET",
        sourceId: "acc-1",
        ...overrides,
    };
}

describe("FinancialPlanComponentService.create - happy paths", () => {
    it("creates an ACCOUNT/ASSET component on an ACCUMULATION plan", async () => {
        const { service, store } = createService();

        const id = await service.create(baseCreate());

        expect(store).toHaveLength(1);
        expect(store[0]).toMatchObject({
            id,
            componentType: "ACCOUNT",
            role: "ASSET",
            accountId: "acc-1",
            categoryId: null,
            isActive: true,
            sortOrder: 0,
        });
    });

    it("auto-increments sort_order", async () => {
        const { service, store } = createService({
            investments: [
                investment({ id: "inv-1" }),
                investment({ id: "inv-2" }),
            ],
        });

        await service.create(baseCreate());
        await service.create(
            baseCreate({
                componentType: "INVESTMENT",
                role: "ASSET",
                sourceId: "inv-1",
            })
        );

        expect(
            store.map(c => c.sortOrder)
        ).toEqual([0, 1]);
    });
});

describe("FinancialPlanComponentService.create - integrity", () => {
    it("rejects when the plan does not exist", async () => {
        const { service } = createService({
            plans: [],
        });

        await expect(
            service.create(baseCreate())
        ).rejects.toThrow(/no longer exists/i);
    });

    it("rejects a combo outside the plan_type matrix", async () => {
        const { service } = createService();

        await expect(
            service.create(
                baseCreate({ role: "LIABILITY" })
            )
        ).rejects.toThrow(/cannot include/i);
    });

    it("rejects a missing / soft-deleted source", async () => {
        const { service } = createService();

        await expect(
            service.create(
                baseCreate({ sourceId: "acc-gone" })
            )
        ).rejects.toThrow(/no longer exists/i);
    });

    it("rejects an ACCOUNT/ASSET backed by a credit-card account", async () => {
        const { service } = createService({
            accounts: [
                account({
                    id: "cc-1",
                    type: "CREDIT_CARD" as Account["type"],
                }),
            ],
        });

        await expect(
            service.create(
                baseCreate({ sourceId: "cc-1" })
            )
        ).rejects.toThrow(
            /cash, savings, current or wallet/i
        );
    });

    it("rejects a TRANSFER category and a role that does not match category_type", async () => {
        const { service } = createService({
            plans: [
                plan({
                    planType:
                        "CASHFLOW_TARGET" as PlanType,
                    targetAmount: 50000,
                }),
            ],
            categories: [
                category({
                    id: "cat-transfer",
                    categoryType: "TRANSFER",
                }),
                category({
                    id: "cat-expense",
                    categoryType: "EXPENSE",
                }),
            ],
        });

        await expect(
            service.create(
                baseCreate({
                    componentType: "CATEGORY",
                    role: "SPENDING",
                    sourceId: "cat-transfer",
                })
            )
        ).rejects.toThrow(/transfer categories/i);

        await expect(
            service.create(
                baseCreate({
                    componentType: "CATEGORY",
                    role: "CONTRIBUTION",
                    sourceId: "cat-expense",
                })
            )
        ).rejects.toThrow(/expense category/i);
    });

    it("rejects a non-active investment / loan source", async () => {
        const { service } = createService({
            plans: [
                plan({
                    planType:
                        "PORTFOLIO_GROWTH" as PlanType,
                }),
            ],
            investments: [
                investment({
                    id: "inv-closed",
                    status: "CLOSED" as Investment["status"],
                }),
            ],
        });

        await expect(
            service.create(
                baseCreate({
                    componentType: "INVESTMENT",
                    role: "ASSET",
                    sourceId: "inv-closed",
                })
            )
        ).rejects.toThrow(/no longer active/i);
    });

    it("rejects a source in a different currency", async () => {
        const { service } = createService({
            accounts: [
                account({
                    id: "acc-usd",
                    currencyId: "USD",
                }),
            ],
        });

        await expect(
            service.create(
                baseCreate({ sourceId: "acc-usd" })
            )
        ).rejects.toThrow(/different currency/i);
    });

    it("rejects an exact duplicate but allows the same source in a different role", async () => {
        const { service } = createService({
            plans: [
                plan({
                    planType:
                        "PORTFOLIO_GROWTH" as PlanType,
                }),
            ],
        });

        await service.create(
            baseCreate({
                componentType: "INVESTMENT",
                role: "ASSET",
                sourceId: "inv-1",
            })
        );

        await expect(
            service.create(
                baseCreate({
                    componentType: "INVESTMENT",
                    role: "ASSET",
                    sourceId: "inv-1",
                })
            )
        ).rejects.toThrow(/already has a component/i);

        await expect(
            service.create(
                baseCreate({
                    componentType: "INVESTMENT",
                    role: "CONTRIBUTION",
                    sourceId: "inv-1",
                })
            )
        ).resolves.toBeDefined();
    });

    it("enforces the 20-component cap", async () => {
        const components: FinancialPlanComponent[] =
            Array.from({ length: 20 }, (_, i) => ({
                id: `c-${i}`,
                planId: "plan-1",
                componentType: "ACCOUNT" as const,
                role: "ASSET" as const,
                accountId: `acc-${i}`,
                categoryId: null,
                investmentId: null,
                loanId: null,
                label: null,
                targetAmount: null,
                sortOrder: i,
                isActive: true,
                notes: null,
                createdAt: "2026-09-01T00:00:00.000Z",
                updatedAt: "2026-09-01T00:00:00.000Z",
            }));

        const { service } = createService({
            components,
            accounts: Array.from(
                { length: 22 },
                (_, i) => account({ id: `acc-${i}` })
            ),
        });

        await expect(
            service.create(
                baseCreate({ sourceId: "acc-21" })
            )
        ).rejects.toThrow(/maximum number/i);
    });

    it("CASHFLOW_TARGET cannot mix account and category, and forbids component targets", async () => {
        const { service } = createService({
            plans: [
                plan({
                    planType:
                        "CASHFLOW_TARGET" as PlanType,
                    targetAmount: 40000,
                }),
            ],
            categories: [
                category({
                    id: "cat-income",
                    categoryType: "INCOME",
                }),
                category({
                    id: "cat-expense",
                    categoryType: "EXPENSE",
                }),
            ],
        });

        await service.create(
            baseCreate({
                componentType: "CATEGORY",
                role: "CONTRIBUTION",
                sourceId: "cat-income",
            })
        );

        await expect(
            service.create(
                baseCreate({
                    componentType: "ACCOUNT",
                    role: "CONTRIBUTION",
                    sourceId: "acc-1",
                })
            )
        ).rejects.toThrow(
            /account-scoped or category-scoped/i
        );

        await expect(
            service.create(
                baseCreate({
                    componentType: "CATEGORY",
                    role: "SPENDING",
                    sourceId: "cat-expense",
                    targetAmount: 100,
                })
            )
        ).rejects.toThrow(/per-period target/i);
    });
});

describe("FinancialPlanComponentService.update", () => {
    it("throws when the component is gone", async () => {
        const { service } = createService();

        await expect(
            service.update({
                id: "missing",
                role: "ASSET",
            })
        ).rejects.toThrow(/no longer exists/i);
    });

    it("changes only mutable fields and keeps source immutable", async () => {
        const { service, store } = createService({
            plans: [
                plan({
                    planType:
                        "PORTFOLIO_GROWTH" as PlanType,
                }),
            ],
        });

        const id = await service.create(
            baseCreate({
                componentType: "INVESTMENT",
                role: "ASSET",
                sourceId: "inv-1",
                label: "Old",
            })
        );

        await service.update({
            id,
            role: "CONTRIBUTION",
            label: "New",
            targetAmount: 5000,
        });

        expect(store[0]).toMatchObject({
            role: "CONTRIBUTION",
            label: "New",
            targetAmount: 5000,
            componentType: "INVESTMENT",
            investmentId: "inv-1",
        });
    });

    it("rejects an update whose new role leaves the matrix", async () => {
        const { service } = createService();

        const id = await service.create(baseCreate());

        await expect(
            service.update({
                id,
                role: "LIABILITY",
            })
        ).rejects.toThrow(/cannot include/i);
    });
});

describe("FinancialPlanComponentService.reorder / setActive / delete", () => {
    it("reorder rewrites sort_order from array position", async () => {
        const { service, store } = createService({
            investments: [
                investment({ id: "inv-1" }),
                investment({ id: "inv-2" }),
            ],
        });

        const a = await service.create(baseCreate());
        const b = await service.create(
            baseCreate({
                componentType: "INVESTMENT",
                role: "ASSET",
                sourceId: "inv-1",
            })
        );

        await service.reorder({
            planId: "plan-1",
            orderedIds: [b, a],
        });

        const byId = new Map(
            store.map(c => [c.id, c.sortOrder])
        );
        expect(byId.get(b)).toBe(0);
        expect(byId.get(a)).toBe(1);
    });

    it("reorder rejects ids that are not on the plan", async () => {
        const { service } = createService();
        await service.create(baseCreate());

        await expect(
            service.reorder({
                planId: "plan-1",
                orderedIds: ["not-real"],
            })
        ).rejects.toThrow(/not on this plan/i);
    });

    it("setActive toggles the flag without touching anything else", async () => {
        const { service, store } = createService();
        const id = await service.create(baseCreate());

        await service.setActive(id, false);

        expect(store[0].isActive).toBe(false);
        expect(store[0].accountId).toBe("acc-1");
    });

    it("delete soft-removes a single component", async () => {
        const { service, store } = createService();
        const id = await service.create(baseCreate());

        await service.delete(id);

        expect(store).toHaveLength(0);
    });
});

describe("FinancialPlanComponentService.listForPlan - availability", () => {
    it("returns [] for a missing plan and never throws", async () => {
        const { service } = createService({
            plans: [],
        });

        await expect(
            service.listForPlan("nope")
        ).resolves.toEqual([]);
    });

    it("reports a live source as available with its name and currency", async () => {
        const { service } = createService();
        await service.create(baseCreate());

        const [view] =
            await service.listForPlan("plan-1");

        expect(view).toMatchObject({
            available: true,
            unavailableReason: null,
            sourceName: "Savings",
            sourceCurrencyId: "INR",
        });
    });

    it("marks a deleted source unavailable (SOURCE_MISSING) without throwing", async () => {
        const setup = createService();
        await setup.service.create(baseCreate());

        // Simulate the account being soft-deleted afterwards.
        const service = new FinancialPlanComponentService();
        Object.defineProperty(service, "repository", {
            value: {
                async listByPlan() {
                    return setup.store.map(c => ({
                        ...c,
                    }));
                },
            },
        });
        Object.defineProperty(
            service,
            "planRepository",
            {
                value: {
                    async getById() {
                        return plan();
                    },
                },
            }
        );
        Object.defineProperty(
            service,
            "accountRepository",
            {
                value: {
                    async getById() {
                        return null;
                    },
                },
            }
        );

        const [view] =
            await service.listForPlan("plan-1");

        expect(view).toMatchObject({
            available: false,
            unavailableReason: "SOURCE_MISSING",
        });
    });

    it("marks a now-mismatched currency unavailable (CURRENCY_MISMATCH)", async () => {
        const setup = createService();
        await setup.service.create(baseCreate());

        const service = new FinancialPlanComponentService();
        Object.defineProperty(service, "repository", {
            value: {
                async listByPlan() {
                    return setup.store.map(c => ({
                        ...c,
                    }));
                },
            },
        });
        Object.defineProperty(
            service,
            "planRepository",
            {
                value: {
                    async getById() {
                        return plan();
                    },
                },
            }
        );
        Object.defineProperty(
            service,
            "accountRepository",
            {
                value: {
                    async getById() {
                        return account({
                            currencyId: "USD",
                        });
                    },
                },
            }
        );

        const [view] =
            await service.listForPlan("plan-1");

        expect(view).toMatchObject({
            available: false,
            unavailableReason: "CURRENCY_MISMATCH",
            sourceCurrencyId: "USD",
        });
    });
});
