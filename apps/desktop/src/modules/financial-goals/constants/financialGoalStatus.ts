import type { FinancialGoalStatus } from "../types/FinancialGoal";

export const FINANCIAL_GOAL_STATUS_LABELS: Record<
    FinancialGoalStatus,
    string
> = {
    ACTIVE: "Active",
    COMPLETED: "Completed",
    PAUSED: "Paused",
    CANCELLED: "Cancelled",
};

export function getFinancialGoalStatusLabel(
    value: string
): string {
    return (
        FINANCIAL_GOAL_STATUS_LABELS[
            value as FinancialGoalStatus
        ] ?? value
    );
}
