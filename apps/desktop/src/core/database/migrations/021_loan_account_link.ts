import { IMigration } from "../types/IMigration";

export const LoanAccountLinkMigration: IMigration = {
    // Version 21: version 20 was consumed by an earlier, since-removed
    // migration that some databases already recorded, so this must not reuse
    // that number (the engine skips an already-applied version).
    version: 21,
    name: "Loan Account Link",
    // Every live loan is backed 1:1 by a real account record
    // (account_type = LOAN) so loans show up in the unified Accounts list.
    // This mirrors the Investment <-> Account link (migration 016).
    //
    //   - loans.loan_account_id  -> the new LOAN account (identity/list row)
    //   - loans.account_id       -> unchanged: the bank account EMIs are paid
    //                               from. NOT the loan account.
    //
    // The LOAN account carries opening_balance = 0. The current liability is
    // derived at read time from the loan's outstanding principal + interest
    // (AccountRepository), shown as a NEGATIVE balance, so it is never part of
    // any SUM(opening_balance) aggregate and cannot be double-counted. Net
    // worth continues to subtract the loan liability once, straight from the
    // loans table (DashboardService).
    //
    // The ALTER / CREATE INDEX run once (guarded by the migration runner). The
    // INSERT OR IGNORE + guarded UPDATE are idempotent. Pre-existing legacy
    // account_type = 'LOAN' rows use random ids, never 'loan-<id>', so they are
    // left untouched.
    sql: `
ALTER TABLE loans ADD COLUMN loan_account_id TEXT REFERENCES accounts(id);

CREATE INDEX IF NOT EXISTS idx_loans_loan_account
ON loans(loan_account_id);

INSERT OR IGNORE INTO accounts (
    id,
    institution_id,
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
    'loan-' || loans.id,
    loans.lender_institution_id,
    loans.currency_id,
    loans.name,
    'LOAN',
    0,
    'Loan liability account',
    CASE WHEN loans.status = 'CLOSED' THEN 0 ELSE 1 END,
    loans.created_at,
    loans.updated_at
FROM loans
WHERE loans.deleted_at IS NULL
  AND (loans.loan_account_id IS NULL OR loans.loan_account_id = '');

UPDATE loans
SET loan_account_id = 'loan-' || id,
    updated_at = CURRENT_TIMESTAMP
WHERE deleted_at IS NULL
  AND (loan_account_id IS NULL OR loan_account_id = '')
  AND EXISTS (
    SELECT 1 FROM accounts WHERE accounts.id = 'loan-' || loans.id
  );
`
};
