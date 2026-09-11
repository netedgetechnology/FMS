import { describe, expect, it, vi } from "vitest";

import type { FinancialGoal } from "../types/FinancialGoal";
import type { GoalAccountLink } from "../types/GoalAccountLink";
import type { GoalCategoryLink } from "../types/GoalCategoryLink";
import type { GoalLoanLink } from "../types/GoalLoanLink";
import type { GoalInvestmentLink } from "../types/GoalInvestmentLink";

import { GoalActualsService } from "./GoalActualsService";

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

interface Fakes {
    goals?: FinancialGoal[];
    linksByGoal?: Record<string, GoalAccountLink[]>;
    categoryLinksByGoal?: Record<
        string,
        GoalCategoryLink[]
    >;
    loanLinksByGoal?: Record<string, GoalLoanLink[]>;
    investmentLinksByGoal?: Record<
        string,
        GoalInvestmentLink[]
    >;
    accounts?: Array<{
        id: string;
        name: string;
        type: string;
        currencyId: string;
        isActive: boolean;
        openingBalance: number;
    }>;
    categories?: Array<{
        id: string;
        name: string;
        categoryType: string;
        isActive: boolean;
    }>;
    loans?: Array<{
        id: string;
        name: string;
        currencyId: string;
        status: string;
        outstandingPrincipal: number;
    }>;
    investments?: Array<{
        id: string;
        name: string;
        currencyId: string;
        status: string;
        currentValue: number;
    }>;
    transactions?: Array<{
        accountId: string;
        categoryId?: string | null;
        type: "income" | "expense" | "transfer";
        amount: number;
        transactionDate: string;
    }>;
    transfers?: Array<{
        sourceAccountId: string;
        destinationAccountId: string;
        amount: number;
        transactionDate: string;
        deletedAt: string | null;
    }>;
}

// GoalActualsService news up live repositories/services internally,
// each talking to a real Tauri SQLite connection unavailable here.
// Following PlanActualsService.test.ts's pattern, each is replaced with
// an in-memory fake via Object.defineProperty.
function build(fakes: Fakes) {
    const service = new GoalActualsService();

    const goalsGetAll = vi.fn(
        async () => fakes.goals ?? []
    );
    const goalGetById = vi.fn(
        async (id: string) =>
            (fakes.goals ?? []).find(
                g => g.id === id
            ) ?? null
    );
    const linksListByGoal = vi.fn(
        async (goalId: string) =>
            fakes.linksByGoal?.[goalId] ?? []
    );
    const linksListByGoals = vi.fn(
        async (goalIds: string[]) =>
            goalIds.flatMap(
                id => fakes.linksByGoal?.[id] ?? []
            )
    );
    const categoryLinksListByGoal = vi.fn(
        async (goalId: string) =>
            fakes.categoryLinksByGoal?.[goalId] ?? []
    );
    const categoryLinksListByGoals = vi.fn(
        async (goalIds: string[]) =>
            goalIds.flatMap(
                id =>
                    fakes.categoryLinksByGoal?.[id] ??
                    []
            )
    );
    const loanLinksListByGoal = vi.fn(
        async (goalId: string) =>
            fakes.loanLinksByGoal?.[goalId] ?? []
    );
    const loanLinksListByGoals = vi.fn(
        async (goalIds: string[]) =>
            goalIds.flatMap(
                id => fakes.loanLinksByGoal?.[id] ?? []
            )
    );
    const investmentLinksListByGoal = vi.fn(
        async (goalId: string) =>
            fakes.investmentLinksByGoal?.[goalId] ??
            []
    );
    const investmentLinksListByGoals = vi.fn(
        async (goalIds: string[]) =>
            goalIds.flatMap(
                id =>
                    fakes.investmentLinksByGoal?.[
                        id
                    ] ?? []
            )
    );
    const transactionsGetAll = vi.fn(
        async () => fakes.transactions ?? []
    );
    const transfersGetAll = vi.fn(
        async () => fakes.transfers ?? []
    );
    const accountsGetAll = vi.fn(
        async () => fakes.accounts ?? []
    );
    const categoryGetById = vi.fn(
        async (id: string) =>
            (fakes.categories ?? []).find(
                c => c.id === id
            ) ?? null
    );
    const loanGetById = vi.fn(
        async (id: string) =>
            (fakes.loans ?? []).find(
                l => l.id === id
            ) ?? null
    );
    const investmentGetById = vi.fn(
        async (id: string) =>
            (fakes.investments ?? []).find(
                i => i.id === id
            ) ?? null
    );

    const set = (prop: string, value: unknown) =>
        Object.defineProperty(service, prop, {
            value,
        });

    set("goalRepository", {
        getAll: goalsGetAll,
        getById: goalGetById,
    });
    set("accountLinkRepository", {
        listByGoal: linksListByGoal,
        listByGoals: linksListByGoals,
    });
    set("categoryLinkRepository", {
        listByGoal: categoryLinksListByGoal,
        listByGoals: categoryLinksListByGoals,
    });
    set("loanLinkRepository", {
        listByGoal: loanLinksListByGoal,
        listByGoals: loanLinksListByGoals,
    });
    set("investmentLinkRepository", {
        listByGoal: investmentLinksListByGoal,
        listByGoals: investmentLinksListByGoals,
    });
    set("transactionService", {
        getAll: transactionsGetAll,
    });
    set("transferRepository", {
        getAll: transfersGetAll,
    });
    set("accountService", {
        getAll: accountsGetAll,
    });
    set("categoryService", {
        getById: categoryGetById,
    });
    set("loanService", {
        getById: loanGetById,
    });
    set("investmentService", {
        getById: investmentGetById,
    });

    return {
        service,
        spies: {
            goalsGetAll,
            goalGetById,
            linksListByGoal,
            linksListByGoals,
            categoryLinksListByGoal,
            categoryLinksListByGoals,
            loanLinksListByGoal,
            loanLinksListByGoals,
            investmentLinksListByGoal,
            investmentLinksListByGoals,
            transactionsGetAll,
            transfersGetAll,
            accountsGetAll,
            categoryGetById,
            loanGetById,
            investmentGetById,
        },
    };
}

