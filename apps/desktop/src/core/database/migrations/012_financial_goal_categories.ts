import { IMigration } from "../types/IMigration";

export const FinancialGoalCategoriesMigration: IMigration = {
    version: 12,
    name: "Financial Goal Categories",
    sql: `

ALTER TABLE goals
ADD COLUMN goal_category TEXT;

ALTER TABLE goals
ADD COLUMN goal_subcategory TEXT;

UPDATE goals
SET
    goal_category = CASE
        WHEN goal_type IN (
            'RETIREMENT',
            'WEALTH_BUILDING',
            'INVESTMENT_GROWTH',
            'FINANCIAL_INDEPENDENCE',
            'ESTATE_PLANNING'
        ) THEN 'LONG_TERM_WEALTH'

        WHEN goal_type IN (
            'DEBT_REDUCTION',
            'CREDIT_CARD_PAYOFF',
            'LOAN_REPAYMENT',
            'MORTGAGE_PAYOFF'
        ) THEN 'DEBT_LIABILITIES'

        WHEN goal_type IN (
            'BUSINESS_FINANCE',
            'BUSINESS_EXPANSION',
            'WORKING_CAPITAL',
            'BUSINESS_INVESTMENT',
            'PROFESSIONAL_DEVELOPMENT'
        ) THEN 'BUSINESS_PROFESSIONAL'

        WHEN goal_type IN (
            'INSURANCE_RESERVE',
            'MEDICAL_RESERVE',
            'EMERGENCY_PREPAREDNESS',
            'FAMILY_PROTECTION'
        ) THEN 'PROTECTION_RISK'

        WHEN goal_type IN (
            'TAX_RESERVE',
            'TAX_SAVING',
            'TAX_PLANNING',
            'COMPLIANCE_RESERVE'
        ) THEN 'TAX_COMPLIANCE'

        WHEN goal_type IN (
            'WEDDING',
            'TRAVEL',
            'FAMILY_EVENT',
            'PERSONAL_MILESTONE',
            'OTHER'
        ) THEN 'LIFESTYLE_MAJOR_MILESTONES'

        ELSE 'CORE_PERSONAL_FINANCE'
    END,

    goal_subcategory = CASE
        WHEN goal_type IS NULL OR TRIM(goal_type) = ''
            THEN 'SAVINGS'
        ELSE goal_type
    END

WHERE goal_category IS NULL
   OR goal_subcategory IS NULL;

CREATE INDEX IF NOT EXISTS idx_goals_category
ON goals(goal_category);

CREATE INDEX IF NOT EXISTS idx_goals_subcategory
ON goals(goal_subcategory);

`
};
