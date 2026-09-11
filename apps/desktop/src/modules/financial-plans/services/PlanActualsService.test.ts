import { describe, expect, it, vi } from "vitest";

import type {
    FinancialPlan,
    FinancialPlanComponent,
} from "../types";

import { PlanActualsService } from "./PlanActualsService";

// Every repository / service PlanActualsService news up internally talks
// to a live Tauri SQLite connection, unavailable here. Following the
// FinancialPlanComponentService.test.ts pattern, each is replaced with
// an in-memory fake via Object.defineProperty.

function plan(
    over: Partial<FinancialPlan> = {}
): FinancialPlan {
    return {
        id: "plan-1",
        name: "Plan",
        planType: "ACCUMULATION",
        planCategory: "CORE_PERSONAL_FINANCE",
        planSubcategory: "SAVINGS",
        periodType: "MONTHLY",
        startDate: "2026-01-01",
        endDate: null,
        currencyId: "INR",
        targetAmount: 100000,
        goalId: null,
        notes: null,
        status: "ACTIVE",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...over,
    };
}

function component(
    over: Partial<FinancialPlanComponent>
): FinancialPlanComponent {
    return {
        id: "c-1",
        planId: "plan-1",
        componentType: "ACCOUNT",
        role: "ASSET",
        accountId: null,
        categoryId: null,
        investmentId: null,
        loanId: null,
        label: null,
        targetAmount: null,
        sortOrder: 0,
        isActive: true,
        notes: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...over,
    };
}

interface Fakes {
    plans?: FinancialPlan[];
    componentsByPlan?: Record<
        string,
        FinancialPlanComponent[]
    >;
    accounts?: Array<{
        id: string;
        name: string;
        type: string;
        currencyId: string;
        openingBalance: number;
    }>;
    categoriesById?: Record<
        string,
        { name: string; categoryType: string }
    >;
    investmentsById?: Record<string, unknown>;
    loansById?: Record<string, unknown>;
}

function build(fakes: Fakes) {
    const service = new PlanActualsService();

    const categoryGetById = vi.fn(
        async (id: string) =>
            fakes.categoriesById?.[id]
                ? {
                      id,
                      ...fakes.categoriesById[id],
                  }
                : null
    );
    const investmentGetById = vi.fn(
        async (id: string) =>
            fakes.investmentsById?.[id] ?? null
    );
    const investmentTxns = vi.fn(async () => []);
    const loanGetById = vi.fn(
        async (id: string) =>
            fakes.loansById?.[id] ?? null
    );
    const loanSchedule = vi.fn(async () => []);

    const set = (prop: string, value: unknown) =>
        Object.defineProperty(service, prop, {
            value,
        });

    set("planService", {
        getAll: async () => fakes.plans ?? [],
        getById: async (id: string) =>
            (fakes.plans ?? []).find(
                p => p.id === id
            ) ?? null,
    });
    set("componentRepository", {
        listByPlan: async (id: string) =>
            fakes.componentsByPlan?.[id] ?? [],
    });
    const transactionsGetAll = vi.fn(
        async () => []
    );
    const transfersGetAll = vi.fn(async () => []);
    const accountsGetAll = vi.fn(
        async () => fakes.accounts ?? []
    );

    set("transactionService", {
        getAll: transactionsGetAll,
    });
    set("transferRepository", {
        getAll: transfersGetAll,
    });
    set("accountService", {
        getAll: accountsGetAll,
    });
    set("emiScheduleService", {
        getInterestByTransactionId: async () =>
            new Map(),
    });
    set("categoryRepository", {
        getById: categoryGetById,
    });
    set("investmentRepository", {
        getById: investmentGetById,
    });
    set("investmentTransactionRepository", {
        getAllByInvestmentId: investmentTxns,
    });
    set("loanRepository", {
        getById: loanGetById,
    });
    set("loanScheduleRepository", {
        getAllByLoanId: loanSchedule,
    });

    return {
        service,
        spies: {
            categoryGetById,
            investmentGetById,
            investmentTxns,
            loanGetById,
            loanSchedule,
            transactionsGetAll,
            transfersGetAll,
            accountsGetAll,
        },
    };
}

