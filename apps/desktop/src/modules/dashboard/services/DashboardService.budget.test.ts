import { describe, expect, it } from "vitest";

import {
    calculateBudgetSpending,
    type BudgetLedgerEntry,
} from "@/modules/budgets/services";
import type { Budget } from "@/modules/budgets/types";

import { computeDashboardBudgetOverview } from "./DashboardService";

// September 2026 - any day inside the month.
const MONTH = new Date(2026, 8, 15);
const INR = "cur-inr";
const USD = "cur-usd";

const currencies = [
    { id: INR, code: "INR", isDefault: true },
    { id: USD, code: "USD", isDefault: false },
];

const categoryNameById = new Map<string, string>([
    ["cat-food", "Food"],
    ["cat-travel", "Travel"],
    ["cat-loan", "Loan"],
]);

function makeBudget(
    overrides: Partial<Budget> = {}
): Budget {
    return {
        id: "b-1",
        name: "Budget 1",
        categoryId: "cat-food",
        businessEntityId: null,
        amount: 10000,
        periodType: "MONTHLY",
        startDate: "2026-09-01",
        endDate: null,
        currencyId: INR,
        alertThreshold: 80,
        isActive: true,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
        ...overrides,
    };
}

function expense(
    overrides: Partial<BudgetLedgerEntry> = {}
): BudgetLedgerEntry {
    return {
        id: "t",
        type: "expense",
        amount: 1000,
        transactionDate: "2026-09-10",
        categoryId: "cat-food",
        accountId: "bank-1",
        ...overrides,
    };
}

function overview(input: {
    budgets: Budget[];
    transactions: BudgetLedgerEntry[];
    emiInterestByTransactionId?: Map<string, number>;
    creditCardAccountIds?: Set<string>;
}) {
    return computeDashboardBudgetOverview({
        budgets: input.budgets,
        transactions: input.transactions,
        currencies,
        categoryNameById,
        month: MONTH,
        emiInterestByTransactionId:
            input.emiInterestByTransactionId,
        creditCardAccountIds:
            input.creditCardAccountIds,
    });
}

describe("computeDashboardBudgetOverview - current-month summary", () => {
    it("reports the current calendar month, ignoring transactions outside it", () => {
        const result = overview({
            budgets: [
                makeBudget({
                    categoryId: "cat-food",
                    amount: 10000,
                }),
            ],
            transactions: [
                expense({
                    transactionDate: "2026-08-31",
                    amount: 5000,
                }), // previous month
                expense({
                    transactionDate: "2026-09-01",
                    amount: 2000,
                }),
                expense({
                    transactionDate: "2026-09-30",
                    amount: 1000,
                }),
                expense({
                    transactionDate: "2026-10-01",
                    amount: 9000,
                }), // next month
            ],
        });

        expect(result.currencyId).toBe(INR);
        expect(result.currencyCode).toBe("INR");
        expect(result.totalBudget).toBe(10000);
        expect(result.actualSpending).toBe(3000);
    });

    it("actual / remaining / % are internally consistent and not clamped", () => {
        const result = overview({
            budgets: [
                makeBudget({
                    categoryId: "cat-food",
                    amount: 10000,
                }),
            ],
            transactions: [
                expense({ amount: 6500 }),
            ],
        });

        expect(result.actualSpending).toBe(6500);
        expect(result.remaining).toBe(
            result.totalBudget - result.actualSpending
        );
        expect(result.remaining).toBe(3500);
        expect(result.percentageUsed).toBeCloseTo(65);
        expect(result.overBudget).toBe(false);
    });

    it("flags over-budget with negative remaining and >100%, not clamped", () => {
        const result = overview({
            budgets: [
                makeBudget({
                    categoryId: "cat-food",
                    amount: 10000,
                }),
            ],
            transactions: [
                expense({ amount: 13000 }),
            ],
        });

        expect(result.overBudget).toBe(true);
        expect(result.remaining).toBe(-3000);
        expect(result.percentageUsed).toBeCloseTo(130);

        const foodRow = result.categories.find(
            c => c.label === "Food"
        );
        expect(foodRow?.overBudget).toBe(true);
        expect(foodRow?.statusKey).toBe("over");
    });

    it("marks a budget at/over the alert threshold but within budget as approaching", () => {
        const result = overview({
            budgets: [
                makeBudget({
                    categoryId: "cat-food",
                    amount: 10000,
                    alertThreshold: 80,
                }),
            ],
            transactions: [
                expense({ amount: 8500 }),
            ],
        });

        const foodRow = result.categories.find(
            c => c.label === "Food"
        );
        expect(foodRow?.statusKey).toBe("approaching");
        expect(foodRow?.overBudget).toBe(false);
        expect(result.overBudget).toBe(false);
    });

    it("keeps a budget with no spending visible at 0%", () => {
        const result = overview({
            budgets: [
                makeBudget({
                    id: "b-food",
                    categoryId: "cat-food",
                    amount: 10000,
                }),
            ],
            transactions: [
                expense({
                    categoryId: "cat-travel",
                    amount: 4000,
                }),
            ],
        });

        const foodRow = result.categories.find(
            c => c.label === "Food"
        );
        expect(foodRow?.actualAmount).toBe(0);
        expect(foodRow?.remainingAmount).toBe(10000);
        expect(foodRow?.percentageUsed).toBe(0);
        expect(foodRow?.statusKey).toBe("no-spending");
    });
});

