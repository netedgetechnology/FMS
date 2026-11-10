import { IMigration } from "../types/IMigration";

export const OverdraftAccountsMigration: IMigration = {
    version: 48,
    name: "Overdraft Accounts",
    // An Overdraft can be used through more than one bank account (money
    // drawn into, and repaid from, several accounts of the same business).
    // overdraft_accounts lists every bank account linked to an OD - one row
    // per (OD, account), UNIQUE so an account is never listed twice. It is
    // the only source of an OD's accounts: the OD calculation, Link to Loan
    // and import matching all read it. A Term Loan never has rows here; its
    // EMI payment account stays loans.account_id, unchanged.
    //
    // Existing ODs keep exactly the one account they already have: it is
    // copied here from loans.account_id. No account is added, and no loan,
    // transaction or link row is changed.
    sql: `
CREATE TABLE IF NOT EXISTS overdraft_accounts (
    id TEXT PRIMARY KEY,
    loan_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (loan_id, account_id),
    FOREIGN KEY (loan_id) REFERENCES loans(id),
    FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_overdraft_accounts_account
ON overdraft_accounts(account_id);

INSERT OR IGNORE INTO overdraft_accounts (id, loan_id, account_id)
SELECT lower(hex(randomblob(16))), id, account_id
FROM loans
WHERE loan_kind = 'OVERDRAFT'
  AND account_id IS NOT NULL
  AND deleted_at IS NULL
`
};