describe("PlanActualsService", () => {
    it("returns [] and never throws when there are no plans", async () => {
        const { service } = build({ plans: [] });

        await expect(
            service.getAllPlanActuals("2026-09-15")
        ).resolves.toEqual([]);
    });

    it("fetches per-source data ONLY for referenced sources", async () => {
        const { service, spies } = build({
            plans: [plan()],
            componentsByPlan: {
                "plan-1": [
                    component({
                        id: "c-acc",
                        componentType: "ACCOUNT",
                        role: "ASSET",
                        accountId: "A1",
                    }),
                    component({
                        id: "c-cat",
                        componentType: "CATEGORY",
                        role: "SPENDING",
                        categoryId: "CAT1",
                    }),
                ],
            },
            accounts: [
                {
                    id: "A1",
                    name: "Savings",
                    type: "SAVINGS",
                    currencyId: "INR",
                    openingBalance: 1000,
                },
            ],
            categoriesById: {
                CAT1: {
                    name: "Groceries",
                    categoryType: "EXPENSE",
                },
            },
        });

        const results =
            await service.getAllPlanActuals(
                "2026-09-15"
            );

        expect(results).toHaveLength(1);
        expect(results[0].planId).toBe("plan-1");

        // only the referenced category was fetched
        expect(
            spies.categoryGetById
        ).toHaveBeenCalledTimes(1);
        expect(
            spies.categoryGetById
        ).toHaveBeenCalledWith("CAT1");

        // no investments / loans referenced -> not fetched
        expect(
            spies.investmentGetById
        ).not.toHaveBeenCalled();
        expect(
            spies.loanGetById
        ).not.toHaveBeenCalled();
    });

    it("getPlanActuals returns null for an unknown plan", async () => {
        const { service } = build({ plans: [] });

        await expect(
            service.getPlanActuals(
                "nope",
                "2026-09-15"
            )
        ).resolves.toBeNull();
    });

    it("getPlanActuals computes a single plan's actuals", async () => {
        const { service } = build({
            plans: [plan()],
            componentsByPlan: {
                "plan-1": [
                    component({
                        componentType: "ACCOUNT",
                        role: "ASSET",
                        accountId: "A1",
                    }),
                ],
            },
            accounts: [
                {
                    id: "A1",
                    name: "Savings",
                    type: "SAVINGS",
                    currencyId: "INR",
                    openingBalance: 42_000,
                },
            ],
        });

        const result =
            await service.getPlanActuals(
                "plan-1",
                "2026-09-15"
            );

        expect(
            result?.totals.positionValue
        ).toBe(42_000);
        expect(result?.status).toBe("COMPLETE");
    });

    it("getAllPlanActuals assembles the source ledger ONCE for the whole batch (Phase 7)", async () => {
        const { service, spies } = build({
            plans: [
                plan({ id: "plan-1" }),
                plan({ id: "plan-2" }),
                plan({ id: "plan-3" }),
            ],
            componentsByPlan: {
                "plan-1": [
                    component({
                        componentType: "ACCOUNT",
                        role: "ASSET",
                        accountId: "A1",
                    }),
                ],
                "plan-2": [
                    component({
                        componentType: "ACCOUNT",
                        role: "ASSET",
                        accountId: "A1",
                    }),
                ],
                "plan-3": [],
            },
            accounts: [
                {
                    id: "A1",
                    name: "Shared",
                    type: "SAVINGS",
                    currencyId: "INR",
                    openingBalance: 1000,
                },
            ],
        });

        const results =
            await service.getAllPlanActuals(
                "2026-09-15"
            );

        expect(results).toHaveLength(3);
        // one shared ledger, not one full fetch per plan/row
        expect(
            spies.transactionsGetAll
        ).toHaveBeenCalledTimes(1);
        expect(
            spies.transfersGetAll
        ).toHaveBeenCalledTimes(1);
        expect(
            spies.accountsGetAll
        ).toHaveBeenCalledTimes(1);
        expect(
            results.every(
                r => r.asOf === "2026-09-15"
            )
        ).toBe(true);
    });
});
