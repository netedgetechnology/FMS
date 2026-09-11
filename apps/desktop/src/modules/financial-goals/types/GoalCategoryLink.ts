export interface GoalCategoryLink {
    id: string;
    goalId: string;
    categoryId: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface CreateGoalCategoryLinkRequest {
    goalId: string;
    categoryId: string;
}