describe("computeDashboardBudgetOverview - unbudgeted / uncategorized", () => {
    it("surfaces unbudgeted spending and keeps uncategorized separately identifiable", () => {
        const result = overview({
            budgets: [
                makeBudget({
                    categoryId: "cat-food",
                    amount: 10000,
                }),
            ],
            transactions: [
                expense({
                    categoryId: "cat-food",
                    amount: 3000,
                }),
                expense({
                    categoryId: "cat-travel",
                    amount: 2500,
                }), // categorized but unbudgeted
                expense({
                    categoryId: null,
                    amount: 1200,
                }), // uncategorized
            ],
        });

        expect(result.actualSpending).toBe(3000);
        expect(result.unbudgetedSpending).toBe(3700); // 2500 + 1200
        expect(result.uncategorizedSpending).toBe(1200);
    });

    it("shows spending even when there is no budget at all (empty overview, spending still needs the Budgets page)", () => {
        const result = overview({
            budgets: [],
            transactions: [
                expense({ amount: 4000 }),
            ],
        });

        // No applicable budget -> no currency scope resolved from
        // budgets; falls back to the default currency but with an
        // all-zero budget picture.
        expect(result.currencyId).toBe(INR);
        expect(result.totalBudget).toBe(0);
        expect(result.categories).toEqual([]);
    });
});

describe("computeDashboardBudgetOverview - transaction rules stay consistent with the engine", () => {
    it("excludes income, transfers and a credit-card bill payment", () => {
        const result = overview({
            budgets: [
                makeBudget({
                    categoryId: "cat-food",
                    amount: 50000,
                }),
            ],
            creditCardAccountIds: new Set(["cc-1"]),
            transactions: [
                expense({
                    id: "buy",
                    categoryId: "cat-food",
                    amount: 4000,
                }),
                {
                    id: "salary",
                    type: "income",
                    amount: 90000,
                    transactionDate: "2026-09-02",
                    categoryId: "cat-food",
                    accountId: "bank-1",
                },
                {
                    id: "xfer",
                    type: "transfer",
                    amount: 5000,
                    transactionDate: "2026-09-03",
                    categoryId: "cat-food",
                    accountId: "bank-1",
                },
                {
                    id: "cc-bill",
                    type: "expense",
                    amount: 12000,
                    transactionDate: "2026-09-20",
                    categoryId: "cat-food",
                    accountId: "bank-1",
                    cardReference: "cc-1",
                },
            ],
        });

        expect(result.actualSpending).toBe(4000);
        expect(result.unbudgetedSpending).toBe(0);
    });

    it("counts only the interest portion of a loan EMI", () => {
        const result = overview({
            budgets: [
                makeBudget({
                    categoryId: "cat-loan",
                    amount: 10000,
                }),
            ],
            emiInterestByTransactionId: new Map([
                ["emi-sep", 2500],
            ]),
            transactions: [
                expense({
                    id: "emi-sep",
                    categoryId: "cat-loan",
                    amount: 12000, // 9500 principal + 2500 interest
                }),
            ],
        });

        expect(result.actualSpending).toBe(2500);
    });
});

describe("computeDashboardBudgetOverview - multi-currency", () => {
    it("scopes to the default currency and flags that others exist", () => {
        const result = overview({
            budgets: [
                makeBudget({
                    id: "b-inr",
                    categoryId: "cat-food",
                    amount: 10000,
                    currencyId: INR,
                }),
                makeBudget({
                    id: "b-usd",
                    categoryId: "cat-travel",
                    amount: 500,
                    currencyId: USD,
                }),
            ],
            transactions: [
                expense({
                    categoryId: "cat-food",
                    amount: 3000,
                }),
            ],
        });

        expect(result.currencyId).toBe(INR);
        expect(result.hasOtherCurrencies).toBe(true);
        // USD budget is not summed in
        expect(result.totalBudget).toBe(10000);
    });
});

describe("Dashboard and Budget engine use identical definitions", () => {
    it("every headline figure matches calculateBudgetSpending() for the same month + currency", () => {
        const budgets = [
            makeBudget({
                id: "b-food",
                categoryId: "cat-food",
                amount: 10000,
            }),
            makeBudget({
                id: "b-travel",
                categoryId: "cat-travel",
                amount: 5000,
            }),
        ];

        const transactions = [
            expense({
                categoryId: "cat-food",
                amount: 9000,
            }),
            expense({
                categoryId: "cat-travel",
                amount: 1500,
            }),
            expense({
                categoryId: null,
                amount: 800,
            }),
            expense({
                transactionDate: "2026-10-05",
                amount: 9999,
            }),
        ];

        const result = overview({ budgets, transactions });

        const engine = calculateBudgetSpending({
            budgets,
            transactions,
            month: MONTH,
            currencyId: INR,
        });

        expect(result.totalBudget).toBe(
            engine.totalBudgetAmount
        );
        expect(result.actualSpending).toBe(
            engine.budgetedActual
        );
        expect(result.remaining).toBe(
            engine.totalRemaining
        );
        expect(result.percentageUsed).toBe(
            engine.totalPercentageUsed
        );
        expect(result.unbudgetedSpending).toBe(
            engine.unbudgetedSpending
        );
        expect(result.uncategorizedSpending).toBe(
            engine.uncategorizedSpending
        );
        expect(result.categories.map(c => c.budgetId)).toEqual(
            engine.lines.map(l => l.budgetId)
        );
    });
});
