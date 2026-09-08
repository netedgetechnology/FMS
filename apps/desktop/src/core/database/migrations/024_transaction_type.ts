import { IMigration } from "../types/IMigration";

export const TransactionChannelTypeMigration: IMigration = {
    version: 24,
    name: "Transaction Type",
    // The transaction *channel* (UPI/IMPS/NEFT/RTGS/CASH/CHEQUE) - how the
    // money moved. Distinct from the existing `type` column (income /
    // expense / transfer, i.e. DR/CR direction), which this never touches
    // or overwrites. Optional; existing rows default to NULL.
    sql: `
ALTER TABLE transactions ADD COLUMN transaction_type TEXT;

CREATE INDEX IF NOT EXISTS idx_transactions_transaction_type
ON transactions(transaction_type);
`
};
