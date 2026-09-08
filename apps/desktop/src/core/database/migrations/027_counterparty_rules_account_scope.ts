import { IMigration } from "../types/IMigration";

export const CounterpartyRulesAccountScopeMigration: IMigration = {
    version: 27,
    name: "Counterparty Rules Account Scope",
    // Migration 026 shipped counterparty_rules as globally-unique on
    // pattern alone. Counterparty learning must instead be scoped to the
    // destination FinanceOS account, so this rebuilds the table with an
    // account_id column and a UNIQUE(account_id, pattern) constraint -
    // SQLite has no ALTER TABLE for changing a UNIQUE constraint, so the
    // standard rename/recreate/copy/drop rebuild is used instead.
    //
    // Existing rows are preserved (not dropped) with account_id left
    // NULL - there is no reliable way to attribute a rule learned under
    // the old global schema to one specific account, and fabricating one
    // would risk a wrong/unsafe suggestion. A NULL-account_id rule simply
    // never matches any account-scoped lookup going forward; the data
    // itself is not lost, and a fresh rule is naturally relearned per
    // account on the next manual Counterparty entry.
    //
    // Safe to run whether counterparty_rules already has the old
    // (pattern-only-unique) shape (real pre-existing databases) or is
    // being created fresh right after migration 026 with no rows yet.
    sql: `
ALTER TABLE counterparty_rules RENAME TO counterparty_rules_old;

CREATE TABLE counterparty_rules (
    id TEXT PRIMARY KEY,
    account_id TEXT,
    pattern TEXT NOT NULL,
    counterparty TEXT NOT NULL,
    match_count INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(account_id, pattern),
    FOREIGN KEY (account_id) REFERENCES accounts(id)
);

INSERT INTO counterparty_rules
    (id, account_id, pattern, counterparty, match_count, created_at, updated_at)
SELECT
    id, NULL, pattern, counterparty, match_count, created_at, updated_at
FROM counterparty_rules_old;

DROP TABLE counterparty_rules_old;

CREATE INDEX IF NOT EXISTS idx_counterparty_rules_account
ON counterparty_rules(account_id);
`
};
