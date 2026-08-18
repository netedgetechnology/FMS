import {
    CategoryType,
    FinanceScope,
} from ".";

export interface UpdateCategoryRequest {
    id: string;

    parentId?: string | null;

    name: string;

    categoryType: CategoryType;

    financeScope: FinanceScope;

    businessEntityId?: string | null;

    description?: string | null;

    isActive: boolean;
}
