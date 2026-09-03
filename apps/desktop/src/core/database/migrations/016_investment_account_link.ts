import { IMigration } from "../types/IMigration";

export const InvestmentAccountLinkMigration: IMigration = {
    version: 16,
    name: "Investment Account Link",
    // An investment's linked account carries identity only (so the investment
    // shows up under Accounts). Its monetary worth stays in the investments
    // domain, so opening_balance is left at 0 to avoid double-counting it in
    // the Accounts total balance and the dashboard net worth.
    sql: `
ALTER TABLE investments ADD COLUMN investment_subtype TEXT;

INSERT OR IGNORE INTO accounts (
    id,
    currency_id,
    name,
    account_type,
    opening_balance,
    description,
    is_active,
    created_at,
    updated_at
)
SELECT
    'inv-' || investments.id,
    investments.currency_id,
    investments.name,
    'INVESTMENT',
    0,
    'Investment account',
    CASE WHEN investments.status = 'ACTIVE' THEN 1 ELSE 0 END,
    investments.created_at,
    investments.updated_at
FROM investments
WHERE investments.deleted_at IS NULL
  AND (investments.account_id IS NULL OR investments.account_id = '');

UPDATE investments
SET account_id = 'inv-' || id
WHERE deleted_at IS NULL
  AND (account_id IS NULL OR account_id = '')
  AND EXISTS (
    SELECT 1 FROM accounts WHERE accounts.id = 'inv-' || investments.id
  );
`
};
