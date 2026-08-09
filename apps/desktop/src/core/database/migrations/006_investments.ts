import { IMigration } from "../types/IMigration";

export const InvestmentsMigration: IMigration = {
    version: 6,
    name: "Investments",
    sql: `

CREATE TABLE IF NOT EXISTS investments (
    id TEXT PRIMARY KEY,
    account_id TEXT,
    name TEXT NOT NULL,
    investment_type TEXT NOT NULL,
    symbol TEXT,
    isin TEXT,
    currency_id TEXT NOT NULL,
    broker_institution_id TEXT,
    quantity REAL NOT NULL DEFAULT 0,
    average_cost REAL NOT NULL DEFAULT 0,
    current_price REAL NOT NULL DEFAULT 0,
    current_value REAL NOT NULL DEFAULT 0,
    purchase_date TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    FOREIGN KEY (account_id) REFERENCES accounts(id),
    FOREIGN KEY (currency_id) REFERENCES currencies(id),
    FOREIGN KEY (broker_institution_id) REFERENCES institutions(id)
);

CREATE INDEX IF NOT EXISTS idx_investments_account
ON investments(account_id);

CREATE INDEX IF NOT EXISTS idx_investments_type
ON investments(investment_type);

CREATE INDEX IF NOT EXISTS idx_investments_status
ON investments(status);

CREATE TABLE IF NOT EXISTS investment_holdings (
    id TEXT PRIMARY KEY,
    investment_id TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 0,
    average_cost REAL NOT NULL DEFAULT 0,
    current_price REAL NOT NULL DEFAULT 0,
    current_value REAL NOT NULL DEFAULT 0,
    as_of_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (investment_id) REFERENCES investments(id)
);

CREATE INDEX IF NOT EXISTS idx_investment_holdings_investment
ON investment_holdings(investment_id);

CREATE INDEX IF NOT EXISTS idx_investment_holdings_date
ON investment_holdings(as_of_date);

CREATE TABLE IF NOT EXISTS investment_transactions (
    id TEXT PRIMARY KEY,
    investment_id TEXT NOT NULL,
    transaction_type TEXT NOT NULL,
    transaction_date TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 0,
    price REAL NOT NULL DEFAULT 0,
    amount REAL NOT NULL,
    fees REAL NOT NULL DEFAULT 0,
    taxes REAL NOT NULL DEFAULT 0,
    reference_number TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (investment_id) REFERENCES investments(id)
);

CREATE INDEX IF NOT EXISTS idx_investment_transactions_investment
ON investment_transactions(investment_id);

CREATE INDEX IF NOT EXISTS idx_investment_transactions_date
ON investment_transactions(transaction_date);

`
};
