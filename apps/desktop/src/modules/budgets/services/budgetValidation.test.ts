import { describe, expect, it } from "vitest";

import type { BusinessEntity } from "@/modules/business-entities/types";
import type { Category } from "@/modules/categories/types";
import type { Currency } from "@/modules/currencies/types";

import type { Budget } from "../types";

import {
    budgetIdentitiesConflict,
    budgetMonthRangesOverlap,
    findConflictingBudget,
    validateBudgetBusinessEntity,
    validateBudgetCategory,
    validateBudgetCurrency,
    validateBudgetFields,
    type BudgetFieldInput,
} from "./budgetValidation";

function fields(
    overrides: Partial<BudgetFieldInput> = {}
): BudgetFieldInput {
    return {
        name: "Groceries",
        amount: 10000,
        periodType: "MONTHLY",
        startDate: "2026-09-01",
        endDate: null,
        currencyId: "currency-inr",
        ...overrides,
    };
}

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
        currencyId: "currency-inr",
        alertThreshold: 80,
        isActive: true,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
        ...overrides,
    };
}

describe("validateBudgetFields", () => {
    it("accepts a well-formed budget", () => {
        expect(validateBudgetFields(fields())).toBeNull();
    });

    it("requires a name", () => {
        expect(
            validateBudgetFields(fields({ name: "   " }))
        ).toMatch(/name is required/i);
    });

    it("rejects a negative amount", () => {
        expect(
            validateBudgetFields(fields({ amount: -1 }))
        ).toMatch(/zero or more/i);
    });

    it("allows a zero amount", () => {
        expect(
            validateBudgetFields(fields({ amount: 0 }))
        ).toBeNull();
    });

    it("rejects a non-finite amount", () => {
        expect(
            validateBudgetFields(fields({ amount: Number.NaN }))
        ).not.toBeNull();
    });

    it("rejects an unknown period type", () => {
        expect(
            validateBudgetFields(
                fields({ periodType: "WEEKLY" })
            )
        ).toMatch(/valid budget period/i);
    });

    it("rejects a missing or malformed start date", () => {
        expect(
            validateBudgetFields(fields({ startDate: "" }))
        ).not.toBeNull();

        expect(
            validateBudgetFields(
                fields({ startDate: "2026-13-40" })
            )
        ).not.toBeNull();
    });

    it("rejects an end date before the start date", () => {
        expect(
            validateBudgetFields(
                fields({
                    periodType: "CUSTOM",
                    startDate: "2026-09-10",
                    endDate: "2026-09-01",
                })
            )
        ).toMatch(/before the start date/i);
    });

    it("requires an end date for a CUSTOM period", () => {
        expect(
            validateBudgetFields(
                fields({ periodType: "CUSTOM", endDate: null })
            )
        ).toMatch(/end date/i);
    });

    it("requires a currency", () => {
        expect(
            validateBudgetFields(fields({ currencyId: "" }))
        ).toMatch(/currency is required/i);
    });
});

describe("validateBudgetCategory", () => {
    it("accepts a null category (intentional overall budget)", () => {
        expect(
            validateBudgetCategory(null, undefined)
        ).toEqual({ ok: true });
    });

    it("accepts an active EXPENSE category", () => {
        expect(
            validateBudgetCategory("cat-food", category()).ok
        ).toBe(true);
    });

    it("rejects a category that no longer exists", () => {
        expect(
            validateBudgetCategory("cat-food", null)
        ).toMatchObject({ ok: false });
    });

    it("rejects an INCOME category", () => {
        expect(
            validateBudgetCategory(
                "cat-salary",
                category({ id: "cat-salary", categoryType: "INCOME" })
            )
        ).toMatchObject({ ok: false });
    });

    it("rejects a TRANSFER category", () => {
        expect(
            validateBudgetCategory(
                "cat-xfer",
                category({ id: "cat-xfer", categoryType: "TRANSFER" })
            )
        ).toMatchObject({ ok: false });
    });

    it("rejects an inactive EXPENSE category", () => {
        expect(
            validateBudgetCategory(
                "cat-food",
                category({ isActive: false })
            )
        ).toMatchObject({ ok: false });
    });
});

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

describe("validateBudgetCurrency", () => {
    it("accepts an existing currency", () => {
        expect(
            validateBudgetCurrency(currency())
        ).toEqual({ ok: true });
    });

    it("rejects a currency that no longer exists", () => {
        expect(
            validateBudgetCurrency(null)
        ).toMatchObject({ ok: false });

        expect(
            validateBudgetCurrency(undefined)
        ).toMatchObject({ ok: false });
    });
});

