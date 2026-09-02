import { IMigration } from "../types/IMigration";

export const InvestmentAccountZeroBalanceMigration: IMigration = {
    version: 17,
    name: "Investment Account Zero Balance",
    // Corrective for databases that applied migration 016 before it was
    // changed: an investment's linked account must not carry the investment's
    // value, otherwise it is double-counted in the Accounts total balance and
    // the dashboard net worth. Only touches accounts that back an investment.
    sql: `
UPDATE accounts
SET opening_balance = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (
    SELECT account_id
    FROM investments
    WHERE account_id IS NOT NULL
      AND account_id <> ''
);
`
};
