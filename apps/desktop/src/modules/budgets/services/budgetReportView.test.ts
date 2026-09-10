import { describe, expect, it } from "vitest";

import type { Budget } from "../types";

import {
    calculateBudgetSpending,
    type BudgetLedgerEntry,
} from "./budgetSpending";

import {
    buildBudgetReportRows,
    describeBudgetStatus,
    filterBudgetReportRows,
    formatPercentUsed,
    OVERALL_BUDGET_LABEL,
    resolveBudgetCategoryLabel,
    resolveBudgetCurrencyScopes,
    UNKNOWN_CATEGORY_LABEL,
} from "./budgetReportView";

const INR = "currency-inr";
const USD = "currency-usd";
const september2026 = new Date(2026, 8, 15);

function makeBudget(
    overrides: Partial<Budget> = {}
): Budget {
    return {
        id: "budget-1",
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
        type: "expense",
        amount: 1000,
        transactionDate: "2026-09-10",
        categoryId: "cat-food",
        ...overrides,
    };
}

const categoryNames = new Map<string, string>([
    ["cat-food", "Food & Dining"],
    ["cat-travel", "Travel"],
]);

function report(
    budgets: Budget[],
    transactions: BudgetLedgerEntry[],
    currencyId = INR
) {
    const summary = calculateBudgetSpending({
        budgets,
        transactions,
        month: september2026,
        currencyId,
    });

    return {
        summary,
        rows: buildBudgetReportRows(
            summary,
            categoryNames
        ),
    };
}

describe("describeBudgetStatus - reads the engine verdict, never recalculates", () => {
    it("no spending", () => {
        expect(
            describeBudgetStatus({
                thresholdState: "ok",
                overBudget: false,
                actualAmount: 0,
            })
        ).toEqual({ key: "no-spending", label: "No spending" });
    });

    it("on track", () => {
        expect(
            describeBudgetStatus({
                thresholdState: "ok",
                overBudget: false,
                actualAmount: 4000,
            })
        ).toEqual({ key: "on-track", label: "On track" });
    });

    it("approaching", () => {
        expect(
            describeBudgetStatus({
                thresholdState: "approaching",
                overBudget: false,
                actualAmount: 8500,
            }).key
        ).toBe("approaching");
    });

    it("over", () => {
        expect(
            describeBudgetStatus({
                thresholdState: "over",
                overBudget: true,
                actualAmount: 12000,
            }).key
        ).toBe("over");
    });
});

describe("formatPercentUsed", () => {
    it("rounds to a whole percent", () => {
        expect(formatPercentUsed(49.6, 10000)).toBe("50%");
        expect(formatPercentUsed(120, 10000)).toBe("120%");
    });

    it("returns an em dash when there is no budget to measure against", () => {
        expect(formatPercentUsed(0, 0)).toBe("—");
    });
});

