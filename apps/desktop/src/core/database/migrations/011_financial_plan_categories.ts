import { IMigration } from "../types/IMigration";

export const FinancialPlanCategoriesMigration: IMigration = {
    version: 11,
    name: "Financial Plan Categories",
    sql: `

ALTER TABLE financial_plans
ADD COLUMN plan_category TEXT;

ALTER TABLE financial_plans
ADD COLUMN plan_subcategory TEXT;

UPDATE financial_plans
SET
    plan_category = CASE
        WHEN plan_type = 'RETIREMENT'
            THEN 'LONG_TERM_WEALTH'
        WHEN plan_type = 'WEALTH_BUILDING'
            THEN 'LONG_TERM_WEALTH'
        WHEN plan_type = 'DEBT_REDUCTION'
            THEN 'DEBT_LIABILITIES'
        WHEN plan_type = 'ANNUAL'
            THEN 'CORE_PERSONAL_FINANCE'
        ELSE 'CORE_PERSONAL_FINANCE'
    END,
    plan_subcategory = CASE
        WHEN plan_type = 'RETIREMENT'
            THEN 'RETIREMENT'
        WHEN plan_type = 'WEALTH_BUILDING'
            THEN 'WEALTH_BUILDING'
        WHEN plan_type = 'DEBT_REDUCTION'
            THEN 'DEBT_REDUCTION'
        WHEN plan_type = 'ANNUAL'
            THEN 'ANNUAL_EXPENSES'
        ELSE 'SAVINGS'
    END
WHERE plan_category IS NULL
   OR plan_subcategory IS NULL;

CREATE INDEX IF NOT EXISTS idx_financial_plans_category
ON financial_plans(plan_category);

CREATE INDEX IF NOT EXISTS idx_financial_plans_subcategory
ON financial_plans(plan_subcategory);

`
};
