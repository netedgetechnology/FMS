import { IMigration } from "../types/IMigration";

export const InitialSchemaMigration: IMigration = {
    version: 1,
    name: "Initial Schema",
    sql: `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS currencies (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS institutions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,

    institution_id TEXT,

    currency_id TEXT NOT NULL,

    name TEXT NOT NULL,

    account_type TEXT NOT NULL,

    opening_balance REAL NOT NULL DEFAULT 0,

    account_number TEXT,

    branch_name TEXT,

    ifsc_code TEXT,

    swift_code TEXT,

    iban TEXT,

    description TEXT,

    is_active INTEGER NOT NULL DEFAULT 1,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    deleted_at TEXT,

    FOREIGN KEY (institution_id)
        REFERENCES institutions(id),

    FOREIGN KEY (currency_id)
        REFERENCES currencies(id)
);

CREATE INDEX IF NOT EXISTS idx_accounts_currency
ON accounts(currency_id);

CREATE INDEX IF NOT EXISTS idx_accounts_institution
ON accounts(institution_id);
`
};
