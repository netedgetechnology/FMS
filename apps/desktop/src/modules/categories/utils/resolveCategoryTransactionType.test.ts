import { describe, expect, it } from "vitest";

import type { Category } from "../types/Category";
import type { CategoryContextMapping } from "../types/CategoryContextMapping";

import {
    isLockedResolution,
    resolveCategoryTransactionType,
} from "./resolveCategoryTransactionType";

const salaryCategory: Category = {
    id: "cat-salary",
    parentId: null,
    name: "Salary",
    categoryType: "INCOME",
    financeScope: "PERSONAL",
    businessEntityId: null,
    description: null,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
};

function mapping(
    overrides: Partial<CategoryContextMapping>
): CategoryContextMapping {
    return {
        id: "map-1",
        categoryId: "cat-salary",
        accountId: null,
        businessEntityId: null,
        categoryType: "EXPENSE",
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

describe("resolveCategoryTransactionType", () => {
    it("1. resolves a business-entity-specific mapping (Salary + Netedge Technology -> Expense)", () => {
        const result = resolveCategoryTransactionType({
            categoryId: "cat-salary",
            accountId: "acct-netedge",
            businessEntityId: "entity-netedge",
            mappings: [
                mapping({
                    businessEntityId: "entity-netedge",
                    categoryType: "EXPENSE",
                }),
            ],
            categories: [salaryCategory],
        });

        expect(result).toEqual({
            categoryType: "EXPENSE",
            source: "business-entity",
        });
    });

    it("2. resolves an account-specific mapping (Salary + Family Account -> Income)", () => {
        const result = resolveCategoryTransactionType({
            categoryId: "cat-salary",
            accountId: "acct-family",
            businessEntityId: null,
            mappings: [
                mapping({
                    accountId: "acct-family",
                    categoryType: "INCOME",
                }),
            ],
            categories: [salaryCategory],
        });

        expect(result).toEqual({
            categoryType: "INCOME",
            source: "account",
        });
    });

    it("3. a personal account with no business entity and no mapping falls back to the category's default type", () => {
        const result = resolveCategoryTransactionType({
            categoryId: "cat-salary",
            accountId: "acct-family",
            businessEntityId: null,
            mappings: [],
            categories: [salaryCategory],
        });

        expect(result).toEqual({
            categoryType: "INCOME",
            source: "default",
        });
    });

    it("4. the same category resolves differently as Income vs Expense in different contexts", () => {
        const mappings = [
            mapping({
                accountId: "acct-family",
                categoryType: "INCOME",
            }),
            mapping({
                id: "map-2",
                businessEntityId: "entity-netedge",
                categoryType: "EXPENSE",
            }),
        ];

        const personal = resolveCategoryTransactionType({
            categoryId: "cat-salary",
            accountId: "acct-family",
            businessEntityId: null,
            mappings,
            categories: [salaryCategory],
        });

        const business = resolveCategoryTransactionType({
            categoryId: "cat-salary",
            accountId: "acct-netedge",
            businessEntityId: "entity-netedge",
            mappings,
            categories: [salaryCategory],
        });

        expect(personal.categoryType).toBe("INCOME");
        expect(business.categoryType).toBe("EXPENSE");
    });

    it("5. an account-specific mapping takes priority over a business-entity mapping on the same account", () => {
        const result = resolveCategoryTransactionType({
            categoryId: "cat-salary",
            accountId: "acct-netedge",
            businessEntityId: "entity-netedge",
            mappings: [
                mapping({
                    businessEntityId: "entity-netedge",
                    categoryType: "EXPENSE",
                }),
                mapping({
                    id: "map-2",
                    accountId: "acct-netedge",
                    categoryType: "INCOME",
                }),
            ],
            categories: [salaryCategory],
        });

        expect(result).toEqual({
            categoryType: "INCOME",
            source: "account",
        });
    });

    it("6. changing the account after a category is selected recalculates the resolution", () => {
        const mappings = [
            mapping({
                accountId: "acct-family",
                categoryType: "INCOME",
            }),
        ];

        const withMappedAccount = resolveCategoryTransactionType({
            categoryId: "cat-salary",
            accountId: "acct-family",
            businessEntityId: null,
            mappings,
            categories: [salaryCategory],
        });

        const withUnmappedAccount = resolveCategoryTransactionType({
            categoryId: "cat-salary",
            accountId: "acct-other",
            businessEntityId: null,
            mappings,
            categories: [salaryCategory],
        });

        expect(withMappedAccount.source).toBe("account");
        expect(withUnmappedAccount.source).toBe("default");
    });

    it("7. changing the category after an account is selected recalculates the resolution", () => {
        const mappings = [
            mapping({
                categoryId: "cat-salary",
                accountId: "acct-family",
                categoryType: "INCOME",
            }),
        ];

        const groceries: Category = {
            ...salaryCategory,
            id: "cat-groceries",
            name: "Groceries",
            categoryType: "EXPENSE",
        };

        const salaryResult = resolveCategoryTransactionType({
            categoryId: "cat-salary",
            accountId: "acct-family",
            businessEntityId: null,
            mappings,
            categories: [salaryCategory, groceries],
        });

        const groceriesResult = resolveCategoryTransactionType({
            categoryId: "cat-groceries",
            accountId: "acct-family",
            businessEntityId: null,
            mappings,
            categories: [salaryCategory, groceries],
        });

        expect(salaryResult).toEqual({
            categoryType: "INCOME",
            source: "account",
        });
        expect(groceriesResult).toEqual({
            categoryType: "EXPENSE",
            source: "default",
        });
    });

    it("8. no category selected requires an explicit transaction type", () => {
        const result = resolveCategoryTransactionType({
            categoryId: null,
            accountId: "acct-family",
            businessEntityId: null,
            mappings: [],
            categories: [salaryCategory],
        });

        expect(result).toEqual({ categoryType: null, source: null });
    });

    it("9. an inactive mapping is ignored, falling back to the next tier", () => {
        const result = resolveCategoryTransactionType({
            categoryId: "cat-salary",
            accountId: "acct-family",
            businessEntityId: null,
            mappings: [
                mapping({
                    accountId: "acct-family",
                    categoryType: "EXPENSE",
                    isActive: false,
                }),
            ],
            categories: [salaryCategory],
        });

        expect(result).toEqual({
            categoryType: "INCOME",
            source: "default",
        });
    });
});

describe("isLockedResolution", () => {
    it("locks for an account-specific resolution", () => {
        expect(
            isLockedResolution({
                categoryType: "INCOME",
                source: "account",
            })
        ).toBe(true);
    });

    it("locks for a business-entity-specific resolution", () => {
        expect(
            isLockedResolution({
                categoryType: "EXPENSE",
                source: "business-entity",
            })
        ).toBe(true);
    });

    it("does not lock for the category's own default resolution", () => {
        expect(
            isLockedResolution({
                categoryType: "INCOME",
                source: "default",
            })
        ).toBe(false);
    });

    it("does not lock when nothing resolved", () => {
        expect(
            isLockedResolution({ categoryType: null, source: null })
        ).toBe(false);
    });
});
