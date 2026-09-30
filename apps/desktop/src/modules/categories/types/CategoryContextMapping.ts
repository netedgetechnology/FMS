import { CategoryType } from "./CategoryType";

// A mapping's own transaction direction. Only INCOME/EXPENSE make sense
// as a context-specific override - TRANSFER stays a whole-category
// classification on Category.categoryType and is never mapped here
// (enforced by a CHECK constraint in migration 038).
export type CategoryMappingType = Extract<CategoryType, "INCOME" | "EXPENSE">;

export interface CategoryContextMapping {
    id: string;

    categoryId: string;

    // Exactly one of accountId/businessEntityId is set - never both,
    // never neither (enforced by a CHECK constraint in migration 038).
    accountId: string | null;

    businessEntityId: string | null;

    categoryType: CategoryMappingType;

    isActive: boolean;

    createdAt: string;

    updatedAt: string;
}

export interface CreateCategoryContextMappingRequest {
    categoryId: string;

    accountId?: string | null;

    businessEntityId?: string | null;

    categoryType: CategoryMappingType;

    isActive?: boolean;
}

export interface UpdateCategoryContextMappingRequest {
    id: string;

    accountId?: string | null;

    businessEntityId?: string | null;

    categoryType?: CategoryMappingType;

    isActive?: boolean;
}
