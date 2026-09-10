import { describe, expect, it } from "vitest";

import type { Budget } from "../types";

import {
    calculateBudgetSpending,
    type BudgetLedgerEntry,
} from "./budgetSpending";

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

describe("calculateBudgetSpending - month boundaries", () => {
    it("includes transactions on the first and last day of the month, excludes neighbours", () => {
        const result = calculateBudgetSpending({
            budgets: [makeBudget({ amount: 100000 })],
            currencyId: INR,
            month: september2026,
            transactions: [
                expense({ transactionDate: "2026-08-31", amount: 500 }),
                expense({ transactionDate: "2026-09-01", amount: 1000 }),
                expense({ transactionDate: "2026-09-30", amount: 2000 }),
                expense({ transactionDate: "2026-10-01", amount: 4000 }),
            ],
        });

        expect(result.monthStart).toBe("2026-09-01");
        expect(result.monthEnd).toBe("2026-09-30");
        expect(result.totalExpense).toBe(3000);
        expect(result.lines[0].actualAmount).toBe(3000);
    });

    it("reports on the month that contains the given date, whatever day it is", () => {
        const result = calculateBudgetSpending({
            budgets: [],
            currencyId: INR,
            month: new Date(2026, 1, 3), // 3 Feb 2026
            transactions: [],
        });

        expect(result.monthStart).toBe("2026-02-01");
        expect(result.monthEnd).toBe("2026-02-28");
    });
});

describe("calculateBudgetSpending - transaction type filtering", () => {
    it("counts only expenses; income and transfers are ignored", () => {
        const result = calculateBudgetSpending({
            budgets: [makeBudget()],
            currencyId: INR,
            month: september2026,
            transactions: [
                expense({ amount: 2500 }),
                { type: "income", amount: 90000, transactionDate: "2026-09-05", categoryId: "cat-food" },
                { type: "transfer", amount: 5000, transactionDate: "2026-09-06", categoryId: "cat-food" },
            ],
        });

        expect(result.totalExpense).toBe(2500);
        expect(result.lines[0].actualAmount).toBe(2500);
    });
});

describe("calculateBudgetSpending - soft-deleted transactions", () => {
    it("excludes any entry carrying a deletedAt", () => {
        const result = calculateBudgetSpending({
            budgets: [makeBudget()],
            currencyId: INR,
            month: september2026,
            transactions: [
                expense({ amount: 1000 }),
                expense({ amount: 9999, deletedAt: "2026-09-11T00:00:00.000Z" }),
            ],
        });

        expect(result.totalExpense).toBe(1000);
        expect(result.lines[0].actualAmount).toBe(1000);
    });
});

describe("calculateBudgetSpending - category matching", () => {
    it("a category budget receives only its own category's spend", () => {
        const result = calculateBudgetSpending({
            budgets: [
                makeBudget({ id: "b-food", categoryId: "cat-food", amount: 10000 }),
            ],
            currencyId: INR,
            month: september2026,
            transactions: [
                expense({ categoryId: "cat-food", amount: 3000 }),
                expense({ categoryId: "cat-travel", amount: 8000 }),
                expense({ categoryId: null, amount: 500 }),
            ],
        });

        const foodLine = result.lines.find(l => l.budgetId === "b-food");

        expect(foodLine?.actualAmount).toBe(3000);
        expect(result.budgetedActual).toBe(3000);
        expect(result.totalExpense).toBe(11500);
    });

    it("multiple categories and budgets are kept independent", () => {
        const result = calculateBudgetSpending({
            budgets: [
                makeBudget({ id: "b-food", categoryId: "cat-food", amount: 10000 }),
                makeBudget({ id: "b-travel", categoryId: "cat-travel", amount: 5000 }),
            ],
            currencyId: INR,
            month: september2026,
            transactions: [
                expense({ categoryId: "cat-food", amount: 4000 }),
                expense({ categoryId: "cat-food", amount: 1000 }),
                expense({ categoryId: "cat-travel", amount: 6000 }),
            ],
        });

        const food = result.lines.find(l => l.budgetId === "b-food");
        const travel = result.lines.find(l => l.budgetId === "b-travel");

        expect(food?.actualAmount).toBe(5000);
        expect(travel?.actualAmount).toBe(6000);
        expect(result.totalBudgetAmount).toBe(15000);
        expect(result.budgetedActual).toBe(11000);
        expect(result.totalRemaining).toBe(4000);
    });

    it("two budgets for the same category both show that category's spend, but the total counts it once", () => {
        const result = calculateBudgetSpending({
            budgets: [
                makeBudget({ id: "b-1", categoryId: "cat-food", amount: 8000 }),
                makeBudget({ id: "b-2", categoryId: "cat-food", amount: 12000 }),
            ],
            currencyId: INR,
            month: september2026,
            transactions: [expense({ categoryId: "cat-food", amount: 5000 })],
        });

        expect(result.lines.map(l => l.actualAmount)).toEqual([5000, 5000]);
        expect(result.totalBudgetAmount).toBe(20000);
        expect(result.budgetedActual).toBe(5000);
    });
});

