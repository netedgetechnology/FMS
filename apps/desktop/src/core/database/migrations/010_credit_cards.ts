import { IMigration } from "../types/IMigration";

export const CreditCardsMigration: IMigration = {
    version: 10,
    name: "Credit Cards",
    sql: `
CREATE TABLE IF NOT EXISTS credit_cards (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL UNIQUE,
    card_network TEXT NOT NULL,
    credit_limit REAL NOT NULL DEFAULT 0,
    statement_day INTEGER,
    payment_due_day INTEGER,
    opening_outstanding_balance REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_credit_cards_account
ON credit_cards(account_id);

CREATE INDEX IF NOT EXISTS idx_credit_cards_network
ON credit_cards(card_network);
`
};
