import { describe, expect, it } from "vitest";

import type { BusinessEntity } from "@/modules/business-entities/types";
import type { Category } from "@/modules/categories/types";
import type { Currency } from "@/modules/currencies/types";

import type {
    Budget,
    CreateBudgetRequest,
    UpdateBudgetRequest,
} from "../types";

import { BudgetService } from "./BudgetService";

// BudgetRepository / CategoryRepository / CurrencyRepository /
// BusinessEntityRepository talk to a live Tauri SQLite connection,
// unavailable here. Following the established TransactionService.test.ts
// pattern, all four are replaced with in-memory fakes so the integrity
// rules in BudgetService can be exercised.

function category(
    overrides: Partial<Category> = {}
): Category {
    return {
        id: "cat-food",
        parentId: null,
        name: "Food & Dining",
        categoryType: "EXPENSE",
        financeScope: "PERSONAL",
        businessEntityId: null,
        description: null,
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

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

function entity(
    overrides: Partial<BusinessEntity> = {}
): BusinessEntity {
    return {
        id: "entity-1",
        name: "Acme LLP",
        legalName: null,
        taxIdentifier: null,
        currencyId: "currency-inr",
        description: null,
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function makeBudget(
    overrides: Partial<Budget> = {}
): Budget {
    return {
        id: "existing-1",
        name: "Existing budget",
        categoryId: "cat-food",
        businessEntityId: null,
        amount: 10000,
        periodType: "MONTHLY",
        startDate: "2026-09-01",
        endDate: null,
        currencyId: "currency-inr",
        alertThreshold: 80,
        isActive: true,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
        ...overrides,
    };
}

function baseCreate(
    overrides: Partial<CreateBudgetRequest> = {}
): CreateBudgetRequest {
    return {
        name: "Food budget",
        categoryId: "cat-food",
        businessEntityId: null,
        amount: 10000,
        periodType: "MONTHLY",
        startDate: "2026-09-01",
        endDate: null,
        currencyId: "currency-inr",
        alertThreshold: 80,
        isActive: true,
        ...overrides,
    };
}

function createService(options: {
    budgets?: Budget[];
    categories?: Category[];
    currencies?: Currency[];
    entities?: BusinessEntity[];
}) {
    const store: Budget[] = (options.budgets ?? []).map(
        budget => ({ ...budget })
    );

    const categoriesById = new Map(
        (options.categories ?? [category()]).map(
            cat => [cat.id, cat]
        )
    );

    const currenciesById = new Map(
        (
            options.currencies ?? [
                currency(),
                currency({
                    id: "currency-usd",
                    code: "USD",
                    isDefault: false,
                }),
            ]
        ).map(cur => [cur.id, cur])
    );

    const entitiesById = new Map(
        (options.entities ?? []).map(ent => [
            ent.id,
            ent,
        ])
    );

    const created: Budget[] = [];
    const updated: UpdateBudgetRequest[] = [];

    const service = new BudgetService();

    Object.defineProperty(service, "repository", {
        value: {
            async getAll() {
                return store.map(budget => ({
                    ...budget,
                }));
            },
            async getById(id: string) {
                return (
                    store.find(
                        budget => budget.id === id
                    ) ?? null
                );
            },
            async create(budget: Budget) {
                created.push(budget);
                store.push(budget);
            },
            async update(
                request: UpdateBudgetRequest
            ) {
                updated.push(request);

                const index = store.findIndex(
                    budget =>
                        budget.id === request.id
                );

                if (index >= 0) {
                    store[index] = {
                        ...store[index],
                        ...request,
                    } as Budget;
                }
            },
            async delete() {},
        },
    });

    Object.defineProperty(
        service,
        "categoryRepository",
        {
            value: {
                async getById(id: string) {
                    return (
                        categoriesById.get(id) ??
                        null
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
                        currenciesById.get(id) ??
                        null
                    );
                },
            },
        }
    );

    Object.defineProperty(
        service,
        "businessEntityRepository",
        {
            value: {
                async getById(id: string) {
                    return (
                        entitiesById.get(id) ??
                        null
                    );
                },
            },
        }
    );

    return { service, created, updated, store };
}

describe("BudgetService.create - field validation", () => {
    it("rejects a missing name", async () => {
        const { service } = createService({});

        await expect(
            service.create(baseCreate({ name: "  " }))
        ).rejects.toThrow(/name is required/i);
    });

    it("rejects a negative amount", async () => {
        const { service } = createService({});

        await expect(
            service.create(baseCreate({ amount: -5 }))
        ).rejects.toThrow(/zero or more/i);
    });

    it("accepts a zero amount", async () => {
        const { service, created } = createService({});

        await service.create(baseCreate({ amount: 0 }));

        expect(created).toHaveLength(1);
        expect(created[0].amount).toBe(0);
    });

    it("rejects an end date before the start date", async () => {
        const { service } = createService({});

        await expect(
            service.create(
                baseCreate({
                    periodType: "CUSTOM",
                    startDate: "2026-09-15",
                    endDate: "2026-09-01",
                })
            )
        ).rejects.toThrow(/before the start date/i);
    });

    it("rejects a missing currency", async () => {
        const { service } = createService({});

        await expect(
            service.create(
                baseCreate({ currencyId: "" })
            )
        ).rejects.toThrow(/currency is required/i);
    });
});

describe("BudgetService.create - category validation", () => {
    it("accepts a valid active EXPENSE category", async () => {
        const { service, created } = createService({
            categories: [category()],
        });

        await service.create(baseCreate());

        expect(created[0].categoryId).toBe("cat-food");
    });

    it("accepts a null category (overall budget)", async () => {
        const { service, created } = createService({});

        await service.create(
            baseCreate({ categoryId: null })
        );

        expect(created[0].categoryId).toBeNull();
    });

    it("rejects an INCOME category", async () => {
        const { service } = createService({
            categories: [
                category({
                    id: "cat-salary",
                    categoryType: "INCOME",
                }),
            ],
        });

        await expect(
            service.create(
                baseCreate({ categoryId: "cat-salary" })
            )
        ).rejects.toThrow(/expense categories/i);
    });

    it("rejects an inactive EXPENSE category", async () => {
        const { service } = createService({
            categories: [
                category({ isActive: false }),
            ],
        });

        await expect(
            service.create(baseCreate())
        ).rejects.toThrow(/inactive/i);
    });

    it("rejects a category that no longer exists", async () => {
        const { service } = createService({
            categories: [],
        });

        await expect(
            service.create(baseCreate())
        ).rejects.toThrow(/no longer exists/i);
    });
});

describe("BudgetService.create - reference validation", () => {
    it("rejects a currency that does not resolve", async () => {
        const { service } = createService({
            currencies: [currency()], // only currency-inr
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

    it("accepts a supplied business entity that exists and is active", async () => {
        const { service, created } = createService({
            entities: [entity({ id: "entity-1" })],
        });

        await service.create(
            baseCreate({
                businessEntityId: "entity-1",
            })
        );

        expect(created[0].businessEntityId).toBe(
            "entity-1"
        );
    });

    it("rejects a supplied business entity that does not exist", async () => {
        const { service } = createService({
            entities: [],
        });

        await expect(
            service.create(
                baseCreate({
                    businessEntityId: "entity-gone",
                })
            )
        ).rejects.toThrow(
            /business entity no longer exists/i
        );
    });

    it("rejects a supplied business entity that is inactive", async () => {
        const { service } = createService({
            entities: [
                entity({
                    id: "entity-1",
                    isActive: false,
                }),
            ],
        });

        await expect(
            service.create(
                baseCreate({
                    businessEntityId: "entity-1",
                })
            )
        ).rejects.toThrow(/inactive/i);
    });

    it("accepts a null business entity without consulting the repository", async () => {
        const { service, created } = createService({
            entities: [],
        });

        await service.create(
            baseCreate({ businessEntityId: null })
        );

        expect(
            created[0].businessEntityId
        ).toBeNull();
    });
});

describe("BudgetService.create - duplicate detection", () => {
    it("rejects a duplicate active budget for the same category / month / currency / entity", async () => {
        const { service } = createService({
            budgets: [makeBudget()],
        });

        await expect(
            service.create(baseCreate())
        ).rejects.toThrow(/already exists/i);
    });

    it("allows the same category in a different currency", async () => {
        const { service, created } = createService({
            budgets: [
                makeBudget({ currencyId: "currency-inr" }),
            ],
        });

        await service.create(
            baseCreate({ currencyId: "currency-usd" })
        );

        expect(created).toHaveLength(1);
    });

    it("allows the same category for a different business entity", async () => {
        const { service, created } = createService({
            budgets: [
                makeBudget({ businessEntityId: null }),
            ],
            entities: [entity({ id: "entity-2" })],
        });

        await service.create(
            baseCreate({ businessEntityId: "entity-2" })
        );

        expect(created).toHaveLength(1);
    });

    it("allows the same category in a non-overlapping month range", async () => {
        const { service, created } = createService({
            budgets: [
                makeBudget({
                    periodType: "CUSTOM",
                    startDate: "2026-09-01",
                    endDate: "2026-09-30",
                }),
            ],
        });

        await service.create(
            baseCreate({
                periodType: "CUSTOM",
                startDate: "2026-10-01",
                endDate: "2026-10-31",
            })
        );

        expect(created).toHaveLength(1);
    });

    it("allows a second budget for the same category when the new one is inactive", async () => {
        const { service, created } = createService({
            budgets: [makeBudget()],
        });

        await service.create(
            baseCreate({ isActive: false })
        );

        expect(created).toHaveLength(1);
    });

    it("rejects a duplicate overall (null-category) budget", async () => {
        const { service } = createService({
            budgets: [
                makeBudget({
                    id: "overall-1",
                    categoryId: null,
                }),
            ],
        });

        await expect(
            service.create(
                baseCreate({ categoryId: null })
            )
        ).rejects.toThrow(/overall budget already exists/i);
    });
});

describe("BudgetService.update - identity & duplicates", () => {
    it("editing a budget without touching its identity succeeds", async () => {
        const { service, updated } = createService({
            budgets: [makeBudget({ id: "b-1" })],
        });

        await service.update({
            id: "b-1",
            name: "Renamed",
            categoryId: "cat-food",
            businessEntityId: null,
            amount: 15000,
            periodType: "MONTHLY",
            startDate: "2026-09-01",
            endDate: null,
            currencyId: "currency-inr",
            alertThreshold: 90,
            isActive: true,
        });

        expect(updated).toHaveLength(1);
        expect(updated[0].name).toBe("Renamed");
    });

    it("editing a budget so it duplicates another one fails", async () => {
        const { service } = createService({
            budgets: [
                makeBudget({ id: "b-food", categoryId: "cat-food" }),
                makeBudget({ id: "b-travel", categoryId: "cat-travel" }),
            ],
            categories: [
                category({ id: "cat-food" }),
                category({ id: "cat-travel", name: "Travel" }),
            ],
        });

        await expect(
            service.update({
                id: "b-travel",
                name: "Travel",
                categoryId: "cat-food", // collides with b-food
                businessEntityId: null,
                amount: 8000,
                periodType: "MONTHLY",
                startDate: "2026-09-01",
                endDate: null,
                currencyId: "currency-inr",
                alertThreshold: 80,
                isActive: true,
            })
        ).rejects.toThrow(/already exists/i);
    });

    it("throws when the budget being edited no longer exists", async () => {
        const { service } = createService({ budgets: [] });

        await expect(
            service.update({
                id: "missing",
                name: "x",
                categoryId: null,
                businessEntityId: null,
                amount: 1000,
                periodType: "MONTHLY",
                startDate: "2026-09-01",
                endDate: null,
                currencyId: "currency-inr",
                alertThreshold: 80,
                isActive: true,
            })
        ).rejects.toThrow(/no longer exists/i);
    });
});

describe("BudgetService.update - category integrity", () => {
    it("keeps an unchanged category even after it became inactive (historical budget preserved)", async () => {
        const { service, updated } = createService({
            budgets: [
                makeBudget({ id: "b-1", categoryId: "cat-food" }),
            ],
            categories: [
                category({ isActive: false }), // now inactive
            ],
        });

        await service.update({
            id: "b-1",
            name: "Still tracking",
            categoryId: "cat-food", // unchanged
            businessEntityId: null,
            amount: 12000,
            periodType: "MONTHLY",
            startDate: "2026-09-01",
            endDate: null,
            currencyId: "currency-inr",
            alertThreshold: 80,
            isActive: true,
        });

        expect(updated).toHaveLength(1);
    });

    it("keeps an unchanged category even after it was deleted", async () => {
        const { service, updated } = createService({
            budgets: [
                makeBudget({ id: "b-1", categoryId: "cat-gone" }),
            ],
            categories: [], // category no longer resolvable
        });

        await service.update({
            id: "b-1",
            name: "Historical",
            categoryId: "cat-gone", // unchanged
            businessEntityId: null,
            amount: 12000,
            periodType: "MONTHLY",
            startDate: "2026-09-01",
            endDate: null,
            currencyId: "currency-inr",
            alertThreshold: 80,
            isActive: true,
        });

        expect(updated).toHaveLength(1);
    });

    it("rejects changing the category to an inactive one", async () => {
        const { service } = createService({
            budgets: [
                makeBudget({ id: "b-1", categoryId: "cat-food" }),
            ],
            categories: [
                category({ id: "cat-food" }),
                category({
                    id: "cat-old",
                    name: "Old",
                    isActive: false,
                }),
            ],
        });

        await expect(
            service.update({
                id: "b-1",
                name: "Reassigned",
                categoryId: "cat-old", // changed to inactive
                businessEntityId: null,
                amount: 12000,
                periodType: "MONTHLY",
                startDate: "2026-09-01",
                endDate: null,
                currencyId: "currency-inr",
                alertThreshold: 80,
                isActive: true,
            })
        ).rejects.toThrow(/inactive/i);
    });
});

describe("BudgetService.update - reference integrity", () => {
    it("keeps an unchanged business entity even after it became inactive", async () => {
        const { service, updated } = createService({
            budgets: [
                makeBudget({
                    id: "b-1",
                    businessEntityId: "entity-1",
                }),
            ],
            entities: [
                entity({
                    id: "entity-1",
                    isActive: false,
                }), // now inactive
            ],
        });

        await service.update({
            id: "b-1",
            name: "Still scoped",
            categoryId: "cat-food", // unchanged
            businessEntityId: "entity-1", // unchanged
            amount: 12000,
            periodType: "MONTHLY",
            startDate: "2026-09-01",
            endDate: null,
            currencyId: "currency-inr",
            alertThreshold: 80,
            isActive: true,
        });

        expect(updated).toHaveLength(1);
    });

    it("rejects changing the business entity to an inactive one", async () => {
        const { service } = createService({
            budgets: [
                makeBudget({
                    id: "b-1",
                    businessEntityId: null,
                }),
            ],
            entities: [
                entity({
                    id: "entity-2",
                    isActive: false,
                }),
            ],
        });

        await expect(
            service.update({
                id: "b-1",
                name: "Rescoped",
                categoryId: "cat-food",
                businessEntityId: "entity-2", // changed to inactive
                amount: 12000,
                periodType: "MONTHLY",
                startDate: "2026-09-01",
                endDate: null,
                currencyId: "currency-inr",
                alertThreshold: 80,
                isActive: true,
            })
        ).rejects.toThrow(/inactive/i);
    });

    it("rejects changing the currency to one that does not resolve", async () => {
        const { service } = createService({
            budgets: [
                makeBudget({
                    id: "b-1",
                    currencyId: "currency-inr",
                }),
            ],
            currencies: [currency()], // only currency-inr
        });

        await expect(
            service.update({
                id: "b-1",
                name: "Recurrencied",
                categoryId: "cat-food",
                businessEntityId: null,
                amount: 12000,
                periodType: "MONTHLY",
                startDate: "2026-09-01",
                endDate: null,
                currencyId: "currency-gone", // changed, unresolvable
                alertThreshold: 80,
                isActive: true,
            })
        ).rejects.toThrow(/currency no longer exists/i);
    });
});