describe("calculateBudgetSpending - unbudgeted & uncategorized", () => {
    it("keeps expenses with no matching budget visible as unbudgeted spending", () => {
        const result = calculateBudgetSpending({
            budgets: [
                makeBudget({ id: "b-food", categoryId: "cat-food", amount: 10000 }),
            ],
            currencyId: INR,
            month: september2026,
            transactions: [
                expense({ categoryId: "cat-food", amount: 2000 }),
                expense({ categoryId: "cat-travel", amount: 7000 }),
                expense({ categoryId: null, amount: 1500 }),
            ],
        });

        expect(result.budgetedActual).toBe(2000);
        expect(result.unbudgetedSpending).toBe(8500);
        expect(result.uncategorizedSpending).toBe(1500);
        expect(result.totalExpense).toBe(10500);
    });

    it("separates uncategorized spending from categorized-but-unbudgeted spending", () => {
        const result = calculateBudgetSpending({
            budgets: [],
            currencyId: INR,
            month: september2026,
            transactions: [
                expense({ categoryId: "cat-travel", amount: 3000 }),
                expense({ categoryId: null, amount: 2000 }),
            ],
        });

        expect(result.unbudgetedSpending).toBe(5000);
        expect(result.uncategorizedSpending).toBe(2000);
    });

    it("no budgets but expenses exist - everything stays visible", () => {
        const result = calculateBudgetSpending({
            budgets: [],
            currencyId: INR,
            month: september2026,
            transactions: [
                expense({ categoryId: "cat-food", amount: 4000 }),
                expense({ categoryId: null, amount: 1000 }),
            ],
        });

        expect(result.lines).toEqual([]);
        expect(result.totalBudgetAmount).toBe(0);
        expect(result.budgetedActual).toBe(0);
        expect(result.totalRemaining).toBe(0);
        expect(result.totalPercentageUsed).toBe(0);
        expect(result.totalExpense).toBe(5000);
        expect(result.unbudgetedSpending).toBe(5000);
        expect(result.uncategorizedSpending).toBe(1000);
    });
});

describe("calculateBudgetSpending - null-category (overall) budget", () => {
    it("carries total in-month expense on its own line without contaminating category lines or totals", () => {
        const result = calculateBudgetSpending({
            budgets: [
                makeBudget({ id: "b-overall", categoryId: null, amount: 50000 }),
                makeBudget({ id: "b-food", categoryId: "cat-food", amount: 10000 }),
            ],
            currencyId: INR,
            month: september2026,
            transactions: [
                expense({ categoryId: "cat-food", amount: 6000 }),
                expense({ categoryId: "cat-travel", amount: 9000 }),
                expense({ categoryId: null, amount: 2000 }),
            ],
        });

        const overall = result.lines.find(l => l.budgetId === "b-overall");
        const food = result.lines.find(l => l.budgetId === "b-food");

        // The overall line sees everything...
        expect(overall?.actualAmount).toBe(17000);
        // ...but the category line still only sees its own category.
        expect(food?.actualAmount).toBe(6000);

        // Category-scoped totals ignore the overall budget entirely -
        // this is the non-buggy replacement for the Dashboard's
        // "null category matches everything" behavior.
        expect(result.totalBudgetAmount).toBe(10000);
        expect(result.budgetedActual).toBe(6000);
        expect(result.unbudgetedSpending).toBe(11000);
    });
});

