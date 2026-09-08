import { IMigration } from "../types/IMigration";

export const CounterpartyRulesTypeNotesMigration: IMigration = {
    version: 28,
    name: "Counterparty Rules Type And Notes",
    // Extends the account-scoped counterparty_rules learning (026, 027)
    // to also carry a learned Transaction Type (transactionType channel
    // - UPI/IMPS/NEFT/...) and Notes for a pattern, alongside the
    // existing Payee ("counterparty" column). Both new columns are
    // plain nullable ALTER TABLE ADD COLUMNs - no constraint changes, so
    // (unlike 027) no rename/recreate rebuild is needed. Existing rows
    // simply get NULL for both, meaning "no learned Type/Notes yet" -
    // the existing DR/CR-based Type detection and blank Notes remain
    // the fallback until a rule supplies a value.
    sql: `
ALTER TABLE counterparty_rules ADD COLUMN type TEXT;
ALTER TABLE counterparty_rules ADD COLUMN notes TEXT;
`
};
