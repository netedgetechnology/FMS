import { IMigration } from "../types/IMigration";

export const FinanceFoundationMigration: IMigration = {
    version: 4,
    name: "Finance Foundation",
    sql: `

CREATE TABLE IF NOT EXISTS business_entities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    legal_name TEXT,
    tax_identifier TEXT,
    currency_id TEXT NOT NULL,
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    FOREIGN KEY (currency_id) REFERENCES currencies(id)
);

CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    name TEXT NOT NULL,
    category_type TEXT NOT NULL,
    finance_scope TEXT NOT NULL DEFAULT 'PERSONAL',
    business_entity_id TEXT,
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    FOREIGN KEY (parent_id) REFERENCES categories(id),
    FOREIGN KEY (business_entity_id) REFERENCES business_entities(id)
);

CREATE INDEX IF NOT EXISTS idx_categories_parent
ON categories(parent_id);

CREATE INDEX IF NOT EXISTS idx_categories_type
ON categories(category_type);

CREATE TABLE IF NOT EXISTS transfers (
    id TEXT PRIMARY KEY,
    source_account_id TEXT NOT NULL,
    destination_account_id TEXT NOT NULL,
    amount REAL NOT NULL,
    transaction_date TEXT NOT NULL,
    currency_id TEXT NOT NULL,
    reference_number TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    FOREIGN KEY (source_account_id) REFERENCES accounts(id),
    FOREIGN KEY (destination_account_id) REFERENCES accounts(id),
    FOREIGN KEY (currency_id) REFERENCES currencies(id)
);

CREATE INDEX IF NOT EXISTS idx_transfers_source
ON transfers(source_account_id);

CREATE INDEX IF NOT EXISTS idx_transfers_destination
ON transfers(destination_account_id);

CREATE TABLE IF NOT EXISTS reconciliations (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    statement_date TEXT NOT NULL,
    statement_balance REAL NOT NULL,
    system_balance REAL NOT NULL,
    difference REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    notes TEXT,
    reconciled_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_reconciliations_account
ON reconciliations(account_id);

CREATE TABLE IF NOT EXISTS transaction_rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    match_field TEXT NOT NULL,
    match_value TEXT NOT NULL,
    category_id TEXT,
    priority INTEGER NOT NULL DEFAULT 100,
    is_learned INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS import_batches (
    id TEXT PRIMARY KEY,
    account_id TEXT,
    import_type TEXT NOT NULL,
    source_file_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    total_rows INTEGER NOT NULL DEFAULT 0,
    imported_rows INTEGER NOT NULL DEFAULT 0,
    failed_rows INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS import_rows (
    id TEXT PRIMARY KEY,
    import_batch_id TEXT NOT NULL,
    row_number INTEGER NOT NULL,
    raw_data TEXT NOT NULL,
    normalized_data TEXT,
    transaction_id TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (import_batch_id) REFERENCES import_batches(id),
    FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

`
};