describe("validateBudgetBusinessEntity", () => {
    it("accepts a null entity (unscoped budget) without needing a record", () => {
        expect(
            validateBudgetBusinessEntity(null, undefined)
        ).toEqual({ ok: true });
    });

    it("accepts a supplied entity that exists and is active", () => {
        expect(
            validateBudgetBusinessEntity(
                "entity-1",
                entity()
            ).ok
        ).toBe(true);
    });

    it("rejects a supplied entity that no longer exists", () => {
        expect(
            validateBudgetBusinessEntity("entity-1", null)
        ).toMatchObject({ ok: false });
    });

    it("rejects a supplied entity that is inactive", () => {
        expect(
            validateBudgetBusinessEntity(
                "entity-1",
                entity({ isActive: false })
            )
        ).toMatchObject({ ok: false });
    });
});

describe("budgetMonthRangesOverlap", () => {
    it("open-ended monthly budgets always overlap", () => {
        expect(
            budgetMonthRangesOverlap(
                { startDate: "2026-09-01", endDate: null },
                { startDate: "2026-11-01", endDate: null }
            )
        ).toBe(true);
    });

    it("bounded ranges in different months do not overlap", () => {
        expect(
            budgetMonthRangesOverlap(
                { startDate: "2026-09-01", endDate: "2026-09-30" },
                { startDate: "2026-10-01", endDate: "2026-10-31" }
            )
        ).toBe(false);
    });

    it("a mid-month start still shares the calendar month", () => {
        expect(
            budgetMonthRangesOverlap(
                { startDate: "2026-09-30", endDate: null },
                { startDate: "2026-09-01", endDate: "2026-09-15" }
            )
        ).toBe(true);
    });
});

describe("budgetIdentitiesConflict", () => {
    const base = {
        categoryId: "cat-food",
        currencyId: "currency-inr",
        businessEntityId: null,
        startDate: "2026-09-01",
        endDate: null,
    };

    it("same category + currency + entity + overlapping months conflicts", () => {
        expect(
            budgetIdentitiesConflict(base, { ...base })
        ).toBe(true);
    });

    it("different currency does not conflict", () => {
        expect(
            budgetIdentitiesConflict(base, {
                ...base,
                currencyId: "currency-usd",
            })
        ).toBe(false);
    });

    it("different business entity does not conflict", () => {
        expect(
            budgetIdentitiesConflict(base, {
                ...base,
                businessEntityId: "entity-2",
            })
        ).toBe(false);
    });

    it("different category does not conflict", () => {
        expect(
            budgetIdentitiesConflict(base, {
                ...base,
                categoryId: "cat-travel",
            })
        ).toBe(false);
    });

    it("null vs null category (both overall) conflicts on overlap", () => {
        expect(
            budgetIdentitiesConflict(
                { ...base, categoryId: null },
                { ...base, categoryId: null }
            )
        ).toBe(true);
    });

    it("null category does not conflict with a specific category", () => {
        expect(
            budgetIdentitiesConflict(
                { ...base, categoryId: null },
                { ...base, categoryId: "cat-food" }
            )
        ).toBe(false);
    });

    it("non-overlapping months do not conflict even with everything else equal", () => {
        expect(
            budgetIdentitiesConflict(
                { ...base, startDate: "2026-09-01", endDate: "2026-09-30" },
                { ...base, startDate: "2026-10-01", endDate: "2026-10-31" }
            )
        ).toBe(false);
    });
});

describe("findConflictingBudget", () => {
    const existing = [
        makeBudget({ id: "b-food", categoryId: "cat-food" }),
        makeBudget({ id: "b-travel", categoryId: "cat-travel" }),
        makeBudget({ id: "b-food-inactive", categoryId: "cat-food", isActive: false }),
    ];

    it("finds an active duplicate for the same category", () => {
        const conflict = findConflictingBudget(
            {
                categoryId: "cat-food",
                currencyId: "currency-inr",
                businessEntityId: null,
                startDate: "2026-09-01",
                endDate: null,
            },
            existing
        );

        expect(conflict?.id).toBe("b-food");
    });

    it("excludes the budget being edited (self by id)", () => {
        const conflict = findConflictingBudget(
            {
                id: "b-food",
                categoryId: "cat-food",
                currencyId: "currency-inr",
                businessEntityId: null,
                startDate: "2026-09-01",
                endDate: null,
            },
            existing
        );

        expect(conflict).toBeNull();
    });

    it("ignores inactive budgets", () => {
        const conflict = findConflictingBudget(
            {
                categoryId: "cat-food",
                currencyId: "currency-inr",
                businessEntityId: null,
                startDate: "2026-09-01",
                endDate: null,
            },
            [existing[2]] // only the inactive one
        );

        expect(conflict).toBeNull();
    });

    it("returns null when nothing matches", () => {
        const conflict = findConflictingBudget(
            {
                categoryId: "cat-groceries",
                currencyId: "currency-inr",
                businessEntityId: null,
                startDate: "2026-09-01",
                endDate: null,
            },
            existing
        );

        expect(conflict).toBeNull();
    });
});
