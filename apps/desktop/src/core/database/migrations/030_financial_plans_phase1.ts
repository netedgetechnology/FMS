import { IMigration } from "../types/IMigration";

export const FinancialPlansPhase1Migration: IMigration = {
    version: 30,
    name: "Financial Plans Phase 1",
    // Phase 1 turns a Financial Plan into a proper strategy shell:
    //
    //  - period_type: the calendar cadence a plan is measured / reported
    //    at (MONTHLY | QUARTERLY | YEARLY | ONE_TIME). Not the horizon
    //    (that is start_date / end_date).
    //  - goal_id: optional 1:1 link to a Goal (Plan -> Goal only). The
    //    Goal keeps every financial figure - nothing is copied here.
    //  - plan_type is REPURPOSED: it used to be a redundant echo of the
    //    subcategory; it is now a 5-value strategy archetype
    //    (ACCUMULATION | DEBT_PAYOFF | EXPENSE_PLAN | CASHFLOW_TARGET |
    //     PORTFOLIO_GROWTH) that routes Phase 2 derivation.
    //
    // ALTER-only, no table rebuild. Every existing row - INCLUDING
    // soft-deleted ones - is preserved as-is except that plan_type is
    // remapped and NULL/blank taxonomy is filled. No user-set taxonomy
    // value is changed. The remap / period / taxonomy UPDATEs are all
    // guarded so a re-run is a no-op.
    //
    // plan_type remap (safest semantically defensible mapping; user
    // intent is never invented, unmatched rows fall through to
    // ACCUMULATION = "money growing toward a number"):
    //   debt category / subcategory / old type -> DEBT_PAYOFF
    //   old 'ANNUAL' / ANNUAL_EXPENSES         -> EXPENSE_PLAN
    //   INVESTMENT_GROWTH / BUSINESS_INVESTMENT -> PORTFOLIO_GROWTH
    //   WORKING_CAPITAL / BUSINESS_FINANCE      -> CASHFLOW_TARGET
    //   everything else                         -> ACCUMULATION
    sql: `
ALTER TABLE financial_plans
ADD COLUMN period_type TEXT NOT NULL DEFAULT 'MONTHLY';

ALTER TABLE financial_plans
ADD COLUMN goal_id TEXT REFERENCES goals(id);

UPDATE financial_plans
SET plan_type = CASE
    WHEN plan_category = 'DEBT_LIABILITIES'
        OR plan_type IN ('DEBT_REDUCTION', 'CREDIT_CARD_PAYOFF', 'LOAN_REPAYMENT', 'MORTGAGE_PAYOFF')
        OR plan_subcategory IN ('DEBT_REDUCTION', 'CREDIT_CARD_PAYOFF', 'LOAN_REPAYMENT', 'MORTGAGE_PAYOFF')
            THEN 'DEBT_PAYOFF'
    WHEN plan_type = 'ANNUAL'
        OR plan_subcategory = 'ANNUAL_EXPENSES'
            THEN 'EXPENSE_PLAN'
    WHEN plan_subcategory IN ('INVESTMENT_GROWTH', 'BUSINESS_INVESTMENT')
            THEN 'PORTFOLIO_GROWTH'
    WHEN plan_subcategory IN ('WORKING_CAPITAL', 'BUSINESS_FINANCE')
            THEN 'CASHFLOW_TARGET'
    ELSE 'ACCUMULATION'
END
WHERE plan_type NOT IN (
    'ACCUMULATION', 'DEBT_PAYOFF', 'EXPENSE_PLAN', 'CASHFLOW_TARGET', 'PORTFOLIO_GROWTH'
);

UPDATE financial_plans
SET period_type = 'ONE_TIME'
WHERE period_type = 'MONTHLY'
  AND end_date IS NOT NULL
  AND TRIM(end_date) <> '';

UPDATE financial_plans
SET plan_category = 'CORE_PERSONAL_FINANCE'
WHERE plan_category IS NULL
   OR TRIM(plan_category) = '';

UPDATE financial_plans
SET plan_subcategory = 'SAVINGS'
WHERE plan_subcategory IS NULL
   OR TRIM(plan_subcategory) = '';

CREATE INDEX IF NOT EXISTS idx_financial_plans_status
ON financial_plans(status);

CREATE INDEX IF NOT EXISTS idx_financial_plans_goal
ON financial_plans(goal_id);

CREATE INDEX IF NOT EXISTS idx_financial_plans_dates
ON financial_plans(start_date, end_date);
`
};
