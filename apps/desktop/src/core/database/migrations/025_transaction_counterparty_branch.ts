import { IMigration } from "../types/IMigration";

export const TransactionCounterpartyBranchMigration: IMigration = {
    version: 25,
    name: "Transaction Counterparty and Branch",
    // counterparty: the person/company on the other side of the
    // transaction - distinct from payee/description/reference/notes,
    // never merged into any of them.
    // branch: the bank branch a transaction was processed at (from a
    // mapped source column) - was previously informational-only
    // (import preview/rawData only); now actually persisted with the
    // transaction.
    // Both optional; existing rows default to NULL.
    sql: `
ALTER TABLE transactions ADD COLUMN counterparty TEXT;

ALTER TABLE transactions ADD COLUMN branch TEXT;

CREATE INDEX IF NOT EXISTS idx_transactions_counterparty
ON transactions(counterparty);
`
};
