export interface GoalLoanLink {
    id: string;
    goalId: string;
    loanId: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface CreateGoalLoanLinkRequest {
    goalId: string;
    loanId: string;
}