describe("buildBudgetReportRows - display data straight off the engine", () => {
    it("carries budget / actual / remaining / % exactly as the engine produced them", () => {
        const { rows } = report(
            [makeBudget({ id: "b-food", categoryId: "cat-food", amount: 10000 })],
            [expense({ amount: 6500 })]
        );

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            budgetId: "b-food",
            categoryLabel: "Food & Dining",
            isOverallBudget: false,
            budgetAmount: 10000,
            actualAmount: 6500,
            remainingAmount: 3500,
            percentageUsed: 65,
            overBudget: false,
        });
        expect(rows[0].status.key).toBe("on-track");
    });

    it("under budget below threshold -> on track", () => {
        const { rows } = report(
            [makeBudget({ amount: 10000, alertThreshold: 80 })],
            [expense({ amount: 3000 })]
        );

        expect(rows[0].status.key).toBe("on-track");
        expect(rows[0].percentageUsed).toBe(30);
    });

    it("at/over the alert threshold but within budget -> approaching", () => {
        const { rows } = report(
            [makeBudget({ amount: 10000, alertThreshold: 80 })],
            [expense({ amount: 8000 })]
        );

        expect(rows[0].status.key).toBe("approaching");
        expect(rows[0].overBudget).toBe(false);
    });

    it("over budget -> negative remaining, >100%, over status, NOT clamped", () => {
        const { rows } = report(
            [makeBudget({ amount: 10000 })],
            [expense({ amount: 12000 })]
        );

        expect(rows[0].remainingAmount).toBe(-2000);
        expect(rows[0].percentageUsed).toBe(120);
        expect(rows[0].overBudget).toBe(true);
        expect(rows[0].status.key).toBe("over");
    });

    it("zero spending -> actual 0, remaining full, 0% (kept visible, not hidden)", () => {
        const { rows } = report(
            [makeBudget({ id: "b-food", categoryId: "cat-food", amount: 10000 })],
            [expense({ categoryId: "cat-travel", amount: 5000 })]
        );

        expect(rows).toHaveLength(1);
        expect(rows[0].actualAmount).toBe(0);
        expect(rows[0].remainingAmount).toBe(10000);
        expect(rows[0].percentageUsed).toBe(0);
        expect(rows[0].status.key).toBe("no-spending");
    });

    it("labels a category whose name can't be resolved as 'Unknown category', not an overall budget", () => {
        const { rows } = report(
            [makeBudget({ categoryId: "cat-deleted", amount: 5000 })],
            []
        );

        expect(rows[0].categoryLabel).toBe("Unknown category");
        expect(rows[0].isOverallBudget).toBe(false);
    });
});

describe("buildBudgetReportRows - overall / all-category budget", () => {
    it("renders a null-category budget as an overall line carrying total spend, without touching category totals", () => {
        const { summary, rows } = report(
            [
                makeBudget({ id: "b-overall", categoryId: null, amount: 50000 }),
                makeBudget({ id: "b-food", categoryId: "cat-food", amount: 10000 }),
            ],
            [
                expense({ categoryId: "cat-food", amount: 6000 }),
                expense({ categoryId: "cat-travel", amount: 9000 }),
            ]
        );

        const overall = rows.find(r => r.budgetId === "b-overall");
        const food = rows.find(r => r.budgetId === "b-food");

        expect(overall?.isOverallBudget).toBe(true);
        expect(overall?.categoryLabel).toBe(OVERALL_BUDGET_LABEL);
        expect(overall?.actualAmount).toBe(15000);

        expect(food?.actualAmount).toBe(6000);

        // Category-scoped summary totals ignore the overall budget.
        expect(summary.totalBudgetAmount).toBe(10000);
        expect(summary.budgetedActual).toBe(6000);
    });
});

describe("summary values passed to the UI", () => {
    it("exposes budget / actual / remaining / % plus unbudgeted & uncategorized", () => {
        const { summary } = report(
            [makeBudget({ id: "b-food", categoryId: "cat-food", amount: 10000 })],
            [
                expense({ categoryId: "cat-food", amount: 4000 }),
                expense({ categoryId: "cat-travel", amount: 3000 }),
                expense({ categoryId: null, amount: 1000 }),
            ]
        );

        expect(summary.totalBudgetAmount).toBe(10000);
        expect(summary.budgetedActual).toBe(4000);
        expect(summary.totalRemaining).toBe(6000);
        expect(summary.totalPercentageUsed).toBe(40);
        expect(summary.totalExpense).toBe(8000);
        expect(summary.unbudgetedSpending).toBe(4000);
        expect(summary.uncategorizedSpending).toBe(1000);
    });

    it("does not clamp negative remaining / >100% at the summary level", () => {
        const { summary } = report(
            [makeBudget({ categoryId: "cat-food", amount: 10000 })],
            [expense({ categoryId: "cat-food", amount: 30000 })]
        );

        expect(summary.totalRemaining).toBe(-20000);
        expect(summary.totalPercentageUsed).toBe(300);
    });
});

