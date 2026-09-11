import { describe, expect, it } from "vitest";

import type { FinancialGoal } from "../types/FinancialGoal";
import type { GoalAccountLink } from "../types/GoalAccountLink";
import type { GoalCategoryLink } from "../types/GoalCategoryLink";
import type { GoalLoanLink } from "../types/GoalLoanLink";
import type { GoalInvestmentLink } from "../types/GoalInvestmentLink";

import { GoalActualsService } from "./GoalActualsService";

// =====================================================================
// Financial Goals - Automatic Updating (Phases 1-5)
//
// A linked goal's current amount is never stored - GoalActualsService
// re-reads live accounts / categories / loans / investments /
// transactions / transfers and re-runs the pure engine on every call.
// These tests drive the service through a MUTABLE in-memory source
// store and assert that a second call reflects a change made after the
// first, exactly once, deterministically.
// =====================================================================

interface StoreAccount {
    id: string;
    name: string;
    type: string;
    currencyId: string;
    isActive: boolean;
    openingBalance: number;
}
interface StoreTxn {
    id: string;
    accountId: string;
    categoryId?: string | null;
    type: "income" | "expense" | "transfer";
    amount: number;
    transactionDate: string;
}
interface StoreTransfer {
    sourceAccountId: string;
    destinationAccountId: string;
    amount: number;
    transactionDate: string;
    deletedAt: string | null;
}
interface StoreCategory {
    id: string;
    name: string;
    categoryType: string;
    isActive: boolean;
}
interface StoreLoan {
    id: string;
    name: string;
    currencyId: string;
    status: string;
    outstandingPrincipal: number;
}
interface StoreInvestment {
    id: string;
    name: string;
    currencyId: string;
    status: string;
    currentValue: number;
}

class Store {
    goals: FinancialGoal[] = [];
    links: GoalAccountLink[] = [];
    categoryLinks: GoalCategoryLink[] = [];
    loanLinks: GoalLoanLink[] = [];
    investmentLinks: GoalInvestmentLink[] = [];
    accounts: StoreAccount[] = [];
    categories: StoreCategory[] = [];
    loans: StoreLoan[] = [];
    investments: StoreInvestment[] = [];
    transactions: StoreTxn[] = [];
    transfers: StoreTransfer[] = [];

    buildService(): GoalActualsService {
        const service = new GoalActualsService();

        const set = (
            prop: string,
            value: unknown
        ) =>
            Object.defineProperty(service, prop, {
                value,
            });

        set("goalRepository", {
            getAll: async () => this.goals,
            getById: async (id: string) =>
                this.goals.find(g => g.id === id) ??
                null,
        });
        set("accountLinkRepository", {
            listByGoal: async (goalId: string) =>
                this.links.filter(
                    l => l.goalId === goalId
                ),
            listByGoals: async (
                goalIds: string[]
            ) =>
                this.links.filter(l =>
                    goalIds.includes(l.goalId)
                ),
        });
        set("categoryLinkRepository", {
            listByGoal: async (goalId: string) =>
                this.categoryLinks.filter(
                    l => l.goalId === goalId
                ),
            listByGoals: async (
                goalIds: string[]
            ) =>
                this.categoryLinks.filter(l =>
                    goalIds.includes(l.goalId)
                ),
        });
        set("loanLinkRepository", {
            listByGoal: async (goalId: string) =>
                this.loanLinks.filter(
                    l => l.goalId === goalId
                ),
            listByGoals: async (
                goalIds: string[]
            ) =>
                this.loanLinks.filter(l =>
                    goalIds.includes(l.goalId)
                ),
        });
        set("investmentLinkRepository", {
            listByGoal: async (goalId: string) =>
                this.investmentLinks.filter(
                    l => l.goalId === goalId
                ),
            listByGoals: async (
                goalIds: string[]
            ) =>
                this.investmentLinks.filter(l =>
                    goalIds.includes(l.goalId)
                ),
        });
        set("transactionService", {
            getAll: async () => this.transactions,
        });
        set("transferRepository", {
            getAll: async () => this.transfers,
        });
        set("accountService", {
            getAll: async () => this.accounts,
        });
        set("categoryService", {
            getById: async (id: string) =>
                this.categories.find(
                    c => c.id === id
                ) ?? null,
        });
        set("loanService", {
            getById: async (id: string) =>
                this.loans.find(l => l.id === id) ??
                null,
        });
        set("investmentService", {
            getById: async (id: string) =>
                this.investments.find(
                    i => i.id === id
                ) ?? null,
        });

        return service;
    }
}