const ACCOUNT = {
    id: "acc-1",
    name: "Savings",
    type: "SAVINGS",
    currencyId: "INR",
    isActive: true,
    openingBalance: 20_000,
};

describe("GoalActualsService.getAllGoalActuals", () => {
    it("returns an empty map when there are no goals", async () => {
        const { service } = build({ goals: [] });

        const result =
            await service.getAllGoalActuals();

        expect(result.size).toBe(0);
    });

    it("skips manual goals entirely - no result, no ledger touched via them", async () => {
        const { service } = build({
            goals: [goal({ goalMode: "MANUAL" })],
        });

        const result =
            await service.getAllGoalActuals();

        expect(result.size).toBe(0);
    });

    it("computes actuals only for ACCOUNT_LINKED goals in a mixed list", async () => {
        const { service } = build({
            goals: [
                goal({
                    id: "goal-manual",
                    goalMode: "MANUAL",
                }),
                goal({
                    id: "goal-linked",
                    goalMode: "ACCOUNT_LINKED",
                }),
            ],
            linksByGoal: {
                "goal-linked": [
                    link({ goalId: "goal-linked" }),
                ],
            },
            accounts: [ACCOUNT],
        });

        const result =
            await service.getAllGoalActuals();

        expect(result.size).toBe(1);
        expect(
            result.get("goal-linked")?.totals
                .currentAmount
        ).toBe(20_000);
        expect(
            result.get("goal-manual")
        ).toBeUndefined();
    });

    it("sums multiple linked accounts for one goal", async () => {
        const { service } = build({
            goals: [goal()],
            linksByGoal: {
                "goal-1": [
                    link({
                        id: "link-1",
                        accountId: "acc-1",
                    }),
                    link({
                        id: "link-2",
                        accountId: "acc-2",
                    }),
                ],
            },
            accounts: [
                ACCOUNT,
                {
                    ...ACCOUNT,
                    id: "acc-2",
                    name: "Cash",
                    type: "CASH",
                    openingBalance: 5_000,
                },
            ],
        });

        const result =
            await service.getAllGoalActuals();

        expect(
            result.get("goal-1")?.totals.currentAmount
        ).toBe(25_000);
    });

    it("excludes a currency-mismatched linked account from the sum", async () => {
        const { service } = build({
            goals: [goal({ currencyId: "INR" })],
            linksByGoal: {
                "goal-1": [link()],
            },
            accounts: [
                { ...ACCOUNT, currencyId: "USD" },
            ],
        });

        const result =
            await service.getAllGoalActuals();

        expect(
            result.get("goal-1")?.totals.currentAmount
        ).toBe(0);
        expect(
            result.get("goal-1")?.warnings
        ).toHaveLength(1);
    });

    it("excludes a deleted (missing) linked account safely, with a warning", async () => {
        const { service } = build({
            goals: [goal()],
            linksByGoal: {
                "goal-1": [link()],
            },
            accounts: [], // account no longer exists
        });

        const result =
            await service.getAllGoalActuals();

        expect(
            result.get("goal-1")?.totals.currentAmount
        ).toBe(0);
        expect(
            result.get("goal-1")?.links[0]
                .unavailableReason
        ).toBe("SOURCE_MISSING");
    });

    it("excludes an inactive linked account safely, with a warning", async () => {
        const { service } = build({
            goals: [goal()],
            linksByGoal: {
                "goal-1": [link()],
            },
            accounts: [
                { ...ACCOUNT, isActive: false },
            ],
        });

        const result =
            await service.getAllGoalActuals();

        expect(
            result.get("goal-1")?.links[0]
                .unavailableReason
        ).toBe("SOURCE_INACTIVE");
    });

    it("fetches the ledger only once for a batch of many linked goals", async () => {
        const { service, spies } = build({
            goals: [
                goal({ id: "goal-1" }),
                goal({ id: "goal-2" }),
            ],
            linksByGoal: {
                "goal-1": [
                    link({ goalId: "goal-1" }),
                ],
                "goal-2": [
                    link({
                        id: "link-2",
                        goalId: "goal-2",
                        accountId: "acc-1",
                    }),
                ],
            },
            accounts: [ACCOUNT],
        });

        await service.getAllGoalActuals();

        expect(
            spies.transactionsGetAll
        ).toHaveBeenCalledTimes(1);
        expect(
            spies.transfersGetAll
        ).toHaveBeenCalledTimes(1);
        expect(
            spies.accountsGetAll
        ).toHaveBeenCalledTimes(1);
    });
});

