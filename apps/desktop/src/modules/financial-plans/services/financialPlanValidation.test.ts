import { describe, expect, it } from "vitest";

import type { Currency } from "@/modules/currencies/types";
import type { FinancialGoal } from "@/modules/financial-goals/types";

import {
    validateFinancialPlanCurrency,
    validateFinancialPlanFields,
    validateFinancialPlanGoal,
    type FinancialPlanFieldInput,
} from "./financialPlanValidation";

function fields(
    overrides: Partial<FinancialPlanFieldInput> = {}
): FinancialPlanFieldInput {
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
        currentAmount: 100000,
        currencyId: "currency-inr",
        targetDate: "2028-01-01",
        priority: 0,
        status: "ACTIVE",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

describe("validateFinancialPlanFields", () => {
    it("accepts a well-formed plan", () => {
        expect(
            validateFinancialPlanFields(fields())
        ).toBeNull();
    });

    it("requires a name", () => {
        expect(
            validateFinancialPlanFields(
                fields({ name: "  " })
            )
        ).toMatch(/name is required/i);
    });

    it("rejects an unknown plan type", () => {
        expect(
            validateFinancialPlanFields(
                fields({
                    planType: "SOMETHING",
                })
            )
        ).toMatch(/valid plan type/i);
    });

    it("rejects an unknown period", () => {
        expect(
            validateFinancialPlanFields(
                fields({
                    periodType: "WEEKLY",
                })
            )
        ).toMatch(/valid period/i);
    });

    it("rejects a subcategory that does not belong to the category", () => {
        expect(
            validateFinancialPlanFields(
                fields({
                    planCategory: "LONG_TERM_WEALTH",
                    planSubcategory: "DEBT_REDUCTION",
                })
            )
        ).toMatch(/valid plan focus/i);
    });

    it("rejects an end date before the start date", () => {
        expect(
            validateFinancialPlanFields(
                fields({
                    startDate: "2026-09-10",
                    endDate: "2026-09-01",
                })
            )
        ).toMatch(/before the start date/i);
    });

    it("requires an end date for a ONE_TIME plan", () => {
        expect(
            validateFinancialPlanFields(
                fields({
                    periodType: "ONE_TIME",
                    endDate: null,
                })
            )
        ).toMatch(/one-time plan needs an end date/i);
    });

    it("allows a ONE_TIME plan with an end date", () => {
        expect(
            validateFinancialPlanFields(
                fields({
                    periodType: "ONE_TIME",
                    endDate: "2027-01-01",
                })
            )
        ).toBeNull();
    });

    it("rejects a negative target amount", () => {
        expect(
            validateFinancialPlanFields(
                fields({ targetAmount: -1 })
            )
        ).toMatch(/zero or more/i);
    });

    it("allows a null target for ACCUMULATION / PORTFOLIO_GROWTH", () => {
        expect(
            validateFinancialPlanFields(
                fields({
                    planType: "ACCUMULATION",
                    targetAmount: null,
                })
            )
        ).toBeNull();

        expect(
            validateFinancialPlanFields(
                fields({
                    planType: "PORTFOLIO_GROWTH",
                    planCategory: "LONG_TERM_WEALTH",
                    planSubcategory: "INVESTMENT_GROWTH",
                    targetAmount: null,
                })
            )
        ).toBeNull();
    });

    it("allows a null target for DEBT_PAYOFF (read as full payoff)", () => {
        expect(
            validateFinancialPlanFields(
                fields({
                    planType: "DEBT_PAYOFF",
                    planCategory: "DEBT_LIABILITIES",
                    planSubcategory: "DEBT_REDUCTION",
                    targetAmount: null,
                })
            )
        ).toBeNull();
    });

    it("requires a target for EXPENSE_PLAN", () => {
        expect(
            validateFinancialPlanFields(
                fields({
                    planType: "EXPENSE_PLAN",
                    planCategory: "CORE_PERSONAL_FINANCE",
                    planSubcategory: "ANNUAL_EXPENSES",
                    targetAmount: null,
                })
            )
        ).toMatch(/expense plan needs a target/i);
    });

    it("requires a per-period target for CASHFLOW_TARGET", () => {
        expect(
            validateFinancialPlanFields(
                fields({
                    planType: "CASHFLOW_TARGET",
                    planCategory: "BUSINESS_PROFESSIONAL",
                    planSubcategory: "WORKING_CAPITAL",
                    targetAmount: null,
                })
            )
        ).toMatch(/per-period target amount/i);
    });

    it("requires a currency", () => {
        expect(
            validateFinancialPlanFields(
                fields({ currencyId: "" })
            )
        ).toMatch(/currency is required/i);
    });
});

describe("validateFinancialPlanCurrency", () => {
    it("accepts an existing currency", () => {
        expect(
            validateFinancialPlanCurrency(currency())
        ).toEqual({ ok: true });
    });

    it("rejects a currency that no longer exists", () => {
        expect(
            validateFinancialPlanCurrency(null)
        ).toMatchObject({ ok: false });
    });
});

describe("validateFinancialPlanGoal", () => {
    it("accepts a null link", () => {
        expect(
            validateFinancialPlanGoal(
                null,
                undefined,
                "currency-inr"
            )
        ).toEqual({ ok: true });
    });

    it("accepts a live goal in the same currency", () => {
        expect(
            validateFinancialPlanGoal(
                "goal-1",
                goal(),
                "currency-inr"
            ).ok
        ).toBe(true);
    });

    it("rejects a goal that no longer exists", () => {
        expect(
            validateFinancialPlanGoal(
                "goal-1",
                null,
                "currency-inr"
            )
        ).toMatchObject({ ok: false });
    });

    it("rejects a goal in a different currency", () => {
        expect(
            validateFinancialPlanGoal(
                "goal-1",
                goal({ currencyId: "currency-usd" }),
                "currency-inr"
            )
        ).toMatchObject({ ok: false });
    });
});