function goal(
    over: Partial<FinancialGoal> = {}
): FinancialGoal {
    return {
        id: "goal-1",
        name: "Emergency Fund",
        goalType: "EMERGENCY_FUND",
        goalCategory: "CORE_PERSONAL_FINANCE",
        goalSubcategory: "EMERGENCY_FUND",
        goalMode: "ACCOUNT_LINKED",
        targetAmount: 100_000,
        currentAmount: 0,
        currencyId: "INR",
        targetDate: null,
        priority: 0,
        status: "ACTIVE",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...over,
    };
}

function link(
    over: Partial<GoalAccountLink> = {}
): GoalAccountLink {
    return {
        id: "link-1",
        goalId: "goal-1",
        accountId: "acc-1",
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...over,
    };
}

function baseStore(): Store {
    const store = new Store();
    store.goals = [goal()];
    store.links = [link()];
    store.accounts = [
        {
            id: "acc-1",
            name: "Savings",
            type: "SAVINGS",
            currencyId: "INR",
            isActive: true,
            openingBalance: 10_000,
        },
    ];
    return store;
}

describe("GoalActualsService - automatic updating", () => {
    it("reflects a transaction added after the first read", async () => {
        const store = baseStore();
        const service = store.buildService();

        const before = await service.getGoalActuals(
            "goal-1"
        );
        expect(before?.totals.currentAmount).toBe(
            10_000
        );

        store.transactions.push({
            id: "t-1",
            accountId: "acc-1",
            type: "income",
            amount: 4_000,
            transactionDate: "2026-02-01",
        });

        const after = await service.getGoalActuals(
            "goal-1"
        );
        expect(after?.totals.currentAmount).toBe(
            14_000
        );
    });

    it("reflects a transaction edit (amount changed in place)", async () => {
        const store = baseStore();
        store.transactions.push({
            id: "t-1",
            accountId: "acc-1",
            type: "expense",
            amount: 1_000,
            transactionDate: "2026-02-01",
        });
        const service = store.buildService();

        const before = await service.getGoalActuals(
            "goal-1"
        );
        expect(before?.totals.currentAmount).toBe(
            9_000
        );

        store.transactions[0].amount = 2_500;

        const after = await service.getGoalActuals(
            "goal-1"
        );
        expect(after?.totals.currentAmount).toBe(
            7_500
        );
    });

    it("reflects a transaction deletion", async () => {
        const store = baseStore();
        store.transactions.push({
            id: "t-1",
            accountId: "acc-1",
            type: "income",
            amount: 5_000,
            transactionDate: "2026-02-01",
        });
        const service = store.buildService();

        const before = await service.getGoalActuals(
            "goal-1"
        );
        expect(before?.totals.currentAmount).toBe(
            15_000
        );

        store.transactions = [];

        const after = await service.getGoalActuals(
            "goal-1"
        );
        expect(after?.totals.currentAmount).toBe(
            10_000
        );
    });

    it("reflects a transfer added after the first read", async () => {
        const store = baseStore();
        store.accounts.push({
            id: "acc-2",
            name: "Other",
            type: "CASH",
            currencyId: "INR",
            isActive: true,
            openingBalance: 0,
        });
        const service = store.buildService();

        const before = await service.getGoalActuals(
            "goal-1"
        );
        expect(before?.totals.currentAmount).toBe(
            10_000
        );

        store.transfers.push({
            sourceAccountId: "acc-2",
            destinationAccountId: "acc-1",
            amount: 3_000,
            transactionDate: "2026-02-01",
            deletedAt: null,
        });

        const after = await service.getGoalActuals(
            "goal-1"
        );
        expect(after?.totals.currentAmount).toBe(
            13_000
        );
    });

    it("reflects an account opening-balance change", async () => {
        const store = baseStore();
        const service = store.buildService();

        const before = await service.getGoalActuals(
            "goal-1"
        );
        expect(before?.totals.currentAmount).toBe(
            10_000
        );

        store.accounts[0].openingBalance = 50_000;

        const after = await service.getGoalActuals(
            "goal-1"
        );
        expect(after?.totals.currentAmount).toBe(
            50_000
        );
    });

    it("reflects linking a new account to the goal", async () => {
        const store = baseStore();
        store.accounts.push({
            id: "acc-2",
            name: "Cash",
            type: "CASH",
            currencyId: "INR",
            isActive: true,
            openingBalance: 2_000,
        });
        const service = store.buildService();

        const before = await service.getGoalActuals(
            "goal-1"
        );
        expect(before?.totals.currentAmount).toBe(
            10_000
        );

        store.links.push(
            link({
                id: "link-2",
                accountId: "acc-2",
            })
        );

        const after = await service.getGoalActuals(
            "goal-1"
        );
        expect(after?.totals.currentAmount).toBe(
            12_000
        );
    });

    it("reflects unlinking (soft-removing) an account from the goal", async () => {
        const store = baseStore();
        store.accounts.push({
            id: "acc-2",
            name: "Cash",
            type: "CASH",
            currencyId: "INR",
            isActive: true,
            openingBalance: 2_000,
        });
        store.links.push(
            link({ id: "link-2", accountId: "acc-2" })
        );
        const service = store.buildService();

        const before = await service.getGoalActuals(
            "goal-1"
        );
        expect(before?.totals.currentAmount).toBe(
            12_000
        );

        // Soft-delete = removed from the store's active link list.
        store.links = store.links.filter(
            l => l.id !== "link-2"
        );

        const after = await service.getGoalActuals(
            "goal-1"
        );
        expect(after?.totals.currentAmount).toBe(
            10_000
        );
    });

    it("is deterministic: two calls over unchanged data return a deep-equal result", async () => {
        const store = baseStore();
        store.transactions.push({
            id: "t-1",
            accountId: "acc-1",
            type: "income",
            amount: 1_234,
            transactionDate: "2026-02-01",
        });
        const service = store.buildService();

        const first = await service.getGoalActuals(
            "goal-1"
        );
        const second = await service.getGoalActuals(
            "goal-1"
        );

        expect(first).toEqual(second);
    });

    it("does not duplicate or accumulate across repeated calls", async () => {
        const store = baseStore();
        const service = store.buildService();

        await service.getGoalActuals("goal-1");
        await service.getGoalActuals("goal-1");
        const third = await service.getGoalActuals(
            "goal-1"
        );

        expect(third?.totals.currentAmount).toBe(
            10_000
        );
    });
});

