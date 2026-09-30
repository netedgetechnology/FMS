import {
    CategoryType,
} from ".";

// Category details only. A category's scope (finance_scope) is changed
// solely from the Scopes screen - CategoryService.updateScopes.
export interface UpdateCategoryRequest {
    id: string;

    parentId?: string | null;

    name: string;

    categoryType: CategoryType;

    businessEntityId?: string | null;

    description?: string | null;

    isActive: boolean;
}