describe("calculateBudgetSpending - zero / under / exact / over budget", () => {
    it("zero spend", () => {
        const [line] = calculateBudgetSpending({
            budgets: [makeBudget({ amount: 10000 })],
            currencyId: INR,
            month: september2026,
            transactions: [],
        }).lines;

        expect(line.actualAmount).toBe(0);
        expect(line.remainingAmount).toBe(10000);
        expect(line.percentageUsed).toBe(0);
        expect(line.overBudget).toBe(false);
        expect(line.thresholdState).toBe("ok");
    });

    it("under budget, below the alert threshold", () => {
        const [line] = calculateBudgetSpending({
            budgets: [makeBudget({ amount: 10000, alertThreshold: 80 })],
            currencyId: INR,
            month: september2026,
            transactions: [expense({ amount: 5000 })],
        }).lines;

        expect(line.remainingAmount).toBe(5000);
        expect(line.percentageUsed).toBe(50);
        expect(line.overBudget).toBe(false);
        expect(line.thresholdState).toBe("ok");
    });

    it("exactly on budget", () => {
        const [line] = calculateBudgetSpending({
            budgets: [makeBudget({ amount: 10000 })],
            currencyId: INR,
            month: september2026,
            transactions: [expense({ amount: 10000 })],
        }).lines;

        expect(line.remainingAmount).toBe(0);
        expect(line.percentageUsed).toBe(100);
        expect(line.overBudget).toBe(false);
        expect(line.thresholdState).toBe("approaching");
    });

    it("over budget - negative remaining, >100% percentage, NOT clamped", () => {
        const [line] = calculateBudgetSpending({
            budgets: [makeBudget({ amount: 10000 })],
            currencyId: INR,
            month: september2026,
            transactions: [expense({ amount: 12000 })],
        }).lines;

        expect(line.actualAmount).toBe(12000);
        expect(line.remainingAmount).toBe(-2000);
        expect(line.percentageUsed).toBe(120);
        expect(line.overBudget).toBe(true);
        expect(line.thresholdState).toBe("over");
    });

    it("does not clamp the overall totals either", () => {
        const result = calculateBudgetSpending({
            budgets: [makeBudget({ amount: 10000, categoryId: "cat-food" })],
            currencyId: INR,
            month: september2026,
            transactions: [expense({ categoryId: "cat-food", amount: 25000 })],
        });

        expect(result.totalRemaining).toBe(-15000);
        expect(result.totalPercentageUsed).toBe(250);
    });
});

describe("calculateBudgetSpending - threshold state", () => {
    it("is 'approaching' once spend reaches the alert threshold but is still within budget", () => {
        const [line] = calculateBudgetSpending({
            budgets: [makeBudget({ amount: 10000, alertThreshold: 75 })],
            currencyId: INR,
            month: september2026,
            transactions: [expense({ amount: 7500 })],
        }).lines;

        expect(line.percentageUsed).toBe(75);
        expect(line.overBudget).toBe(false);
        expect(line.thresholdState).toBe("approaching");
    });

    it("stays 'ok' at zero spend even when the alert threshold is 0", () => {
        const [line] = calculateBudgetSpending({
            budgets: [makeBudget({ amount: 10000, alertThreshold: 0 })],
            currencyId: INR,
            month: september2026,
            transactions: [],
        }).lines;

        expect(line.thresholdState).toBe("ok");
    });

    it("echoes the budget's alertThreshold on the line", () => {
        const [line] = calculateBudgetSpending({
            budgets: [makeBudget({ alertThreshold: 65 })],
            currencyId: INR,
            month: september2026,
            transactions: [],
        }).lines;

        expect(line.alertThreshold).toBe(65);
    });
});

describe("calculateBudgetSpending - applicability & active scoping", () => {
    it("excludes budgets whose date range does not cover the selected month", () => {
        const result = calculateBudgetSpending({
            budgets: [
                makeBudget({ id: "future", startDate: "2026-10-01" }),
                makeBudget({ id: "ended", startDate: "2026-01-01", endDate: "2026-07-31" }),
                makeBudget({ id: "current", startDate: "2026-09-01" }),
            ],
            currencyId: INR,
            month: september2026,
            transactions: [expense({ amount: 1000 })],
        });

        expect(result.lines.map(l => l.budgetId)).toEqual(["current"]);
    });

    it("excludes inactive budgets from lines and totals", () => {
        const result = calculateBudgetSpending({
            budgets: [
                makeBudget({ id: "active", categoryId: "cat-food", amount: 10000, isActive: true }),
                makeBudget({ id: "inactive", categoryId: "cat-travel", amount: 5000, isActive: false }),
            ],
            currencyId: INR,
            month: september2026,
            transactions: [
                expense({ categoryId: "cat-food", amount: 1000 }),
                expense({ categoryId: "cat-travel", amount: 2000 }),
            ],
        });

        expect(result.lines.map(l => l.budgetId)).toEqual(["active"]);
        expect(result.totalBudgetAmount).toBe(10000);
        // cat-travel spend is now unbudgeted, not budgeted.
        expect(result.budgetedActual).toBe(1000);
        expect(result.unbudgetedSpending).toBe(2000);
    });
});

