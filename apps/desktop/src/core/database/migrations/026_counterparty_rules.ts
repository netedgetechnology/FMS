import { IMigration } from "../types/IMigration";

export const CounterpartyRulesMigration: IMigration = {
    version: 26,
    name: "Counterparty Rules",
    // Learned "generic transaction-pattern -> Counterparty" associations
    // (see @financeos/import-engine's extractTransactionPattern). Created
    // from a user's manual Counterparty entry during import; looked up on
    // future imports to auto-suggest a Counterparty for a matching
    // pattern. A manual per-row entry always overrides the suggestion.
    // Global (not bank/account-specific) and never seeded with any
    // hardcoded rule - purely learned from user corrections.
    //
    // IMPORTANT: this migration has already shipped/been applied to real
    // databases (tracked by version number only - see MigrationEngine),
    // so its SQL must never change again. Account-scoping counterparty
    // rules is handled by a later migration (027) that safely alters
    // this table in place instead. Never edit an already-applied
    // migration's SQL - add a new one.
    sql: `
CREATE TABLE IF NOT EXISTS counterparty_rules (
    id TEXT PRIMARY KEY,
    pattern TEXT NOT NULL UNIQUE,
    counterparty TEXT NOT NULL,
    match_count INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`
};