describe("GoalActualsService.getGoalActuals", () => {
    it("returns null for a manual goal", async () => {
        const { service } = build({
            goals: [goal({ goalMode: "MANUAL" })],
        });

        expect(
            await service.getGoalActuals("goal-1")
        ).toBeNull();
    });

    it("returns null for a goal that does not exist", async () => {
        const { service } = build({ goals: [] });

        expect(
            await service.getGoalActuals("missing")
        ).toBeNull();
    });

    it("computes actuals for a single linked goal", async () => {
        const { service } = build({
            goals: [goal()],
            linksByGoal: { "goal-1": [link()] },
            accounts: [ACCOUNT],
        });

        const result = await service.getGoalActuals(
            "goal-1"
        );

        expect(result?.totals.currentAmount).toBe(
            20_000
        );
    });
});

// =====================================================================
// Phase 2 - DEBT_PAYOFF_LINKED goals
// =====================================================================

const CREDIT_CARD = {
    id: "cc-1",
    name: "Credit Card",
    type: "CREDIT_CARD",
    currencyId: "INR",
    isActive: true,
    openingBalance: -30_000,
};

function debtGoal(
    over: Partial<FinancialGoal> = {}
): FinancialGoal {
    return goal({
        id: "debt-goal-1",
        goalMode: "DEBT_PAYOFF_LINKED",
        ...over,
    });
}

