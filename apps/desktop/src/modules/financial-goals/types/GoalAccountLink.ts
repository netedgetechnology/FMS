export interface GoalAccountLink {
    id: string;
    goalId: string;
    accountId: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface CreateGoalAccountLinkRequest {
    goalId: string;
    accountId: string;
}
