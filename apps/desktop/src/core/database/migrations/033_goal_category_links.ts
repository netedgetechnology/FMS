import { IMigration } from "../types/IMigration";

export const GoalCategoryLinksMigration: IMigration = {
    version: 33,
    name: "Goal Category Links",
    sql: `

CREATE TABLE IF NOT EXISTS goal_category_links (
    id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    FOREIGN KEY (goal_id) REFERENCES goals(id),
    FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE INDEX IF NOT EXISTS idx_goal_category_links_goal
ON goal_category_links(goal_id);

CREATE INDEX IF NOT EXISTS idx_goal_category_links_category
ON goal_category_links(category_id);

`
};