describe("filterBudgetReportRows", () => {
    it("matches budget name or category label, case-insensitively", () => {
        const { rows } = report(
            [
                makeBudget({ id: "b-food", name: "Groceries", categoryId: "cat-food", amount: 10000 }),
                makeBudget({ id: "b-travel", name: "Trips", categoryId: "cat-travel", amount: 8000 }),
            ],
            []
        );

        expect(
            filterBudgetReportRows(rows, "travel").map(r => r.budgetId)
        ).toEqual(["b-travel"]);

        expect(
            filterBudgetReportRows(rows, "GROCER").map(r => r.budgetId)
        ).toEqual(["b-food"]);

        expect(filterBudgetReportRows(rows, "  ")).toHaveLength(2);
    });
});

describe("resolveBudgetCategoryLabel", () => {
    const names = new Map<string, string>([
        ["cat-food", "Food & Dining"],
    ]);

    it("returns undefined for a null category so the caller shows its own overall wording", () => {
        expect(
            resolveBudgetCategoryLabel(null, names)
        ).toBeUndefined();
    });

    it("returns the category name when it resolves", () => {
        expect(
            resolveBudgetCategoryLabel("cat-food", names)
        ).toBe("Food & Dining");
    });

    it("returns 'Unknown category' for a deleted/hidden category, never the overall label", () => {
        expect(
            resolveBudgetCategoryLabel("cat-gone", names)
        ).toBe(UNKNOWN_CATEGORY_LABEL);

        expect(
            resolveBudgetCategoryLabel("cat-gone", names)
        ).not.toBe(OVERALL_BUDGET_LABEL);
    });
});

describe("resolveBudgetCurrencyScopes", () => {
    const currencies = [
        { id: INR, code: "INR", isDefault: true },
        { id: USD, code: "USD", isDefault: false },
    ];

    it("falls back to the default currency when no budget applies", () => {
        expect(
            resolveBudgetCurrencyScopes([], currencies)
        ).toEqual([INR]);
    });

    it("returns one scope per distinct budget currency, default first", () => {
        expect(
            resolveBudgetCurrencyScopes(
                [
                    { currencyId: USD },
                    { currencyId: INR },
                    { currencyId: USD },
                ],
                currencies
            )
        ).toEqual([INR, USD]);
    });

    it("returns an empty list when the system has no currencies and no budgets", () => {
        expect(resolveBudgetCurrencyScopes([], [])).toEqual([]);
    });
});

describe("no-budget / no-spending situations", () => {
    it("no budgets but expenses exist - rows empty, spending still visible via the summary", () => {
        const { summary, rows } = report(
            [],
            [
                expense({ categoryId: "cat-food", amount: 4000 }),
                expense({ categoryId: null, amount: 1000 }),
            ]
        );

        expect(rows).toEqual([]);
        expect(summary.totalExpense).toBe(5000);
        expect(summary.unbudgetedSpending).toBe(5000);
        expect(summary.uncategorizedSpending).toBe(1000);
    });

    it("budgets exist but no spending - every row still renders at 0% used", () => {
        const { rows } = report(
            [
                makeBudget({ id: "a", categoryId: "cat-food", amount: 10000 }),
                makeBudget({ id: "b", categoryId: "cat-travel", amount: 5000 }),
            ],
            []
        );

        expect(rows.map(r => r.status.key)).toEqual([
            "no-spending",
            "no-spending",
        ]);
        expect(rows.every(r => r.percentageUsed === 0)).toBe(true);
        expect(rows.every(r => r.remainingAmount === r.budgetAmount)).toBe(true);
    });

    it("budgets in another currency are not shown in the report currency", () => {
        const { rows, summary } = report(
            [makeBudget({ currencyId: USD, amount: 200 })],
            [expense({ amount: 1000 })],
            INR
        );

        expect(rows).toEqual([]);
        expect(summary.totalExpense).toBe(1000);
    });
});
