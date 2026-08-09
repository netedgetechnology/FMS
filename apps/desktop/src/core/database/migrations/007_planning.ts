import { IMigration } from "../types/IMigration";

export const PlanningMigration: IMigration = {
    version: 7,
    name: "Financial Planning",
    sql: `

CREATE TABLE IF NOT EXISTS financial_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    plan_type TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT,
    currency_id TEXT NOT NULL,
    target_amount REAL,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    FOREIGN KEY (currency_id) REFERENCES currencies(id)
);

CREATE TABLE IF NOT EXISTS budgets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category_id TEXT,
    business_entity_id TEXT,
    amount REAL NOT NULL,
    period_type TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT,
    currency_id TEXT NOT NULL,
    alert_threshold REAL NOT NULL DEFAULT 80,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    FOREIGN KEY (category_id) REFERENCES categories(id),
    FOREIGN KEY (business_entity_id) REFERENCES business_entities(id),
    FOREIGN KEY (currency_id) REFERENCES currencies(id)
);

CREATE INDEX IF NOT EXISTS idx_budgets_category
ON budgets(category_id);

CREATE INDEX IF NOT EXISTS idx_budgets_dates
ON budgets(start_date, end_date);

CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    goal_type TEXT NOT NULL,
    target_amount REAL NOT NULL,
    current_amount REAL NOT NULL DEFAULT 0,
    currency_id TEXT NOT NULL,
    target_date TEXT,
    priority INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    FOREIGN KEY (currency_id) REFERENCES currencies(id)
);

CREATE INDEX IF NOT EXISTS idx_goals_status
ON goals(status);

CREATE INDEX IF NOT EXISTS idx_goals_target_date
ON goals(target_date);

`
};
