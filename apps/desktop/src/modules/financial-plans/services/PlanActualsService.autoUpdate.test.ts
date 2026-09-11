import { describe, expect, it } from "vitest";

import type {
    FinancialPlan,
    FinancialPlanComponent,
    PlanComponentRole,
    PlanComponentType,
} from "../types";

import { PlanActualsService } from "./PlanActualsService";

// =====================================================================
// Financial Plans - Phase 5: Automatic Updating
//
// A Financial Plan's actuals are never stored - PlanActualsService
// re-reads live source data and re-runs the pure engine on every call.
// These tests drive the service through a MUTABLE in-memory source store
// and assert that a second call reflects a change made after the first,
// exactly once, deterministically, and respecting the deleted /
// inactive / archived / matrix-incompatible rules from Phases 1-4.
// =====================================================================

const AS_OF = "2026-09-15";

// -------------------- mutable source store --------------------

interface StoreAccount {
    id: string;
    name: string;
    type: string;
    currencyId: string;
    openingBalance: number;
}
interface StoreTxn {
    id: string;
    type: string;
    amount: number;
    transactionDate: string;
    categoryId: string | null;
    accountId: string;
    cardReference: string | null;
}
interface StoreTransfer {
    sourceAccountId: string;
    destinationAccountId: string;
    amount: number;
    transactionDate: string;
    deletedAt: string | null;
}
interface StoreInvestment {
    name: string;
    currencyId: string;
    status: string;
    currentValue: number;
}
interface StoreInvTxn {
    transactionType: string;
    transactionDate: string;
    amount: number;
    fees: number;
    taxes: number;
}
interface StoreLoan {
    name: string;
    currencyId: string;
    status: string;
    outstandingPrincipal: number;
    outstandingInterest: number;
}
interface StoreSchedule {
    status: string;
    paidDate: string | null;
    principalAmount: number;
}

interface Store {
    plans: FinancialPlan[];
    componentsByPlan: Record<
        string,
        FinancialPlanComponent[]
    >;
    accounts: StoreAccount[];
    transactions: StoreTxn[];
    transfers: StoreTransfer[];
    emiInterest: Record<string, number>;
    categoriesById: Record<
        string,
        { name: string; categoryType: string }
    >;
    investmentsById: Record<string, StoreInvestment>;
    invTxnsById: Record<string, StoreInvTxn[]>;
    loansById: Record<string, StoreLoan>;
    schedulesById: Record<string, StoreSchedule[]>;
}

function emptyStore(): Store {
    return {
        plans: [],
        componentsByPlan: {},
        accounts: [],
        transactions: [],
        transfers: [],
        emiInterest: {},
        categoriesById: {},
        investmentsById: {},
        invTxnsById: {},
        loansById: {},
        schedulesById: {},
    };
}

function wire(store: Store): PlanActualsService {
    const service = new PlanActualsService();
    const set = (prop: string, value: unknown) =>
        Object.defineProperty(service, prop, {
            value,
        });

    set("planService", {
        getAll: async () => store.plans,
        getById: async (id: string) =>
            store.plans.find(p => p.id === id) ??
            null,
    });
    set("componentRepository", {
        listByPlan: async (id: string) =>
            store.componentsByPlan[id] ?? [],
    });
    set("transactionService", {
        getAll: async () => store.transactions,
    });
    set("transferRepository", {
        getAll: async () => store.transfers,
    });
    set("accountService", {
        getAll: async () => store.accounts,
    });
    set("emiScheduleService", {
        getInterestByTransactionId: async () =>
            new Map(
                Object.entries(store.emiInterest)
            ),
    });
    set("categoryRepository", {
        getById: async (id: string) =>
            store.categoriesById[id]
                ? {
                      id,
                      ...store.categoriesById[id],
                  }
                : null,
    });
    set("investmentRepository", {
        getById: async (id: string) =>
            store.investmentsById[id] ?? null,
    });
    set("investmentTransactionRepository", {
        getAllByInvestmentId: async (id: string) =>
            store.invTxnsById[id] ?? [],
    });
    set("loanRepository", {
        getById: async (id: string) =>
            store.loansById[id] ?? null,
    });
    set("loanScheduleRepository", {
        getAllByLoanId: async (id: string) =>
            store.schedulesById[id] ?? [],
    });

    return service;
}

