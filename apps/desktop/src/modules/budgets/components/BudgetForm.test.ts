import { describe, expect, it } from "vitest";

import type { Category } from "@/modules/categories/types";

import { resolveBudgetCategoryOptions } from "./BudgetForm";

// This repo has no jsdom / component-render test setup (vitest runs
// with environment: "node") - see DeletePlanComponentDialog.test.ts for
// the same convention - so the Edit Budget form's Category <select>
// options are exercised through the exported pure function instead of
// rendering the form.
//
// Regression: editing "Festival Shopping" (category_id points to the
// real, existing "Shopping" category row, which was soft-deleted after
// the budget was created) showed "All Categories" in the Category
// field instead of the stored selection. Root cause: useCategories()
// filters deleted_at IS NULL, so a soft-deleted category never appears
// in `categories` at all - the <select> had no <option> whose value
// matched the stored categoryId, and a native <select> silently falls
// back to its first option ("All Categories") when that happens. Since
// react-hook-form reads an uncontrolled select's value straight from
// the DOM, saving without ever touching this field would have silently
// submitted that fallback - converting a category-specific budget into
// an overall one.

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
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        ...overrides,
    };
}

const SHOPPING_ID =
    "5dab159b-05f8-4f7e-a0a4-dabf017aa241";

describe("resolveBudgetCategoryOptions", () => {
    it("returns only eligible (active EXPENSE) categories when the budget has no category (overall budget)", () => {
        const options = resolveBudgetCategoryOptions(
            [
                category({ id: "cat-food" }),
                category({
                    id: "cat-income",
                    categoryType: "INCOME",
                }),
            ],
            false,
            null
        );

        expect(
            options.map(option => option.id)
        ).toEqual(["cat-food"]);
    });

    it("returns the current category unchanged when it's already eligible", () => {
        const options = resolveBudgetCategoryOptions(
            [category({ id: "cat-food" })],
            false,
            "cat-food"
        );

        expect(
            options.map(option => option.id)
        ).toEqual(["cat-food"]);
    });

    it("still includes the current category when it exists but is deactivated/retyped (existing behavior, preserved)", () => {
        const deactivated = category({
            id: "cat-old",
            isActive: false,
        });

        const options = resolveBudgetCategoryOptions(
            [
                deactivated,
                category({ id: "cat-food" }),
            ],
            false,
            "cat-old"
        );

        expect(options[0]).toBe(deactivated);
        expect(
            options.map(option => option.id)
        ).toContain("cat-food");
    });

    // The actual reported bug's exact scenario.
    it("1/2/3. synthesizes a placeholder option for a soft-deleted category, once categories have finished loading, so the stored id always has a matching <option>", () => {
        const options = resolveBudgetCategoryOptions(
            [category({ id: "cat-food" })],
            false,
            SHOPPING_ID
        );

        expect(options[0].id).toBe(SHOPPING_ID);
        expect(options[0].name).toBe(
            "Unknown category"
        );
        expect(options[0].isActive).toBe(false);
        expect(
            options.map(option => option.id)
        ).toContain("cat-food");
    });

    it("4. never fabricates a placeholder for a category that's simply still loading - avoids a false 'deleted' flash for a perfectly normal category", () => {
        const options = resolveBudgetCategoryOptions(
            [],
            true,
            SHOPPING_ID
        );

        // No fabricated entry - the stored id is absent until loading
        // finishes, at which point the effect that re-asserts the
        // form's value (and this function, called again on the next
        // render) resolve it correctly.
        expect(
            options.some(
                option => option.id === SHOPPING_ID
            )
        ).toBe(false);
    });

    it("does nothing special when there is no stored category at all, even while categories are still loading", () => {
        const options = resolveBudgetCategoryOptions(
            [],
            true,
            undefined
        );

        expect(options).toEqual([]);
    });
});
