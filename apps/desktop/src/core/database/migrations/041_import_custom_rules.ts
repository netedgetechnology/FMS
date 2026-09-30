import { IMigration } from "../types/IMigration";

export const ImportCustomRulesMigration: IMigration = {
    version: 41,
    name: "Import Custom Rules",
    // User-defined, permanent Import rules ("description contains
    // KEYWORD -> set Payee / Notes / Category / Type"), scoped to the
    // destination account exactly like the automatic self-learned rules.
    //
    // Deliberately a separate table, not new columns on
    // counterparty_rules: those rows are AUTOMATIC learning keyed by an
    // exact direction + normalized-pattern (UNIQUE(account_id, pattern)),
    // written only from genuine corrections and wiped by "clear all
    // self-learned rules". A custom rule is explicit user configuration
    // matched by "contains", so mixing the two would change what an
    // existing counterparty_rules row means. Purely additive: no existing
    // table, row or constraint is touched.
    //
    // Every value column is optional (NULL = "this rule doesn't set that
    // field"), but a rule must set at least one. Precedence between
    // rules is by insertion order (rowid): the most recently created
    // matching rule wins per field.
    sql: `

CREATE TABLE IF NOT EXISTS import_custom_rules (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    keyword TEXT NOT NULL,
    payee TEXT,
    notes TEXT,
    category_id TEXT,
    transaction_type TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id),
    CHECK (length(trim(keyword)) > 0),
    CHECK (
        payee IS NOT NULL
        OR notes IS NOT NULL
        OR category_id IS NOT NULL
        OR transaction_type IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_import_custom_rules_account
ON import_custom_rules(account_id);

`
};
