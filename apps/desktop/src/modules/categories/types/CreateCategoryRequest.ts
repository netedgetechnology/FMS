import {
    CategoryType,
    FinanceScope,
} from ".";

export interface CreateCategoryRequest {
    parentId?: string | null;

    name: string;

    categoryType: CategoryType;

    financeScope: FinanceScope;

    businessEntityId?: string | null;

    description?: string | null;

    isActive?: boolean;
}