describe("GoalActualsService - DEBT_PAYOFF_LINKED", () => {
    it("computes outstanding debt / amount paid off for a debt-payoff goal", async () => {
        const { service } = build({
            goals: [debtGoal()],
            linksByGoal: {
                "debt-goal-1": [
                    link({
                        goalId: "debt-goal-1",
                        accountId: "cc-1",
                    }),
                ],
            },
            accounts: [CREDIT_CARD],
        });

        const result =
            await service.getAllGoalActuals();

        const totals = result.get("debt-goal-1")
            ?.totals;

        expect(totals?.outstandingDebt).toBe(
            30_000
        );
        // target 100_000, outstanding 30_000 -> paid off 70_000
        expect(totals?.currentAmount).toBe(70_000);
    });

    it("computes both a savings goal and a debt-payoff goal in the same batch", async () => {
        const { service } = build({
            goals: [
                goal({
                    id: "savings-goal",
                    goalMode: "ACCOUNT_LINKED",
                }),
                debtGoal({ id: "debt-goal-1" }),
            ],
            linksByGoal: {
                "savings-goal": [
                    link({
                        id: "link-savings",
                        goalId: "savings-goal",
                        accountId: "acc-1",
                    }),
                ],
                "debt-goal-1": [
                    link({
                        id: "link-debt",
                        goalId: "debt-goal-1",
                        accountId: "cc-1",
                    }),
                ],
            },
            accounts: [ACCOUNT, CREDIT_CARD],
        });

        const result =
            await service.getAllGoalActuals();

        expect(result.size).toBe(2);
        expect(
            result.get("savings-goal")?.totals
                .currentAmount
        ).toBe(20_000);
        expect(
            result.get("debt-goal-1")?.totals
                .outstandingDebt
        ).toBe(30_000);
    });

    it("rejects a SAVINGS account linked to a debt-payoff goal (excluded, with a warning)", async () => {
        const { service } = build({
            goals: [debtGoal()],
            linksByGoal: {
                "debt-goal-1": [
                    link({
                        goalId: "debt-goal-1",
                        accountId: "acc-1",
                    }),
                ],
            },
            accounts: [ACCOUNT], // SAVINGS type, wrong for LIABILITY
        });

        const result =
            await service.getAllGoalActuals();

        const goalResult = result.get(
            "debt-goal-1"
        );

        expect(goalResult?.totals.outstandingDebt).toBe(
            0
        );
        expect(
            goalResult?.links[0].unavailableReason
        ).toBe("INVALID_ACCOUNT_TYPE");
    });

    it("excludes a currency-mismatched liability account", async () => {
        const { service } = build({
            goals: [debtGoal()],
            linksByGoal: {
                "debt-goal-1": [
                    link({
                        goalId: "debt-goal-1",
                        accountId: "cc-1",
                    }),
                ],
            },
            accounts: [
                { ...CREDIT_CARD, currencyId: "USD" },
            ],
        });

        const result =
            await service.getAllGoalActuals();

        expect(
            result.get("debt-goal-1")?.totals
                .outstandingDebt
        ).toBe(0);
        expect(
            result.get("debt-goal-1")?.warnings
        ).toHaveLength(1);
    });

    it("excludes a deleted (missing) liability account safely", async () => {
        const { service } = build({
            goals: [debtGoal()],
            linksByGoal: {
                "debt-goal-1": [
                    link({
                        goalId: "debt-goal-1",
                        accountId: "cc-1",
                    }),
                ],
            },
            accounts: [], // account no longer exists
        });

        const result =
            await service.getAllGoalActuals();

        expect(
            result.get("debt-goal-1")?.links[0]
                .unavailableReason
        ).toBe("SOURCE_MISSING");
    });

    it("excludes an inactive liability account safely", async () => {
        const { service } = build({
            goals: [debtGoal()],
            linksByGoal: {
                "debt-goal-1": [
                    link({
                        goalId: "debt-goal-1",
                        accountId: "cc-1",
                    }),
                ],
            },
            accounts: [
                { ...CREDIT_CARD, isActive: false },
            ],
        });

        const result =
            await service.getAllGoalActuals();

        expect(
            result.get("debt-goal-1")?.links[0]
                .unavailableReason
        ).toBe("SOURCE_INACTIVE");
    });

    it("getGoalActuals computes a single debt-payoff goal", async () => {
        const { service } = build({
            goals: [debtGoal()],
            linksByGoal: {
                "debt-goal-1": [
                    link({
                        goalId: "debt-goal-1",
                        accountId: "cc-1",
                    }),
                ],
            },
            accounts: [CREDIT_CARD],
        });

        const result = await service.getGoalActuals(
            "debt-goal-1"
        );

        expect(result?.totals.outstandingDebt).toBe(
            30_000
        );
    });
});

// =====================================================================
// Phase 3 - CATEGORY_CONTRIBUTION_LINKED goals
// =====================================================================

const INCOME_CATEGORY = {
    id: "cat-1",
    name: "Freelance Income",
    categoryType: "INCOME",
    isActive: true,
};

function categoryLink(
    over: Partial<GoalCategoryLink> = {}
): GoalCategoryLink {
    return {
        id: "clink-1",
        goalId: "contrib-goal-1",
        categoryId: "cat-1",
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...over,
    };
}

function contributionGoal(
    over: Partial<FinancialGoal> = {}
): FinancialGoal {
    return goal({
        id: "contrib-goal-1",
        goalMode: "CATEGORY_CONTRIBUTION_LINKED",
        createdAt: "2026-01-01T00:00:00.000Z",
        targetDate: null,
        ...over,
    });
}

