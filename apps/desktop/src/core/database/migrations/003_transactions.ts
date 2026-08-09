import { IMigration } from "../types/IMigration";

export const TransactionSchemaMigration: IMigration = {
    version: 3,
    name: "Transactions",

    sql: `
CREATE TABLE IF NOT EXISTS transactions (

    id TEXT PRIMARY KEY,

    account_id TEXT NOT NULL,

    category_id TEXT,

    payee TEXT NOT NULL,

    type TEXT NOT NULL,

    amount REAL NOT NULL,

    transaction_date TEXT NOT NULL,

    reference_number TEXT,

    notes TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    deleted_at TEXT,

    FOREIGN KEY (account_id)
        REFERENCES accounts(id)

);

CREATE INDEX IF NOT EXISTS idx_transactions_account
ON transactions(account_id);

CREATE INDEX IF NOT EXISTS idx_transactions_date
ON transactions(transaction_date);

CREATE INDEX IF NOT EXISTS idx_transactions_type
ON transactions(type);
`
};
