import { IMigration } from "../types/IMigration";

export const TransactionDetailsMigration: IMigration = {
    version: 14,
    name: "Transaction Details",

    sql: `
ALTER TABLE transactions ADD COLUMN subcategory_id TEXT;

ALTER TABLE transactions ADD COLUMN tags TEXT;

ALTER TABLE transactions ADD COLUMN status TEXT NOT NULL DEFAULT 'CLEARED';

ALTER TABLE transactions ADD COLUMN payment_method TEXT;

ALTER TABLE transactions ADD COLUMN upi_reference TEXT;

ALTER TABLE transactions ADD COLUMN bank_transaction_reference TEXT;

ALTER TABLE transactions ADD COLUMN card_reference TEXT;

ALTER TABLE transactions ADD COLUMN reconciled INTEGER NOT NULL DEFAULT 0;

ALTER TABLE transactions ADD COLUMN reconciled_at TEXT;

ALTER TABLE transactions ADD COLUMN is_imported INTEGER NOT NULL DEFAULT 0;

ALTER TABLE transactions ADD COLUMN source_statement TEXT;

ALTER TABLE transactions ADD COLUMN external_transaction_id TEXT;

ALTER TABLE transactions ADD COLUMN original_narration TEXT;

CREATE INDEX IF NOT EXISTS idx_transactions_subcategory
ON transactions(subcategory_id);

CREATE INDEX IF NOT EXISTS idx_transactions_status
ON transactions(status);

CREATE INDEX IF NOT EXISTS idx_transactions_external_id
ON transactions(external_transaction_id);

CREATE INDEX IF NOT EXISTS idx_transactions_reconciled
ON transactions(reconciled);

CREATE INDEX IF NOT EXISTS idx_transactions_imported
ON transactions(is_imported);
`
};
