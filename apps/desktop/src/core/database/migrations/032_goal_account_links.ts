import { IMigration } from "../types/IMigration";

export const GoalAccountLinksMigration: IMigration = {
    version: 32,
    name: "Goal Account Links",
    sql: `

ALTER TABLE goals
ADD COLUMN goal_mode TEXT NOT NULL DEFAULT 'MANUAL';

CREATE TABLE IF NOT EXISTS goal_account_links (
    id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    FOREIGN KEY (goal_id) REFERENCES goals(id),
    FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_goal_account_links_goal
ON goal_account_links(goal_id);

CREATE INDEX IF NOT EXISTS idx_goal_account_links_account
ON goal_account_links(account_id);

`
};