describe("GoalActualsService - CATEGORY_CONTRIBUTION_LINKED", () => {
    it("computes the contribution total for a single linked income category", async () => {
        const { service } = build({
            goals: [contributionGoal()],
            categoryLinksByGoal: {
                "contrib-goal-1": [categoryLink()],
            },
            categories: [INCOME_CATEGORY],
            accounts: [ACCOUNT],
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 15_000,
                    transactionDate: "2026-02-01",
                },
            ],
        });

        const result =
            await service.getAllGoalActuals();

        expect(
            result.get("contrib-goal-1")?.totals
                .currentAmount
        ).toBe(15_000);
    });

    it("computes a savings goal, a debt-payoff goal and a category-contribution goal in the same batch", async () => {
        const { service } = build({
            goals: [
                goal({
                    id: "savings-goal",
                    goalMode: "ACCOUNT_LINKED",
                }),
                debtGoal({ id: "debt-goal-1" }),
                contributionGoal({
                    id: "contrib-goal-1",
                }),
            ],
            linksByGoal: {
                "savings-goal": [
                    link({
                        id: "link-savings",
                        goalId: "savings-goal",
                        accountId: "acc-1",
                    }),
                ],
                "debt-goal-1": [
                    link({
                        id: "link-debt",
                        goalId: "debt-goal-1",
                        accountId: "cc-1",
                    }),
                ],
            },
            categoryLinksByGoal: {
                "contrib-goal-1": [categoryLink()],
            },
            accounts: [
                ACCOUNT,
                CREDIT_CARD,
                {
                    id: "acc-freelance",
                    name: "Freelance Bank",
                    type: "CURRENT",
                    currencyId: "INR",
                    isActive: true,
                    openingBalance: 0,
                },
            ],
            categories: [INCOME_CATEGORY],
            transactions: [
                {
                    accountId: "acc-freelance",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 15_000,
                    transactionDate: "2026-02-01",
                },
            ],
        });

        const result =
            await service.getAllGoalActuals();

        expect(result.size).toBe(3);
        expect(
            result.get("savings-goal")?.totals
                .currentAmount
        ).toBe(20_000);
        expect(
            result.get("debt-goal-1")?.totals
                .outstandingDebt
        ).toBe(30_000);
        expect(
            result.get("contrib-goal-1")?.totals
                .currentAmount
        ).toBe(15_000);
    });

    it("sums multiple linked income categories", async () => {
        const { service } = build({
            goals: [contributionGoal()],
            categoryLinksByGoal: {
                "contrib-goal-1": [
                    categoryLink({
                        id: "clink-1",
                        categoryId: "cat-1",
                    }),
                    categoryLink({
                        id: "clink-2",
                        categoryId: "cat-2",
                    }),
                ],
            },
            categories: [
                INCOME_CATEGORY,
                {
                    ...INCOME_CATEGORY,
                    id: "cat-2",
                    name: "Consulting Income",
                },
            ],
            accounts: [ACCOUNT],
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 10_000,
                    transactionDate: "2026-02-01",
                },
                {
                    accountId: "acc-1",
                    categoryId: "cat-2",
                    type: "income",
                    amount: 6_000,
                    transactionDate: "2026-02-02",
                },
            ],
        });

        const result =
            await service.getAllGoalActuals();

        expect(
            result.get("contrib-goal-1")?.totals
                .currentAmount
        ).toBe(16_000);
    });

    it("excludes an expense transaction and a transfer-typed transaction in the same category", async () => {
        const { service } = build({
            goals: [contributionGoal()],
            categoryLinksByGoal: {
                "contrib-goal-1": [categoryLink()],
            },
            categories: [INCOME_CATEGORY],
            accounts: [ACCOUNT],
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 10_000,
                    transactionDate: "2026-02-01",
                },
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "expense",
                    amount: 3_000,
                    transactionDate: "2026-02-02",
                },
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "transfer",
                    amount: 5_000,
                    transactionDate: "2026-02-03",
                },
            ],
        });

        const result =
            await service.getAllGoalActuals();

        expect(
            result.get("contrib-goal-1")?.totals
                .currentAmount
        ).toBe(10_000);
    });

    it("excludes an income transaction outside the contribution window (before createdAt)", async () => {
        const { service } = build({
            goals: [
                contributionGoal({
                    createdAt:
                        "2026-03-01T00:00:00.000Z",
                }),
            ],
            categoryLinksByGoal: {
                "contrib-goal-1": [categoryLink()],
            },
            categories: [INCOME_CATEGORY],
            accounts: [ACCOUNT],
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 10_000,
                    transactionDate: "2026-01-15", // before createdAt
                },
            ],
        });

        const result =
            await service.getAllGoalActuals();

        expect(
            result.get("contrib-goal-1")?.totals
                .currentAmount
        ).toBe(0);
    });

    it("excludes an income transaction after targetDate", async () => {
        const { service } = build({
            goals: [
                contributionGoal({
                    targetDate: "2026-06-30",
                }),
            ],
            categoryLinksByGoal: {
                "contrib-goal-1": [categoryLink()],
            },
            categories: [INCOME_CATEGORY],
            accounts: [ACCOUNT],
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 10_000,
                    transactionDate: "2026-07-15", // after targetDate
                },
            ],
        });

        const result =
            await service.getAllGoalActuals();

        expect(
            result.get("contrib-goal-1")?.totals
                .currentAmount
        ).toBe(0);
    });

    it("rejects an EXPENSE-type category linked to a contribution goal (excluded, with a warning)", async () => {
        const { service } = build({
            goals: [contributionGoal()],
            categoryLinksByGoal: {
                "contrib-goal-1": [categoryLink()],
            },
            categories: [
                {
                    ...INCOME_CATEGORY,
                    categoryType: "EXPENSE",
                },
            ],
            accounts: [ACCOUNT],
        });

        const result =
            await service.getAllGoalActuals();

        expect(
            result.get("contrib-goal-1")?.warnings
        ).toHaveLength(1);
        expect(
            result.get("contrib-goal-1")?.totals
                .currentAmount
        ).toBe(0);
    });

    it("excludes a deleted (missing) linked category safely, with a warning", async () => {
        const { service } = build({
            goals: [contributionGoal()],
            categoryLinksByGoal: {
                "contrib-goal-1": [categoryLink()],
            },
            categories: [], // category no longer exists
            accounts: [ACCOUNT],
        });

        const result =
            await service.getAllGoalActuals();

        expect(
            result.get("contrib-goal-1")?.warnings
        ).toHaveLength(1);
    });

    it("excludes an inactive linked category safely, with a warning", async () => {
        const { service } = build({
            goals: [contributionGoal()],
            categoryLinksByGoal: {
                "contrib-goal-1": [categoryLink()],
            },
            categories: [
                {
                    ...INCOME_CATEGORY,
                    isActive: false,
                },
            ],
            accounts: [ACCOUNT],
        });

        const result =
            await service.getAllGoalActuals();

        expect(
            result.get("contrib-goal-1")?.warnings
        ).toHaveLength(1);
    });

    it("excludes a currency-mismatched transaction with an aggregate warning (no conversion)", async () => {
        const { service } = build({
            goals: [contributionGoal()],
            categoryLinksByGoal: {
                "contrib-goal-1": [categoryLink()],
            },
            categories: [INCOME_CATEGORY],
            accounts: [
                { ...ACCOUNT, currencyId: "USD" },
            ],
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 10_000,
                    transactionDate: "2026-02-01",
                },
            ],
        });

        const result =
            await service.getAllGoalActuals();

        expect(
            result.get("contrib-goal-1")?.totals
                .currentAmount
        ).toBe(0);
        expect(
            result.get("contrib-goal-1")?.warnings
        ).toHaveLength(1);
    });

    it("getGoalActuals computes a single category-contribution goal", async () => {
        const { service } = build({
            goals: [contributionGoal()],
            categoryLinksByGoal: {
                "contrib-goal-1": [categoryLink()],
            },
            categories: [INCOME_CATEGORY],
            accounts: [ACCOUNT],
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 15_000,
                    transactionDate: "2026-02-01",
                },
            ],
        });

        const result = await service.getGoalActuals(
            "contrib-goal-1"
        );

        expect(result?.totals.currentAmount).toBe(
            15_000
        );
    });
});