describe("calculateBudgetSpending - currency behaviour", () => {
    it("includes only budgets denominated in the report currency", () => {
        const result = calculateBudgetSpending({
            budgets: [
                makeBudget({ id: "inr", categoryId: "cat-food", amount: 10000, currencyId: INR }),
                makeBudget({ id: "usd", categoryId: "cat-food", amount: 200, currencyId: USD }),
            ],
            currencyId: INR,
            month: september2026,
            transactions: [expense({ categoryId: "cat-food", amount: 3000 })],
        });

        expect(result.lines.map(l => l.budgetId)).toEqual(["inr"]);
        expect(result.totalBudgetAmount).toBe(10000);
        expect(result.currencyId).toBe(INR);
    });

    it("never sums budget amounts across currencies", () => {
        const result = calculateBudgetSpending({
            budgets: [
                makeBudget({ id: "usd-1", categoryId: "cat-food", amount: 200, currencyId: USD }),
                makeBudget({ id: "usd-2", categoryId: "cat-travel", amount: 500, currencyId: USD }),
            ],
            currencyId: INR,
            month: september2026,
            transactions: [expense({ amount: 1000 })],
        });

        expect(result.lines).toEqual([]);
        expect(result.totalBudgetAmount).toBe(0);
        // expenses are still visible even though no budget applied
        expect(result.totalExpense).toBe(1000);
        expect(result.unbudgetedSpending).toBe(1000);
    });
});

describe("calculateBudgetSpending - defensive numeric handling", () => {
    it("treats a non-positive budget amount as a divide-by-zero guard (percentage 0), still flags over budget", () => {
        const [line] = calculateBudgetSpending({
            budgets: [makeBudget({ amount: 0 })],
            currencyId: INR,
            month: september2026,
            transactions: [expense({ amount: 500 })],
        }).lines;

        expect(line.percentageUsed).toBe(0);
        expect(line.remainingAmount).toBe(-500);
        expect(line.overBudget).toBe(true);
        expect(line.thresholdState).toBe("over");
    });

    it("uses the absolute value of a stored amount", () => {
        const result = calculateBudgetSpending({
            budgets: [makeBudget({ amount: 10000 })],
            currencyId: INR,
            month: september2026,
            transactions: [expense({ amount: -1500 })],
        });

        expect(result.totalExpense).toBe(1500);
        expect(result.lines[0].actualAmount).toBe(1500);
    });
});

