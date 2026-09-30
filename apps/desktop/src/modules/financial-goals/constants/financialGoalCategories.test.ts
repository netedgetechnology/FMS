import { describe, expect, it } from "vitest";

import {
    getFinancialGoalCategory,
    getFinancialGoalSubcategoryLabel,
} from "./financialGoalCategories";

// Regression coverage for the Financial Goal Details popup showing raw
// stored enum values ("CORE_PERSONAL_FINANCE", "SAVINGS") instead of the
// application's existing human-readable labels ("Core Personal Finance",
// "Savings"). The database columns are untouched - the popup now looks
// these labels up through the same shared mapping instead of rendering
// the stored value directly.
describe("getFinancialGoalCategory - label lookup", () => {
    it("resolves the reported CORE_PERSONAL_FINANCE value to its label", () => {
        expect(
            getFinancialGoalCategory(
                "CORE_PERSONAL_FINANCE"
            )?.label
        ).toBe("Core Personal Finance");
    });

    it("returns undefined for an unknown category rather than throwing", () => {
        expect(
            getFinancialGoalCategory("NOT_A_CATEGORY")
        ).toBeUndefined();
    });
});

describe("getFinancialGoalSubcategoryLabel", () => {
    it("resolves the reported SAVINGS value to its label", () => {
        expect(
            getFinancialGoalSubcategoryLabel(
                "CORE_PERSONAL_FINANCE",
                "SAVINGS"
            )
        ).toBe("Savings");
    });

    it("falls back to the raw subcategory value when it isn't recognized", () => {
        expect(
            getFinancialGoalSubcategoryLabel(
                "CORE_PERSONAL_FINANCE",
                "NOT_A_SUBCATEGORY"
            )
        ).toBe("NOT_A_SUBCATEGORY");
    });

    it("falls back to the raw value when the category itself isn't recognized", () => {
        expect(
            getFinancialGoalSubcategoryLabel(
                "NOT_A_CATEGORY",
                "SAVINGS"
            )
        ).toBe("SAVINGS");
    });
});
