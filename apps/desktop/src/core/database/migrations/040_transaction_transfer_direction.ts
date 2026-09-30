import { IMigration } from "../types/IMigration";

export const TransactionTransferDirectionMigration: IMigration = {
    version: 40,
    name: "Transaction Transfer Direction",
    // Which way a `type = 'transfer'` transaction moves money on its own
    // account: 'OUT' (leaves it, like a debit) or 'IN' (arrives, like a
    // credit). A transfer is neither income nor expense, but it must still
    // move its account's balance - and amounts are always positive, so
    // without this a transfer's direction was unknowable and every
    // balance calculation had to skip it. Amounts are never signed: an
    // income/expense row's direction IS its type, so this column is the
    // single source of direction for transfer rows only - never entered
    // by the user, always copied from the Debit/Credit (expense -> OUT,
    // income -> IN) the row had when it became a transfer, and always
    // NULL on income/expense rows (enforced by TransactionRepository).
    // Purely additive and nullable: every existing row is untouched
    // (NULL = not a transfer, or a legacy transfer whose direction was
    // never recorded - still skipped by balances, exactly as before).
    sql: `
ALTER TABLE transactions ADD COLUMN transfer_direction TEXT;
`
};