describe("calculateBudgetSpending - Phase 5 transaction correctness", () => {
    it("counts a normal bank / debit expense", () => {
        const result = calculateBudgetSpending({
            budgets: [makeBudget({ amount: 10000 })],
            currencyId: INR,
            month: september2026,
            transactions: [
                expense({
                    categoryId: "cat-food",
                    amount: 3200,
                }),
            ],
        });

        expect(result.lines[0].actualAmount).toBe(3200);
        expect(result.totalExpense).toBe(3200);
    });

    it("counts a credit-card purchase", () => {
        // A purchase on a credit-card account is an expense row like any
        // other; it is the later bill payment that is excluded.
        const result = calculateBudgetSpending({
            budgets: [makeBudget({ amount: 10000 })],
            currencyId: INR,
            month: september2026,
            transactions: [
                expense({
                    categoryId: "cat-food",
                    amount: 1800,
                }),
            ],
        });

        expect(result.lines[0].actualAmount).toBe(1800);
    });

    it("counts an imported expense", () => {
        const result = calculateBudgetSpending({
            budgets: [makeBudget({ amount: 10000 })],
            currencyId: INR,
            month: september2026,
            transactions: [
                expense({
                    categoryId: "cat-food",
                    amount: 2750,
                }),
            ],
        });

        expect(result.lines[0].actualAmount).toBe(2750);
    });

    it("counts a legitimate fee expense", () => {
        const result = calculateBudgetSpending({
            budgets: [
                makeBudget({
                    categoryId: "cat-fees",
                    amount: 500,
                }),
            ],
            currencyId: INR,
            month: september2026,
            transactions: [
                expense({
                    categoryId: "cat-fees",
                    amount: 118,
                }),
            ],
        });

        expect(result.lines[0].actualAmount).toBe(118);
    });

    it("excludes income", () => {
        const result = calculateBudgetSpending({
            budgets: [makeBudget({ amount: 10000 })],
            currencyId: INR,
            month: september2026,
            transactions: [
                {
                    type: "income",
                    amount: 90000,
                    transactionDate: "2026-09-05",
                    categoryId: "cat-food",
                },
            ],
        });

        expect(result.totalExpense).toBe(0);
        expect(result.lines[0].actualAmount).toBe(0);
    });

    it("excludes a transfer even with a category and amount set", () => {
        const result = calculateBudgetSpending({
            budgets: [
                makeBudget({
                    categoryId: "cat-food",
                    amount: 10000,
                }),
            ],
            currencyId: INR,
            month: september2026,
            transactions: [
                {
                    type: "transfer",
                    amount: 6000,
                    transactionDate: "2026-09-07",
                    categoryId: "cat-food",
                },
            ],
        });

        expect(result.totalExpense).toBe(0);
        expect(result.budgetedActual).toBe(0);
    });

    it("excludes a credit-card bill payment (bank -> card) represented as a transfer", () => {
        const result = calculateBudgetSpending({
            budgets: [makeBudget({ amount: 50000 })],
            currencyId: INR,
            month: september2026,
            transactions: [
                // the original card purchase - counts
                expense({
                    id: "purchase-1",
                    categoryId: "cat-food",
                    amount: 4000,
                }),
                // the payment that clears the card - a transfer, excluded
                {
                    id: "cc-payment",
                    type: "transfer",
                    amount: 4000,
                    transactionDate: "2026-09-20",
                    categoryId: null,
                },
            ],
        });

        expect(result.totalExpense).toBe(4000);
        expect(result.lines[0].actualAmount).toBe(4000);
    });

    it("excludes investment activity (investment_transactions never reach the engine; an income row that slipped in is still excluded)", () => {
        const result = calculateBudgetSpending({
            budgets: [makeBudget({ amount: 10000 })],
            currencyId: INR,
            month: september2026,
            transactions: [
                {
                    type: "income", // dividend / sale proceeds
                    amount: 25000,
                    transactionDate: "2026-09-12",
                    categoryId: "cat-investments",
                },
            ],
        });

        expect(result.totalExpense).toBe(0);
    });

    it("excludes loan principal repayment - only the EMI interest portion counts", () => {
        const result = calculateBudgetSpending({
            budgets: [
                makeBudget({
                    categoryId: "cat-loan",
                    amount: 10000,
                }),
            ],
            currencyId: INR,
            month: september2026,
            transactions: [
                expense({
                    id: "emi-sep",
                    categoryId: "cat-loan",
                    amount: 12000, // 9500 principal + 2500 interest
                }),
            ],
            emiInterestByTransactionId: new Map([
                ["emi-sep", 2500],
            ]),
        });

        expect(result.lines[0].actualAmount).toBe(2500);
        expect(result.totalExpense).toBe(2500);
        expect(result.budgetedActual).toBe(2500);
    });

    it("counts loan interest of zero as zero (fully-principal instalment)", () => {
        const result = calculateBudgetSpending({
            budgets: [
                makeBudget({
                    categoryId: "cat-loan",
                    amount: 10000,
                }),
            ],
            currencyId: INR,
            month: september2026,
            transactions: [
                expense({
                    id: "emi-zero-interest",
                    categoryId: "cat-loan",
                    amount: 12000,
                }),
            ],
            emiInterestByTransactionId: new Map([
                ["emi-zero-interest", 0],
            ]),
        });

        expect(result.lines[0].actualAmount).toBe(0);
        expect(result.totalExpense).toBe(0);
    });

    it("without an EMI map, an EMI transaction is counted at face value (Phase 2-4 behaviour preserved)", () => {
        const result = calculateBudgetSpending({
            budgets: [
                makeBudget({
                    categoryId: "cat-loan",
                    amount: 10000,
                }),
            ],
            currencyId: INR,
            month: september2026,
            transactions: [
                expense({
                    id: "emi-sep",
                    categoryId: "cat-loan",
                    amount: 12000,
                }),
            ],
        });

        expect(result.lines[0].actualAmount).toBe(12000);
    });

    // Model limitation: refunds / reversals have no representation
    // distinct from income. This test documents the current, deliberate
    // behaviour rather than a target state.
    it("a refund received as income does not reduce spending (documented model limitation)", () => {
        const result = calculateBudgetSpending({
            budgets: [
                makeBudget({
                    categoryId: "cat-food",
                    amount: 10000,
                }),
            ],
            currencyId: INR,
            month: september2026,
            transactions: [
                expense({
                    categoryId: "cat-food",
                    amount: 3000,
                }),
                {
                    type: "income", // the refund
                    amount: 1000,
                    transactionDate: "2026-09-15",
                    categoryId: "cat-food",
                },
            ],
        });

        // Refund is excluded (does not inflate spending) but also cannot
        // net it down - spend stays at the original 3000.
        expect(result.lines[0].actualAmount).toBe(3000);
    });

    it("a mixed valid / invalid transaction set produces correct totals", () => {
        const result = calculateBudgetSpending({
            budgets: [
                makeBudget({
                    id: "b-food",
                    categoryId: "cat-food",
                    amount: 10000,
                }),
                makeBudget({
                    id: "b-loan",
                    categoryId: "cat-loan",
                    amount: 5000,
                }),
            ],
            currencyId: INR,
            month: september2026,
            transactions: [
                expense({
                    id: "t1",
                    categoryId: "cat-food",
                    amount: 4000,
                }), // counts
                expense({
                    id: "t2",
                    categoryId: "cat-travel",
                    amount: 2000,
                }), // counts (unbudgeted)
                {
                    id: "t3",
                    type: "income",
                    amount: 50000,
                    transactionDate: "2026-09-03",
                    categoryId: "cat-food",
                }, // excluded
                {
                    id: "t4",
                    type: "transfer",
                    amount: 8000,
                    transactionDate: "2026-09-04",
                    categoryId: "cat-food",
                }, // excluded
                expense({
                    id: "t5",
                    categoryId: null,
                    amount: 900,
                }), // counts (uncategorized)
                expense({
                    id: "emi",
                    categoryId: "cat-loan",
                    amount: 6000, // 4500 principal + 1500 interest
                }),
                expense({
                    id: "deleted",
                    categoryId: "cat-food",
                    amount: 999,
                    deletedAt: "2026-09-10T00:00:00.000Z",
                }), // excluded
            ],
            emiInterestByTransactionId: new Map([
                ["emi", 1500],
            ]),
        });

        // 4000 (food) + 2000 (travel) + 900 (uncat) + 1500 (emi interest)
        expect(result.totalExpense).toBe(8400);

        const food = result.lines.find(
            l => l.budgetId === "b-food"
        );
        const loan = result.lines.find(
            l => l.budgetId === "b-loan"
        );

        expect(food?.actualAmount).toBe(4000);
        expect(loan?.actualAmount).toBe(1500);
        expect(result.budgetedActual).toBe(5500); // 4000 + 1500
        expect(result.unbudgetedSpending).toBe(2900); // 2000 + 900
        expect(result.uncategorizedSpending).toBe(900);
    });

    it("keeps per-category spending correct when an EMI shares a category with normal expenses", () => {
        const result = calculateBudgetSpending({
            budgets: [
                makeBudget({
                    categoryId: "cat-loan",
                    amount: 10000,
                }),
            ],
            currencyId: INR,
            month: september2026,
            transactions: [
                expense({
                    id: "emi",
                    categoryId: "cat-loan",
                    amount: 12000, // interest 2500
                }),
                expense({
                    id: "processing-fee",
                    categoryId: "cat-loan",
                    amount: 500, // a real fee in the same category - counts fully
                }),
            ],
            emiInterestByTransactionId: new Map([
                ["emi", 2500],
            ]),
        });

        expect(result.lines[0].actualAmount).toBe(3000); // 2500 + 500
    });
});