// =====================================================================
// Phase 2 - DEBT_PAYOFF_LINKED automatic updating
// =====================================================================

function debtGoal(
    over: Partial<FinancialGoal> = {}
): FinancialGoal {
    return goal({
        id: "debt-goal-1",
        goalMode: "DEBT_PAYOFF_LINKED",
        ...over,
    });
}

function debtLink(
    over: Partial<GoalAccountLink> = {}
): GoalAccountLink {
    return link({
        id: "debt-link-1",
        goalId: "debt-goal-1",
        accountId: "cc-1",
        ...over,
    });
}

function debtStore(): Store {
    const store = new Store();
    store.goals = [debtGoal()];
    store.links = [debtLink()];
    store.accounts = [
        {
            id: "cc-1",
            name: "Credit Card",
            type: "CREDIT_CARD",
            currencyId: "INR",
            isActive: true,
            openingBalance: -50_000,
        },
    ];
    return store;
}

describe("GoalActualsService - DEBT_PAYOFF_LINKED automatic updating", () => {
    it("reflects a new charge (expense) increasing debt", async () => {
        const store = debtStore();
        const service = store.buildService();

        const before = await service.getGoalActuals(
            "debt-goal-1"
        );
        expect(
            before?.totals.outstandingDebt
        ).toBe(50_000);

        store.transactions.push({
            id: "t-1",
            accountId: "cc-1",
            type: "expense",
            amount: 8_000,
            transactionDate: "2026-03-01",
        });

        const after = await service.getGoalActuals(
            "debt-goal-1"
        );
        expect(
            after?.totals.outstandingDebt
        ).toBe(58_000);
        expect(
            after!.totals.progressPercentage
        ).toBeLessThan(
            before!.totals.progressPercentage
        );
    });

    it("reflects a payment (income) decreasing debt", async () => {
        const store = debtStore();
        store.transactions.push({
            id: "t-1",
            accountId: "cc-1",
            type: "income",
            amount: 10_000,
            transactionDate: "2026-03-01",
        });
        const service = store.buildService();

        const before = await service.getGoalActuals(
            "debt-goal-1"
        );
        expect(
            before?.totals.outstandingDebt
        ).toBe(40_000);

        store.transactions[0].amount = 25_000;

        const after = await service.getGoalActuals(
            "debt-goal-1"
        );
        expect(
            after?.totals.outstandingDebt
        ).toBe(25_000);
        expect(
            after!.totals.progressPercentage
        ).toBeGreaterThan(
            before!.totals.progressPercentage
        );
    });

    it("reflects deleting a payment transaction (debt returns to prior level)", async () => {
        const store = debtStore();
        store.transactions.push({
            id: "t-1",
            accountId: "cc-1",
            type: "income",
            amount: 20_000,
            transactionDate: "2026-03-01",
        });
        const service = store.buildService();

        const before = await service.getGoalActuals(
            "debt-goal-1"
        );
        expect(
            before?.totals.outstandingDebt
        ).toBe(30_000);

        store.transactions = [];

        const after = await service.getGoalActuals(
            "debt-goal-1"
        );
        expect(
            after?.totals.outstandingDebt
        ).toBe(50_000);
    });

    it("reflects a transfer payment from another account", async () => {
        const store = debtStore();
        const service = store.buildService();

        const before = await service.getGoalActuals(
            "debt-goal-1"
        );
        expect(
            before?.totals.outstandingDebt
        ).toBe(50_000);

        store.transfers.push({
            sourceAccountId: "bank-1",
            destinationAccountId: "cc-1",
            amount: 15_000,
            transactionDate: "2026-03-01",
            deletedAt: null,
        });

        const after = await service.getGoalActuals(
            "debt-goal-1"
        );
        expect(
            after?.totals.outstandingDebt
        ).toBe(35_000);
    });

    it("reflects an account opening-balance change", async () => {
        const store = debtStore();
        const service = store.buildService();

        const before = await service.getGoalActuals(
            "debt-goal-1"
        );
        expect(
            before?.totals.outstandingDebt
        ).toBe(50_000);

        store.accounts[0].openingBalance = -80_000;

        const after = await service.getGoalActuals(
            "debt-goal-1"
        );
        expect(
            after?.totals.outstandingDebt
        ).toBe(80_000);
    });

    it("reflects linking a second liability account", async () => {
        const store = debtStore();
        store.accounts.push({
            id: "cc-2",
            name: "Second Card",
            type: "CREDIT_CARD",
            currencyId: "INR",
            isActive: true,
            openingBalance: -10_000,
        });
        const service = store.buildService();

        const before = await service.getGoalActuals(
            "debt-goal-1"
        );
        expect(
            before?.totals.outstandingDebt
        ).toBe(50_000);

        store.links.push(
            debtLink({
                id: "debt-link-2",
                accountId: "cc-2",
            })
        );

        const after = await service.getGoalActuals(
            "debt-goal-1"
        );
        expect(
            after?.totals.outstandingDebt
        ).toBe(60_000);
    });

    it("reflects unlinking a liability account", async () => {
        const store = debtStore();
        store.accounts.push({
            id: "cc-2",
            name: "Second Card",
            type: "CREDIT_CARD",
            currencyId: "INR",
            isActive: true,
            openingBalance: -10_000,
        });
        store.links.push(
            debtLink({
                id: "debt-link-2",
                accountId: "cc-2",
            })
        );
        const service = store.buildService();

        const before = await service.getGoalActuals(
            "debt-goal-1"
        );
        expect(
            before?.totals.outstandingDebt
        ).toBe(60_000);

        store.links = store.links.filter(
            l => l.id !== "debt-link-2"
        );

        const after = await service.getGoalActuals(
            "debt-goal-1"
        );
        expect(
            after?.totals.outstandingDebt
        ).toBe(50_000);
    });

    it("does not affect a manual or savings-linked goal (mode isolation)", async () => {
        const store = debtStore();
        store.goals.push(goal({ id: "goal-1" }));
        store.links.push(link({ id: "link-1" }));
        store.accounts.push({
            id: "acc-1",
            name: "Savings",
            type: "SAVINGS",
            currencyId: "INR",
            isActive: true,
            openingBalance: 10_000,
        });
        const service = store.buildService();

        store.transactions.push({
            id: "t-1",
            accountId: "cc-1",
            type: "expense",
            amount: 5_000,
            transactionDate: "2026-03-01",
        });

        const savingsResult =
            await service.getGoalActuals("goal-1");
        expect(
            savingsResult?.totals.currentAmount
        ).toBe(10_000);
    });

    it("is deterministic across repeated calls with unchanged data", async () => {
        const store = debtStore();
        const service = store.buildService();

        const first = await service.getGoalActuals(
            "debt-goal-1"
        );
        const second = await service.getGoalActuals(
            "debt-goal-1"
        );

        expect(first).toEqual(second);
    });
});

