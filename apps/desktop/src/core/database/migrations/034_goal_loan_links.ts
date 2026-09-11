import { IMigration } from "../types/IMigration";

export const GoalLoanLinksMigration: IMigration = {
    version: 34,
    name: "Goal Loan Links",
    sql: `

CREATE TABLE IF NOT EXISTS goal_loan_links (
    id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL,
    loan_id TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    FOREIGN KEY (goal_id) REFERENCES goals(id),
    FOREIGN KEY (loan_id) REFERENCES loans(id)
);

CREATE INDEX IF NOT EXISTS idx_goal_loan_links_goal
ON goal_loan_links(goal_id);

CREATE INDEX IF NOT EXISTS idx_goal_loan_links_loan
ON goal_loan_links(loan_id);

`
};
