import { IMigration } from "../types/IMigration";

export const GoalInvestmentLinksMigration: IMigration = {
    version: 35,
    name: "Goal Investment Links",
    sql: `

CREATE TABLE IF NOT EXISTS goal_investment_links (
    id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL,
    investment_id TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    FOREIGN KEY (goal_id) REFERENCES goals(id),
    FOREIGN KEY (investment_id) REFERENCES investments(id)
);

CREATE INDEX IF NOT EXISTS idx_goal_investment_links_goal
ON goal_investment_links(goal_id);

CREATE INDEX IF NOT EXISTS idx_goal_investment_links_investment
ON goal_investment_links(investment_id);

`
};