// =====================================================================
// Phase 3 - CATEGORY_CONTRIBUTION_LINKED automatic updating
// =====================================================================

function contributionGoal(
    over: Partial<FinancialGoal> = {}
): FinancialGoal {
    return goal({
        id: "contrib-goal-1",
        goalMode: "CATEGORY_CONTRIBUTION_LINKED",
        // Safely in the past regardless of when this test runs, so
        // the contribution window (createdAt -> today) always covers
        // the fixture transaction dates below.
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-01T00:00:00.000Z",
        targetDate: null,
        ...over,
    });
}

function categoryLink(
    over: Partial<GoalCategoryLink> = {}
): GoalCategoryLink {
    return {
        id: "clink-1",
        goalId: "contrib-goal-1",
        categoryId: "cat-1",
        isActive: true,
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-01T00:00:00.000Z",
        ...over,
    };
}

function contributionStore(): Store {
    const store = new Store();
    store.goals = [contributionGoal()];
    store.categoryLinks = [categoryLink()];
    store.categories = [
        {
            id: "cat-1",
            name: "Freelance Income",
            categoryType: "INCOME",
            isActive: true,
        },
    ];
    store.accounts = [
        {
            id: "acc-1",
            name: "Bank",
            type: "CURRENT",
            currencyId: "INR",
            isActive: true,
            openingBalance: 0,
        },
    ];
    return store;
}