// -------------------- factories --------------------

let seq = 0;

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
        targetAmount: 1_000_000,
        goalId: null,
        notes: null,
        status: "ACTIVE",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...over,
    };
}

function comp(
    componentType: PlanComponentType,
    role: PlanComponentRole,
    sourceId: string,
    over: Partial<FinancialPlanComponent> = {}
): FinancialPlanComponent {
    seq += 1;
    return {
        id: over.id ?? `c-${seq}`,
        planId: "plan-1",
        componentType,
        role,
        accountId:
            componentType === "ACCOUNT"
                ? sourceId
                : null,
        categoryId:
            componentType === "CATEGORY"
                ? sourceId
                : null,
        investmentId:
            componentType === "INVESTMENT"
                ? sourceId
                : null,
        loanId:
            componentType === "LOAN"
                ? sourceId
                : null,
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

function txn(
    over: Partial<StoreTxn> & {
        accountId: string;
        type: string;
        amount: number;
        transactionDate: string;
    }
): StoreTxn {
    seq += 1;
    return {
        id: over.id ?? `t-${seq}`,
        categoryId: null,
        cardReference: null,
        ...over,
    };
}

async function one(
    service: PlanActualsService,
    planId = "plan-1"
) {
    const result = await service.getPlanActuals(
        planId,
        AS_OF
    );
    if (!result) {
        throw new Error("expected a plan result");
    }
    return result;
}

// =====================================================
// Transactions
// =====================================================

describe("Phase 5 - transactions update automatically", () => {
    function setup() {
        const store = emptyStore();
        store.plans = [
            plan({
                planType: "EXPENSE_PLAN",
                periodType: "MONTHLY",
                targetAmount: 100_000,
            }),
        ];
        store.componentsByPlan["plan-1"] = [
            comp("CATEGORY", "SPENDING", "GRO"),
        ];
        store.accounts = [
            {
                id: "P1",
                name: "Checking",
                type: "CURRENT",
                currencyId: "INR",
                openingBalance: 0,
            },
        ];
        store.categoriesById["GRO"] = {
            name: "Groceries",
            categoryType: "EXPENSE",
        };
        store.transactions = [
            txn({
                accountId: "P1",
                type: "expense",
                amount: 5000,
                transactionDate: "2026-09-04",
                categoryId: "GRO",
            }),
        ];
        return { store, service: wire(store) };
    }

    it("a newly added expense appears on the next call", async () => {
        const { store, service } = setup();

        expect(
            (await one(service)).totals
                .currentPeriodOutflow
        ).toBe(5000);

        store.transactions.push(
            txn({
                accountId: "P1",
                type: "expense",
                amount: 3000,
                transactionDate: "2026-09-10",
                categoryId: "GRO",
            })
        );

        expect(
            (await one(service)).totals
                .currentPeriodOutflow
        ).toBe(8000);
    });

    it("editing a transaction amount is reflected on the next call", async () => {
        const { store, service } = setup();

        store.transactions[0].amount = 9000;

        expect(
            (await one(service)).totals
                .currentPeriodOutflow
        ).toBe(9000);
    });

    it("soft-deleting a transaction (removed by the repository) reduces the flow", async () => {
        const { store, service } = setup();

        store.transactions = [];

        expect(
            (await one(service)).totals
                .currentPeriodOutflow
        ).toBe(0);
    });
});

// =====================================================
// Transfers & account balances
// =====================================================

describe("Phase 5 - transfers and balances update automatically", () => {
    function setup() {
        const store = emptyStore();
        store.plans = [plan()];
        store.componentsByPlan["plan-1"] = [
            comp("ACCOUNT", "ASSET", "S1"),
        ];
        store.accounts = [
            {
                id: "S1",
                name: "Savings",
                type: "SAVINGS",
                currencyId: "INR",
                openingBalance: 100_000,
            },
        ];
        return { store, service: wire(store) };
    }

    it("a new incoming transfer raises the balance on the next call", async () => {
        const { store, service } = setup();

        expect(
            (await one(service)).totals.positionValue
        ).toBe(100_000);

        store.transfers.push({
            sourceAccountId: "X",
            destinationAccountId: "S1",
            amount: 25_000,
            transactionDate: "2026-09-01",
            deletedAt: null,
        });

        expect(
            (await one(service)).totals.positionValue
        ).toBe(125_000);
    });

    it("a soft-deleted transfer stops affecting the balance", async () => {
        const { store, service } = setup();
        store.transfers.push({
            sourceAccountId: "X",
            destinationAccountId: "S1",
            amount: 25_000,
            transactionDate: "2026-09-01",
            deletedAt: null,
        });

        expect(
            (await one(service)).totals.positionValue
        ).toBe(125_000);

        store.transfers[0].deletedAt =
            "2026-09-02T00:00:00.000Z";

        expect(
            (await one(service)).totals.positionValue
        ).toBe(100_000);
    });
});

// =====================================================
// Investments
// =====================================================

describe("Phase 5 - investments update automatically", () => {
    function setup(
        role: PlanComponentRole = "ASSET"
    ) {
        const store = emptyStore();
        store.plans = [
            plan({ planType: "PORTFOLIO_GROWTH" }),
        ];
        store.componentsByPlan["plan-1"] = [
            comp("INVESTMENT", role, "I1"),
        ];
        store.investmentsById["I1"] = {
            name: "Index Fund",
            currencyId: "INR",
            status: "ACTIVE",
            currentValue: 200_000,
        };
        store.invTxnsById["I1"] = [];
        return { store, service: wire(store) };
    }

    it("a new BUY trade raises INVESTMENT·CONTRIBUTION on the next call", async () => {
        const { store, service } =
            setup("CONTRIBUTION");

        expect(
            (await one(service)).components[0]
                .periodFlow
        ).toBe(0);

        store.invTxnsById["I1"].push({
            transactionType: "BUY",
            transactionDate: "2026-09-03",
            amount: 40_000,
            fees: 0,
            taxes: 0,
        });

        expect(
            (await one(service)).components[0]
                .periodFlow
        ).toBe(40_000);
    });

    it("a changed current_value raises INVESTMENT·ASSET on the next call", async () => {
        const { store, service } = setup("ASSET");

        expect(
            (await one(service)).totals.positionValue
        ).toBe(200_000);

        store.investmentsById["I1"].currentValue =
            260_000;

        expect(
            (await one(service)).totals.positionValue
        ).toBe(260_000);
    });

    it("closing an investment switches to terminal value + CONTAINS_CLOSED_SOURCE without going stale", async () => {
        const { store, service } = setup("ASSET");

        const before = await one(service);
        expect(
            before.warnings.map(w => w.code)
        ).not.toContain("CONTAINS_CLOSED_SOURCE");
        expect(
            before.components[0].sourceTerminal
        ).toBe(false);

        store.investmentsById["I1"].status =
            "CLOSED";

        const after = await one(service);
        expect(
            after.components[0].sourceTerminal
        ).toBe(true);
        expect(
            after.warnings.map(w => w.code)
        ).toContain("CONTAINS_CLOSED_SOURCE");
        expect(
            after.totals.positionValue
        ).toBe(200_000);
        expect(after.status).toBe("COMPLETE");
    });
});

// =====================================================
// Loans
// =====================================================

describe("Phase 5 - loans update automatically", () => {
    function setup(
        role: PlanComponentRole
    ) {
        const store = emptyStore();
        store.plans = [
            plan({
                planType: "DEBT_PAYOFF",
                targetAmount: null,
            }),
        ];
        store.componentsByPlan["plan-1"] = [
            comp("LOAN", role, "L1"),
        ];
        store.loansById["L1"] = {
            name: "Car Loan",
            currencyId: "INR",
            status: "ACTIVE",
            outstandingPrincipal: 380_000,
            outstandingInterest: 20_000,
        };
        store.schedulesById["L1"] = [];
        return { store, service: wire(store) };
    }

    it("a new PAID instalment raises LOAN·CONTRIBUTION on the next call", async () => {
        const { store, service } =
            setup("CONTRIBUTION");

        store.schedulesById["L1"] = [
            {
                status: "PAID",
                paidDate: "2026-08-05",
                principalAmount: 8000,
            },
        ];

        const first = await one(service);
        expect(first.components[0].periodFlow).toBe(
            0
        );
        expect(
            first.components[0].lifetimeFlow
        ).toBe(8000);

        store.schedulesById["L1"].push({
            status: "PAID",
            paidDate: "2026-09-05",
            principalAmount: 8400,
        });

        const second = await one(service);
        expect(
            second.components[0].periodFlow
        ).toBe(8400);
        expect(
            second.components[0].lifetimeFlow
        ).toBe(16_400);
    });

    it("a changed outstanding_principal is reflected on the next call", async () => {
        const { store, service } =
            setup("LIABILITY");

        expect(
            (await one(service)).totals.positionValue
        ).toBe(380_000);

        store.loansById["L1"].outstandingPrincipal =
            350_000;

        expect(
            (await one(service)).totals.positionValue
        ).toBe(350_000);
    });
});

// =====================================================
// Components: add / remove / deactivate / incompatible
// =====================================================

describe("Phase 5 - component changes update automatically", () => {
    function setup() {
        const store = emptyStore();
        store.plans = [plan()];
        store.componentsByPlan["plan-1"] = [
            comp("ACCOUNT", "ASSET", "S1", {
                id: "c-acc",
            }),
        ];
        store.accounts = [
            {
                id: "S1",
                name: "Savings",
                type: "SAVINGS",
                currencyId: "INR",
                openingBalance: 100_000,
            },
        ];
        store.investmentsById["I1"] = {
            name: "Fund",
            currencyId: "INR",
            status: "ACTIVE",
            currentValue: 50_000,
        };
        return { store, service: wire(store) };
    }

    it("adding a component to the plan includes it on the next call", async () => {
        const { store, service } = setup();

        expect(
            (await one(service)).totals.positionValue
        ).toBe(100_000);

        store.componentsByPlan["plan-1"].push(
            comp("INVESTMENT", "ASSET", "I1", {
                id: "c-inv",
            })
        );

        expect(
            (await one(service)).totals.positionValue
        ).toBe(150_000);
    });

    it("removing (soft-deleting) a component excludes it on the next call", async () => {
        const { store, service } = setup();
        store.componentsByPlan["plan-1"].push(
            comp("INVESTMENT", "ASSET", "I1", {
                id: "c-inv",
            })
        );
        expect(
            (await one(service)).totals.positionValue
        ).toBe(150_000);

        store.componentsByPlan["plan-1"] =
            store.componentsByPlan["plan-1"].filter(
                c => c.id !== "c-inv"
            );

        expect(
            (await one(service)).totals.positionValue
        ).toBe(100_000);
    });

    it("deactivating a component drops it from totals but keeps the plan COMPLETE", async () => {
        const { store, service } = setup();
        store.componentsByPlan["plan-1"].push(
            comp("INVESTMENT", "ASSET", "I1", {
                id: "c-inv",
            })
        );
        expect(
            (await one(service)).totals.positionValue
        ).toBe(150_000);

        store.componentsByPlan["plan-1"].find(
            c => c.id === "c-inv"
        )!.isActive = false;

        const after = await one(service);
        expect(after.totals.positionValue).toBe(
            100_000
        );
        expect(after.status).toBe("COMPLETE");
        expect(
            after.warnings.map(w => w.code)
        ).toContain("COMPONENT_INACTIVE_EXCLUDED");
    });

    it("a soft-deleted source makes its component unavailable on the next call - never a stale value", async () => {
        const { store, service } = setup();

        expect(
            (await one(service)).totals.positionValue
        ).toBe(100_000);

        // S1 soft-deleted -> AccountRepository.getAll excludes it
        store.accounts = [];

        const after = await one(service);
        expect(after.components[0]).toMatchObject({
            available: false,
            unavailableReason: "SOURCE_MISSING",
            positionValue: null,
        });
        expect(after.totals.positionValue).toBeNull();
        expect(after.status).toBe("INCOMPLETE");
    });

    it("a plan_type change that orphans a component (direct DB write bypassing the block) is caught by the engine guard", async () => {
        const { store, service } = setup();

        expect(
            (await one(service)).totals.positionValue
        ).toBe(100_000);

        // Simulate a write that bypassed FinancialPlanService.update:
        // ACCUMULATION -> DEBT_PAYOFF, leaving an ACCOUNT·ASSET component.
        store.plans[0].planType = "DEBT_PAYOFF";

        const after = await one(service);
        expect(after.components[0]).toMatchObject({
            available: false,
            unavailableReason:
                "INCOMPATIBLE_WITH_PLAN_TYPE",
        });
        expect(
            after.warnings.map(w => w.code)
        ).toContain("COMPONENT_NOT_IN_PLAN_MATRIX");
        expect(after.totals.positionValue).toBeNull();
        expect(after.status).toBe("INCOMPLETE");
    });
});

// =====================================================
// Plan lifecycle: archived / determinism / no-duplication
// =====================================================

describe("Phase 5 - determinism, no duplication, archived plans", () => {
    function setup() {
        const store = emptyStore();
        store.plans = [plan()];
        store.componentsByPlan["plan-1"] = [
            comp("ACCOUNT", "ASSET", "S1"),
        ];
        store.accounts = [
            {
                id: "S1",
                name: "Savings",
                type: "SAVINGS",
                currencyId: "INR",
                openingBalance: 100_000,
            },
        ];
        store.transactions = [
            txn({
                accountId: "S1",
                type: "income",
                amount: 20_000,
                transactionDate: "2026-09-03",
            }),
        ];
        return { store, service: wire(store) };
    }

    it("archiving a plan does not stop automatic computation (locked behaviour) and does not change the totals", async () => {
        const { store, service } = setup();

        const before = await one(service);
        expect(before.totals.positionValue).toBe(
            120_000
        );

        store.plans[0].status = "ARCHIVED";

        const after = await one(service);
        expect(after.totals).toEqual(before.totals);
        expect(after.status).toBe("COMPLETE");
    });

    it("two consecutive calls with no change produce a deep-equal result (deterministic, no accumulation)", async () => {
        const { service } = setup();

        const a = await one(service);
        const b = await one(service);

        expect(b).toEqual(a);
    });

    it("getAllPlanActuals stamps one asOf across every plan in the batch", async () => {
        const store = emptyStore();
        store.plans = [
            plan({ id: "plan-1" }),
            plan({ id: "plan-2" }),
        ];
        const service = wire(store);

        const results =
            await service.getAllPlanActuals(AS_OF);

        expect(results).toHaveLength(2);
        expect(
            results.every(r => r.asOf === AS_OF)
        ).toBe(true);
    });

    it("a shared source change flows to every plan that references it", async () => {
        const store = emptyStore();
        store.plans = [
            plan({ id: "plan-1" }),
            plan({ id: "plan-2" }),
        ];
        store.componentsByPlan = {
            "plan-1": [
                {
                    ...comp("ACCOUNT", "ASSET", "S1"),
                    planId: "plan-1",
                },
            ],
            "plan-2": [
                {
                    ...comp("ACCOUNT", "ASSET", "S1"),
                    planId: "plan-2",
                },
            ],
        };
        store.accounts = [
            {
                id: "S1",
                name: "Shared",
                type: "SAVINGS",
                currencyId: "INR",
                openingBalance: 10_000,
            },
        ];
        const service = wire(store);

        let results =
            await service.getAllPlanActuals(AS_OF);
        expect(
            results.map(r => r.totals.positionValue)
        ).toEqual([10_000, 10_000]);

        store.accounts[0].openingBalance = 45_000;

        results =
            await service.getAllPlanActuals(AS_OF);
        expect(
            results.map(r => r.totals.positionValue)
        ).toEqual([45_000, 45_000]);
    });
});