// =====================================================================
// Phase 4 - LOAN_PAYOFF_LINKED goals
// =====================================================================

const LOAN = {
    id: "loan-1",
    name: "Personal Loan",
    currencyId: "INR",
    status: "ACTIVE",
    outstandingPrincipal: 40_000,
};

function loanPayoffGoal(
    over: Partial<FinancialGoal> = {}
): FinancialGoal {
    return goal({
        id: "loan-goal-1",
        goalMode: "LOAN_PAYOFF_LINKED",
        ...over,
    });
}

describe("GoalActualsService - LOAN_PAYOFF_LINKED", () => {
    it("computes outstanding debt / amount paid off for a loan-payoff goal", async () => {
        const { service } = build({
            goals: [loanPayoffGoal()],
            loanLinksByGoal: {
                "loan-goal-1": [loanLink()],
            },
            loans: [LOAN],
        });

        const result =
            await service.getAllGoalActuals();

        const totals = result.get("loan-goal-1")
            ?.totals;

        expect(totals?.outstandingDebt).toBe(
            40_000
        );
        // target 100_000, outstanding 40_000 -> paid off 60_000
        expect(totals?.currentAmount).toBe(60_000);
    });

    it("computes a savings goal, a debt-payoff goal, a category-contribution goal and a loan-payoff goal in the same batch", async () => {
        const { service } = build({
            goals: [
                goal({
                    id: "savings-goal",
                    goalMode: "ACCOUNT_LINKED",
                }),
                debtGoal({ id: "debt-goal-1" }),
                contributionGoal({
                    id: "contrib-goal-1",
                }),
                loanPayoffGoal({
                    id: "loan-goal-1",
                }),
            ],
            linksByGoal: {
                "savings-goal": [
                    link({
                        id: "link-savings",
                        goalId: "savings-goal",
                        accountId: "acc-1",
                    }),
                ],
                "debt-goal-1": [
                    link({
                        id: "link-debt",
                        goalId: "debt-goal-1",
                        accountId: "cc-1",
                    }),
                ],
            },
            categoryLinksByGoal: {
                "contrib-goal-1": [categoryLink()],
            },
            loanLinksByGoal: {
                "loan-goal-1": [loanLink()],
            },
            accounts: [
                ACCOUNT,
                CREDIT_CARD,
                {
                    id: "acc-freelance",
                    name: "Freelance Bank",
                    type: "CURRENT",
                    currencyId: "INR",
                    isActive: true,
                    openingBalance: 0,
                },
            ],
            categories: [INCOME_CATEGORY],
            loans: [LOAN],
            transactions: [
                {
                    accountId: "acc-freelance",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 15_000,
                    transactionDate: "2026-02-01",
                },
            ],
        });

        const result =
            await service.getAllGoalActuals();

        expect(result.size).toBe(4);
        expect(
            result.get("savings-goal")?.totals
                .currentAmount
        ).toBe(20_000);
        expect(
            result.get("debt-goal-1")?.totals
                .outstandingDebt
        ).toBe(30_000);
        expect(
            result.get("contrib-goal-1")?.totals
                .currentAmount
        ).toBe(15_000);
        expect(
            result.get("loan-goal-1")?.totals
                .outstandingDebt
        ).toBe(40_000);
    });

    it("excludes a currency-mismatched loan", async () => {
        const { service } = build({
            goals: [loanPayoffGoal()],
            loanLinksByGoal: {
                "loan-goal-1": [loanLink()],
            },
            loans: [
                { ...LOAN, currencyId: "USD" },
            ],
        });

        const result =
            await service.getAllGoalActuals();

        expect(
            result.get("loan-goal-1")?.totals
                .outstandingDebt
        ).toBe(0);
        expect(
            result.get("loan-goal-1")?.warnings
        ).toHaveLength(1);
    });

    it("excludes a deleted (missing) linked loan safely, with a warning", async () => {
        const { service } = build({
            goals: [loanPayoffGoal()],
            loanLinksByGoal: {
                "loan-goal-1": [loanLink()],
            },
            loans: [], // loan no longer exists
        });

        const result =
            await service.getAllGoalActuals();

        expect(
            result.get("loan-goal-1")?.warnings
        ).toHaveLength(1);
        expect(
            result.get("loan-goal-1")?.totals
                .outstandingDebt
        ).toBe(0);
    });

    it("excludes a CLOSED loan safely, with a warning", async () => {
        const { service } = build({
            goals: [loanPayoffGoal()],
            loanLinksByGoal: {
                "loan-goal-1": [loanLink()],
            },
            loans: [
                { ...LOAN, status: "CLOSED" },
            ],
        });

        const result =
            await service.getAllGoalActuals();

        expect(
            result.get("loan-goal-1")?.warnings
        ).toHaveLength(1);
        expect(
            result.get("loan-goal-1")?.totals
                .outstandingDebt
        ).toBe(0);
    });

    it("sums multiple linked loans", async () => {
        const { service } = build({
            goals: [loanPayoffGoal()],
            loanLinksByGoal: {
                "loan-goal-1": [
                    loanLink({
                        id: "llink-1",
                        loanId: "loan-1",
                    }),
                    loanLink({
                        id: "llink-2",
                        loanId: "loan-2",
                    }),
                ],
            },
            loans: [
                LOAN,
                {
                    ...LOAN,
                    id: "loan-2",
                    name: "Car Loan",
                    outstandingPrincipal: 10_000,
                },
            ],
        });

        const result =
            await service.getAllGoalActuals();

        expect(
            result.get("loan-goal-1")?.totals
                .outstandingDebt
        ).toBe(50_000);
    });

    it("getGoalActuals computes a single loan-payoff goal", async () => {
        const { service } = build({
            goals: [loanPayoffGoal()],
            loanLinksByGoal: {
                "loan-goal-1": [loanLink()],
            },
            loans: [LOAN],
        });

        const result = await service.getGoalActuals(
            "loan-goal-1"
        );

        expect(result?.totals.outstandingDebt).toBe(
            40_000
        );
    });
});