describe("GoalActualsService - CATEGORY_CONTRIBUTION_LINKED automatic updating", () => {
    it("reflects an income transaction added after the first read", async () => {
        const store = contributionStore();
        const service = store.buildService();

        const before = await service.getGoalActuals(
            "contrib-goal-1"
        );
        expect(before?.totals.currentAmount).toBe(
            0
        );

        store.transactions.push({
            id: "t-1",
            accountId: "acc-1",
            categoryId: "cat-1",
            type: "income",
            amount: 15_000,
            transactionDate: "2020-06-01",
        });

        const after = await service.getGoalActuals(
            "contrib-goal-1"
        );
        expect(after?.totals.currentAmount).toBe(
            15_000
        );
    });

    it("reflects linking a second income category", async () => {
        const store = contributionStore();
        store.categories.push({
            id: "cat-2",
            name: "Consulting Income",
            categoryType: "INCOME",
            isActive: true,
        });
        store.transactions.push(
            {
                id: "t-1",
                accountId: "acc-1",
                categoryId: "cat-1",
                type: "income",
                amount: 10_000,
                transactionDate: "2020-06-01",
            },
            {
                id: "t-2",
                accountId: "acc-1",
                categoryId: "cat-2",
                type: "income",
                amount: 6_000,
                transactionDate: "2020-06-02",
            }
        );
        const service = store.buildService();

        const before = await service.getGoalActuals(
            "contrib-goal-1"
        );
        expect(before?.totals.currentAmount).toBe(
            10_000
        );

        store.categoryLinks.push(
            categoryLink({
                id: "clink-2",
                categoryId: "cat-2",
            })
        );

        const after = await service.getGoalActuals(
            "contrib-goal-1"
        );
        expect(after?.totals.currentAmount).toBe(
            16_000
        );
    });

    it("reflects a category being deactivated (excluded, with a warning)", async () => {
        const store = contributionStore();
        store.transactions.push({
            id: "t-1",
            accountId: "acc-1",
            categoryId: "cat-1",
            type: "income",
            amount: 10_000,
            transactionDate: "2020-06-01",
        });
        const service = store.buildService();

        const before = await service.getGoalActuals(
            "contrib-goal-1"
        );
        expect(before?.totals.currentAmount).toBe(
            10_000
        );

        store.categories[0].isActive = false;

        const after = await service.getGoalActuals(
            "contrib-goal-1"
        );
        expect(after?.totals.currentAmount).toBe(0);
        expect(after?.warnings).toHaveLength(1);
    });

    it("does not affect an account-linked goal (mode isolation)", async () => {
        const store = contributionStore();
        store.goals.push(goal({ id: "goal-1" }));
        store.links.push({
            id: "link-1",
            goalId: "goal-1",
            accountId: "acc-1",
            isActive: true,
            createdAt: "2020-01-01T00:00:00.000Z",
            updatedAt: "2020-01-01T00:00:00.000Z",
        });
        const service = store.buildService();

        store.transactions.push({
            id: "t-1",
            accountId: "acc-1",
            categoryId: "cat-1",
            type: "income",
            amount: 10_000,
            transactionDate: "2020-06-01",
        });

        const accountResult =
            await service.getGoalActuals("goal-1");
        // The account balance sums ALL income/expense transactions on
        // that account regardless of category, so this asserts the
        // savings goal is unaffected by the category link/window logic
        // specifically - not that it ignores the transaction.
        expect(
            accountResult?.totals.currentAmount
        ).toBe(10_000);
    });

    it("is deterministic across repeated calls with unchanged data", async () => {
        const store = contributionStore();
        store.transactions.push({
            id: "t-1",
            accountId: "acc-1",
            categoryId: "cat-1",
            type: "income",
            amount: 7_500,
            transactionDate: "2020-06-01",
        });
        const service = store.buildService();

        const first = await service.getGoalActuals(
            "contrib-goal-1"
        );
        const second = await service.getGoalActuals(
            "contrib-goal-1"
        );

        expect(first).toEqual(second);
    });
});

