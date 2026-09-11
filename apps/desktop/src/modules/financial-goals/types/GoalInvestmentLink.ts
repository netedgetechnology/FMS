export interface GoalInvestmentLink {
    id: string;
    goalId: string;
    investmentId: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface CreateGoalInvestmentLinkRequest {
    goalId: string;
    investmentId: string;
}
