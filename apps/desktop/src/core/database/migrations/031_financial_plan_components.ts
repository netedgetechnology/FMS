import { IMigration } from "../types/IMigration";

export const FinancialPlanComponentsMigration: IMigration = {
    version: 31,
    name: "Financial Plan Components",
    // Phase 2 - Components & Sources.
    //
    // A Financial Plan Component is a typed, read-only reference from one
    // plan to ONE existing FinWea source (an account, a category, an
    // investment or a loan). It declares WHICH real-money quantity of
    // that source feeds the plan and HOW (`role`).
    //
    //   component_type : ACCOUNT | CATEGORY | INVESTMENT | LOAN
    //   role           : ASSET | LIABILITY | CONTRIBUTION | SPENDING
    //
    // There is NO GOAL component - financial_plans.goal_id remains the
    // sole Plan -> Goal reference (Phase 1) and never feeds a value.
    //
    // Exactly one of account_id / category_id / investment_id / loan_id
    // is set, matching component_type. No source figure (balance, market
    // value, outstanding amount, transaction total, ...) is copied onto
    // this table - the value is always derived live from the source
    // (Phase 3). Phase 2 stores NO actual / progress / projection value.
    //
    // Pure DDL: one CREATE TABLE + its indexes. No data, no backfill.
    // Every existing plan stays valid with zero components. Re-running is
    // a no-op (IF NOT EXISTS + the schema_version gate).
    //
    // Restore mapping (documented for a future full-restore flow):
    //   backup financial_plan_components -> FinWea financial_plan_components (1:1)
    //   each source FK -> the same row id in accounts / categories /
    //   investments / loans (already covered by the DB snapshot).
    sql: `
CREATE TABLE IF NOT EXISTS financial_plan_components (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL,
    component_type TEXT NOT NULL,
    role TEXT NOT NULL,
    account_id TEXT,
    category_id TEXT,
    investment_id TEXT,
    loan_id TEXT,
    label TEXT,
    target_amount REAL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    FOREIGN KEY (plan_id) REFERENCES financial_plans(id),
    FOREIGN KEY (account_id) REFERENCES accounts(id),
    FOREIGN KEY (category_id) REFERENCES categories(id),
    FOREIGN KEY (investment_id) REFERENCES investments(id),
    FOREIGN KEY (loan_id) REFERENCES loans(id)
);

CREATE INDEX IF NOT EXISTS idx_financial_plan_components_plan
ON financial_plan_components(plan_id);

CREATE INDEX IF NOT EXISTS idx_financial_plan_components_account
ON financial_plan_components(account_id);

CREATE INDEX IF NOT EXISTS idx_financial_plan_components_category
ON financial_plan_components(category_id);

CREATE INDEX IF NOT EXISTS idx_financial_plan_components_investment
ON financial_plan_components(investment_id);

CREATE INDEX IF NOT EXISTS idx_financial_plan_components_loan
ON financial_plan_components(loan_id);
`
};