// =====================================================================
// Phase 5 - INVESTMENT_LINKED goals
// =====================================================================

const INVESTMENT = {
    id: "inv-1",
    name: "Index Fund",
    currencyId: "INR",
    status: "ACTIVE",
    currentValue: 40_000,
};

function investmentGoal(
    over: Partial<FinancialGoal> = {}
): FinancialGoal {
    return goal({
        id: "investment-goal-1",
        goalMode: "INVESTMENT_LINKED",
        ...over,
    });
}

describe("GoalActualsService - INVESTMENT_LINKED", () => {
    it("computes current amount from a linked investment's current value", async () => {
        const { service } = build({
            goals: [investmentGoal()],
            investmentLinksByGoal: {
                "investment-goal-1": [
                    investmentLink(),
                ],
            },
            investments: [INVESTMENT],
        });

        const result =
            await service.getAllGoalActuals();

        expect(
            result.get("investment-goal-1")?.totals
                .currentAmount
        ).toBe(40_000);
    });

    it("computes a savings goal, a debt-payoff goal, a category-contribution goal, a loan-payoff goal and an investment-linked goal in the same batch", async () => {
        const { service } = build({
            goals: [
                goal({
                    id: "savings-goal",
                    goalMode: "ACCOUNT_LINKED",
                }),
                debtGoal({ id: "debt-goal-1" }),
                contributionGoal({
                    id: "contrib-goal-1",
                }),
                loanPayoffGoal({
                    id: "loan-goal-1",
                }),
                investmentGoal({
                    id: "investment-goal-1",
                }),
            ],
            linksByGoal: {
                "savings-goal": [
                    link({
                        id: "link-savings",
                        goalId: "savings-goal",
                        accountId: "acc-1",
                    }),
                ],
                "debt-goal-1": [
                    link({
                        id: "link-debt",
                        goalId: "debt-goal-1",
                        accountId: "cc-1",
                    }),
                ],
            },
            categoryLinksByGoal: {
                "contrib-goal-1": [categoryLink()],
            },
            loanLinksByGoal: {
                "loan-goal-1": [loanLink()],
            },
            investmentLinksByGoal: {
                "investment-goal-1": [
                    investmentLink(),
                ],
            },
            accounts: [
                ACCOUNT,
                CREDIT_CARD,
                {
                    id: "acc-freelance",
                    name: "Freelance Bank",
                    type: "CURRENT",
                    currencyId: "INR",
                    isActive: true,
                    openingBalance: 0,
                },
            ],
            categories: [INCOME_CATEGORY],
            loans: [LOAN],
            investments: [INVESTMENT],
            transactions: [
                {
                    accountId: "acc-freelance",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 15_000,
                    transactionDate: "2026-02-01",
                },
            ],
        });

        const result =
            await service.getAllGoalActuals();

        expect(result.size).toBe(5);
        expect(
            result.get("savings-goal")?.totals
                .currentAmount
        ).toBe(20_000);
        expect(
            result.get("debt-goal-1")?.totals
                .outstandingDebt
        ).toBe(30_000);
        expect(
            result.get("contrib-goal-1")?.totals
                .currentAmount
        ).toBe(15_000);
        expect(
            result.get("loan-goal-1")?.totals
                .outstandingDebt
        ).toBe(40_000);
        expect(
            result.get("investment-goal-1")?.totals
                .currentAmount
        ).toBe(40_000);
    });

    it("excludes a currency-mismatched investment", async () => {
        const { service } = build({
            goals: [investmentGoal()],
            investmentLinksByGoal: {
                "investment-goal-1": [
                    investmentLink(),
                ],
            },
            investments: [
                { ...INVESTMENT, currencyId: "USD" },
            ],
        });

        const result =
            await service.getAllGoalActuals();

        expect(
            result.get("investment-goal-1")?.totals
                .currentAmount
        ).toBe(0);
        expect(
            result.get("investment-goal-1")
                ?.warnings
        ).toHaveLength(1);
    });

    it("excludes a deleted (missing) linked investment safely, with a warning", async () => {
        const { service } = build({
            goals: [investmentGoal()],
            investmentLinksByGoal: {
                "investment-goal-1": [
                    investmentLink(),
                ],
            },
            investments: [], // investment no longer exists
        });

        const result =
            await service.getAllGoalActuals();

        expect(
            result.get("investment-goal-1")
                ?.warnings
        ).toHaveLength(1);
        expect(
            result.get("investment-goal-1")?.totals
                .currentAmount
        ).toBe(0);
    });

    it.each(["CLOSED", "ON_HOLD"])(
        "excludes a %s investment safely, with a warning",
        async (status) => {
            const { service } = build({
                goals: [investmentGoal()],
                investmentLinksByGoal: {
                    "investment-goal-1": [
                        investmentLink(),
                    ],
                },
                investments: [
                    { ...INVESTMENT, status },
                ],
            });

            const result =
                await service.getAllGoalActuals();

            expect(
                result.get("investment-goal-1")
                    ?.warnings
            ).toHaveLength(1);
            expect(
                result.get("investment-goal-1")
                    ?.totals.currentAmount
            ).toBe(0);
        }
    );

    it("sums multiple linked investments", async () => {
        const { service } = build({
            goals: [investmentGoal()],
            investmentLinksByGoal: {
                "investment-goal-1": [
                    investmentLink({
                        id: "ilink-1",
                        investmentId: "inv-1",
                    }),
                    investmentLink({
                        id: "ilink-2",
                        investmentId: "inv-2",
                    }),
                ],
            },
            investments: [
                INVESTMENT,
                {
                    ...INVESTMENT,
                    id: "inv-2",
                    name: "Bond Fund",
                    currentValue: 10_000,
                },
            ],
        });

        const result =
            await service.getAllGoalActuals();

        expect(
            result.get("investment-goal-1")?.totals
                .currentAmount
        ).toBe(50_000);
    });

    it("getGoalActuals computes a single investment-linked goal", async () => {
        const { service } = build({
            goals: [investmentGoal()],
            investmentLinksByGoal: {
                "investment-goal-1": [
                    investmentLink(),
                ],
            },
            investments: [INVESTMENT],
        });

        const result = await service.getGoalActuals(
            "investment-goal-1"
        );

        expect(result?.totals.currentAmount).toBe(
            40_000
        );
    });
});