// =====================================================================
// Phase 4 - LOAN_PAYOFF_LINKED automatic updating
// =====================================================================

function loanPayoffGoal(
    over: Partial<FinancialGoal> = {}
): FinancialGoal {
    return goal({
        id: "loan-goal-1",
        goalMode: "LOAN_PAYOFF_LINKED",
        ...over,
    });
}

function loanLink(
    over: Partial<GoalLoanLink> = {}
): GoalLoanLink {
    return {
        id: "llink-1",
        goalId: "loan-goal-1",
        loanId: "loan-1",
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...over,
    };
}

function loanAutoUpdateStore(): Store {
    const store = new Store();
    store.goals = [loanPayoffGoal()];
    store.loanLinks = [loanLink()];
    store.loans = [
        {
            id: "loan-1",
            name: "Personal Loan",
            currencyId: "INR",
            status: "ACTIVE",
            outstandingPrincipal: 40_000,
        },
    ];
    return store;
}

describe("GoalActualsService - LOAN_PAYOFF_LINKED automatic updating", () => {
    it("reflects the loan's outstandingPrincipal changing (a payment made)", async () => {
        const store = loanAutoUpdateStore();
        const service = store.buildService();

        const before = await service.getGoalActuals(
            "loan-goal-1"
        );
        expect(
            before?.totals.outstandingDebt
        ).toBe(40_000);

        store.loans[0].outstandingPrincipal = 25_000;

        const after = await service.getGoalActuals(
            "loan-goal-1"
        );
        expect(
            after?.totals.outstandingDebt
        ).toBe(25_000);
        expect(
            after!.totals.progressPercentage
        ).toBeGreaterThan(
            before!.totals.progressPercentage
        );
    });

    it("reflects linking a second loan", async () => {
        const store = loanAutoUpdateStore();
        store.loans.push({
            id: "loan-2",
            name: "Car Loan",
            currencyId: "INR",
            status: "ACTIVE",
            outstandingPrincipal: 10_000,
        });
        const service = store.buildService();

        const before = await service.getGoalActuals(
            "loan-goal-1"
        );
        expect(
            before?.totals.outstandingDebt
        ).toBe(40_000);

        store.loanLinks.push(
            loanLink({
                id: "llink-2",
                loanId: "loan-2",
            })
        );

        const after = await service.getGoalActuals(
            "loan-goal-1"
        );
        expect(
            after?.totals.outstandingDebt
        ).toBe(50_000);
    });

    it("reflects unlinking a loan", async () => {
        const store = loanAutoUpdateStore();
        store.loans.push({
            id: "loan-2",
            name: "Car Loan",
            currencyId: "INR",
            status: "ACTIVE",
            outstandingPrincipal: 10_000,
        });
        store.loanLinks.push(
            loanLink({
                id: "llink-2",
                loanId: "loan-2",
            })
        );
        const service = store.buildService();

        const before = await service.getGoalActuals(
            "loan-goal-1"
        );
        expect(
            before?.totals.outstandingDebt
        ).toBe(50_000);

        store.loanLinks = store.loanLinks.filter(
            l => l.id !== "llink-2"
        );

        const after = await service.getGoalActuals(
            "loan-goal-1"
        );
        expect(
            after?.totals.outstandingDebt
        ).toBe(40_000);
    });

    it("reflects the loan being closed (excluded, with a warning)", async () => {
        const store = loanAutoUpdateStore();
        const service = store.buildService();

        const before = await service.getGoalActuals(
            "loan-goal-1"
        );
        expect(
            before?.totals.outstandingDebt
        ).toBe(40_000);

        store.loans[0].status = "CLOSED";

        const after = await service.getGoalActuals(
            "loan-goal-1"
        );
        expect(
            after?.totals.outstandingDebt
        ).toBe(0);
        expect(after?.warnings).toHaveLength(1);
    });

    it("does not affect a savings-linked goal (mode isolation)", async () => {
        const store = loanAutoUpdateStore();
        store.goals.push(goal({ id: "goal-1" }));
        store.links.push({
            id: "link-1",
            goalId: "goal-1",
            accountId: "acc-1",
            isActive: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        });
        store.accounts = [
            {
                id: "acc-1",
                name: "Savings",
                type: "SAVINGS",
                currencyId: "INR",
                isActive: true,
                openingBalance: 10_000,
            },
        ];
        const service = store.buildService();

        store.loans[0].outstandingPrincipal = 90_000;

        const savingsResult =
            await service.getGoalActuals("goal-1");
        expect(
            savingsResult?.totals.currentAmount
        ).toBe(10_000);
    });

    it("is deterministic across repeated calls with unchanged data", async () => {
        const store = loanAutoUpdateStore();
        const service = store.buildService();

        const first = await service.getGoalActuals(
            "loan-goal-1"
        );
        const second = await service.getGoalActuals(
            "loan-goal-1"
        );

        expect(first).toEqual(second);
    });
});