describe("calculateBudgetSpending - Phase 5 credit-card bill payment", () => {
    const creditCardAccountIds = new Set(["cc-1"]);

    function bankExpense(
        overrides: Partial<{
            id: string;
            amount: number;
            categoryId: string | null;
            cardReference: string | null;
        }> = {}
    ) {
        return {
            id: "t",
            type: "expense" as const,
            accountId: "bank-1",
            amount: 1000,
            transactionDate: "2026-09-10",
            categoryId: "cat-food" as string | null,
            cardReference: null as string | null,
            ...overrides,
        };
    }

    it("counts a normal bank expense", () => {
        const result = calculateBudgetSpending({
            budgets: [
                makeBudget({
                    categoryId: "cat-food",
                    amount: 10000,
                }),
            ],
            currencyId: INR,
            month: september2026,
            creditCardAccountIds,
            transactions: [
                bankExpense({ id: "b1", amount: 2500 }),
            ],
        });

        expect(result.lines[0].actualAmount).toBe(2500);
        expect(result.totalExpense).toBe(2500);
    });

    it("counts a credit-card purchase (expense booked on the card account)", () => {
        const result = calculateBudgetSpending({
            budgets: [
                makeBudget({
                    categoryId: "cat-food",
                    amount: 10000,
                }),
            ],
            currencyId: INR,
            month: september2026,
            creditCardAccountIds,
            transactions: [
                {
                    id: "p1",
                    type: "expense",
                    accountId: "cc-1",
                    cardReference: "cc-1",
                    amount: 4200,
                    transactionDate: "2026-09-08",
                    categoryId: "cat-food",
                },
            ],
        });

        expect(result.lines[0].actualAmount).toBe(4200);
    });

    it("excludes a bank -> credit-card bill payment", () => {
        const result = calculateBudgetSpending({
            budgets: [
                makeBudget({
                    categoryId: "cat-food",
                    amount: 50000,
                }),
            ],
            currencyId: INR,
            month: september2026,
            creditCardAccountIds,
            transactions: [
                bankExpense({
                    id: "pay",
                    amount: 18000,
                    categoryId: "cat-food",
                    cardReference: "cc-1",
                }),
            ],
        });

        expect(result.totalExpense).toBe(0);
        expect(result.lines[0].actualAmount).toBe(0);
    });

    it("with several card purchases and one bill payment, counts the purchases only (no double count)", () => {
        const result = calculateBudgetSpending({
            budgets: [
                makeBudget({
                    categoryId: "cat-food",
                    amount: 50000,
                }),
            ],
            currencyId: INR,
            month: september2026,
            creditCardAccountIds,
            transactions: [
                {
                    id: "buy-1",
                    type: "expense",
                    accountId: "cc-1",
                    cardReference: "cc-1",
                    amount: 3000,
                    transactionDate: "2026-09-03",
                    categoryId: "cat-food",
                },
                {
                    id: "buy-2",
                    type: "expense",
                    accountId: "cc-1",
                    cardReference: null,
                    amount: 5000,
                    transactionDate: "2026-09-12",
                    categoryId: "cat-food",
                },
                {
                    id: "buy-3",
                    type: "expense",
                    accountId: "cc-1",
                    cardReference: "cc-1",
                    amount: 2000,
                    transactionDate: "2026-09-19",
                    categoryId: "cat-food",
                },
                // the bank payment clearing the statement - excluded
                bankExpense({
                    id: "statement-payment",
                    amount: 10000,
                    categoryId: "cat-food",
                    cardReference: "cc-1",
                }),
            ],
        });

        // 3000 + 5000 + 2000, payment not added
        expect(result.lines[0].actualAmount).toBe(10000);
        expect(result.totalExpense).toBe(10000);
    });

    it("a normal bank expense resembling the payment structure still counts", () => {
        // Same account, same big round amount, same category as the
        // payment above - but no cardReference to a card account.
        const result = calculateBudgetSpending({
            budgets: [
                makeBudget({
                    categoryId: "cat-food",
                    amount: 50000,
                }),
            ],
            currencyId: INR,
            month: september2026,
            creditCardAccountIds,
            transactions: [
                bankExpense({
                    id: "rent",
                    amount: 18000,
                    categoryId: "cat-food",
                    cardReference: null,
                }),
                // even a cardReference that is not a known card account
                bankExpense({
                    id: "debit-card-buy",
                    amount: 4000,
                    categoryId: "cat-food",
                    cardReference: "XX-9999",
                }),
            ],
        });

        expect(result.lines[0].actualAmount).toBe(22000);
        expect(result.totalExpense).toBe(22000);
    });
});
