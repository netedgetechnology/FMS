import { IMigration } from "../types/IMigration";

export const LoanOverdraftMigration: IMigration = {
    version: 47,
    name: "Loan Overdraft",
    // Loan Type as behaviour, and the Overdraft (OD) facility.
    //
    // loans.loan_kind - what the loan IS, which decides how it works:
    // TERM_LOAN (EMI schedule, EMI payments, EMI import matching - every
    // loan until now) or OVERDRAFT (a revolving limit, no schedule). The
    // existing free-text loans.loan_type stays the user's own description
    // (e.g. "Home Loan") and drives no behaviour. Every existing loan keeps
    // TERM_LOAN through the column default - no existing row is changed.
    //
    // OD-only columns, NULL for a Term Loan:
    //   credit_limit        - the OD limit.
    //   opening_used        - the amount used as on opening_used_as_of.
    //   opening_used_as_of  - only linked transactions AFTER this date move
    //                         the used amount (earlier ones are already in
    //                         opening_used).
    //
    // overdraft_transaction_links - which EXISTING transactions are OD
    // movements, and what each one is. It stores no amount and no date: the
    // used amount is always derived from the live transactions (see
    // loans/repositories/overdraftPositionSql.ts), so an edit, delete or
    // restore of a transaction is reflected without any recalculation step.
    // UNIQUE(transaction_id): one transaction is never counted twice.
    // link_source - MANUAL (the user linked it) or IMPORT (matched
    // automatically on a pattern the user taught by a MANUAL link).
    sql: `
ALTER TABLE loans ADD COLUMN loan_kind TEXT NOT NULL DEFAULT 'TERM_LOAN' CHECK (loan_kind IN ('TERM_LOAN', 'OVERDRAFT'));

ALTER TABLE loans ADD COLUMN credit_limit REAL;

ALTER TABLE loans ADD COLUMN opening_used REAL;

ALTER TABLE loans ADD COLUMN opening_used_as_of TEXT;

CREATE TABLE IF NOT EXISTS overdraft_transaction_links (
    id TEXT PRIMARY KEY,
    loan_id TEXT NOT NULL,
    transaction_id TEXT NOT NULL UNIQUE,
    entry_kind TEXT NOT NULL CHECK (entry_kind IN ('DRAWDOWN', 'REPAYMENT', 'INTEREST_CHARGE')),
    link_source TEXT NOT NULL DEFAULT 'MANUAL' CHECK (link_source IN ('MANUAL', 'IMPORT')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (loan_id) REFERENCES loans(id),
    FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_overdraft_transaction_links_loan
ON overdraft_transaction_links(loan_id)
`
};