// =====================================================================
// Phase 5 - INVESTMENT_LINKED automatic updating
// =====================================================================

function investmentGoal(
    over: Partial<FinancialGoal> = {}
): FinancialGoal {
    return goal({
        id: "investment-goal-1",
        goalMode: "INVESTMENT_LINKED",
        ...over,
    });
}

function investmentLink(
    over: Partial<GoalInvestmentLink> = {}
): GoalInvestmentLink {
    return {
        id: "ilink-1",
        goalId: "investment-goal-1",
        investmentId: "inv-1",
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...over,
    };
}

function investmentAutoUpdateStore(): Store {
    const store = new Store();
    store.goals = [investmentGoal()];
    store.investmentLinks = [investmentLink()];
    store.investments = [
        {
            id: "inv-1",
            name: "Index Fund",
            currencyId: "INR",
            status: "ACTIVE",
            currentValue: 40_000,
        },
    ];
    return store;
}

describe("GoalActualsService - INVESTMENT_LINKED automatic updating", () => {
    it("reflects the investment's currentValue changing (market movement)", async () => {
        const store = investmentAutoUpdateStore();
        const service = store.buildService();

        const before = await service.getGoalActuals(
            "investment-goal-1"
        );
        expect(
            before?.totals.currentAmount
        ).toBe(40_000);

        store.investments[0].currentValue = 55_000;

        const after = await service.getGoalActuals(
            "investment-goal-1"
        );
        expect(
            after?.totals.currentAmount
        ).toBe(55_000);
        expect(
            after!.totals.progressPercentage
        ).toBeGreaterThan(
            before!.totals.progressPercentage
        );
    });

    it("reflects linking a second investment", async () => {
        const store = investmentAutoUpdateStore();
        store.investments.push({
            id: "inv-2",
            name: "Bond Fund",
            currencyId: "INR",
            status: "ACTIVE",
            currentValue: 10_000,
        });
        const service = store.buildService();

        const before = await service.getGoalActuals(
            "investment-goal-1"
        );
        expect(
            before?.totals.currentAmount
        ).toBe(40_000);

        store.investmentLinks.push(
            investmentLink({
                id: "ilink-2",
                investmentId: "inv-2",
            })
        );

        const after = await service.getGoalActuals(
            "investment-goal-1"
        );
        expect(
            after?.totals.currentAmount
        ).toBe(50_000);
    });

    it("reflects unlinking an investment", async () => {
        const store = investmentAutoUpdateStore();
        store.investments.push({
            id: "inv-2",
            name: "Bond Fund",
            currencyId: "INR",
            status: "ACTIVE",
            currentValue: 10_000,
        });
        store.investmentLinks.push(
            investmentLink({
                id: "ilink-2",
                investmentId: "inv-2",
            })
        );
        const service = store.buildService();

        const before = await service.getGoalActuals(
            "investment-goal-1"
        );
        expect(
            before?.totals.currentAmount
        ).toBe(50_000);

        store.investmentLinks =
            store.investmentLinks.filter(
                l => l.id !== "ilink-2"
            );

        const after = await service.getGoalActuals(
            "investment-goal-1"
        );
        expect(
            after?.totals.currentAmount
        ).toBe(40_000);
    });

    it("reflects the investment being closed (excluded, with a warning)", async () => {
        const store = investmentAutoUpdateStore();
        const service = store.buildService();

        const before = await service.getGoalActuals(
            "investment-goal-1"
        );
        expect(
            before?.totals.currentAmount
        ).toBe(40_000);

        store.investments[0].status = "CLOSED";

        const after = await service.getGoalActuals(
            "investment-goal-1"
        );
        expect(
            after?.totals.currentAmount
        ).toBe(0);
        expect(after?.warnings).toHaveLength(1);
    });

    it("does not affect a loan-payoff goal (mode isolation)", async () => {
        const store = investmentAutoUpdateStore();
        store.goals.push(loanPayoffGoal());
        store.loanLinks.push(loanLink());
        store.loans = [
            {
                id: "loan-1",
                name: "Personal Loan",
                currencyId: "INR",
                status: "ACTIVE",
                outstandingPrincipal: 40_000,
            },
        ];
        const service = store.buildService();

        store.investments[0].currentValue = 99_000;

        const loanResult = await service.getGoalActuals(
            "loan-goal-1"
        );
        expect(
            loanResult?.totals.outstandingDebt
        ).toBe(40_000);
    });

    it("is deterministic across repeated calls with unchanged data", async () => {
        const store = investmentAutoUpdateStore();
        const service = store.buildService();

        const first = await service.getGoalActuals(
            "investment-goal-1"
        );
        const second = await service.getGoalActuals(
            "investment-goal-1"
        );

        expect(first).toEqual(second);
    });
});
