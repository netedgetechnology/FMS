import { IMigration } from "../types/IMigration";

export const CategoryContextMappingsMigration: IMigration = {
    version: 38,
    name: "Category Context Mappings",
    // A category's Income/Expense direction is no longer always the same
    // in every context (e.g. "Salary" is an Expense against the
    // Netedge Technology business entity, but Income against a family
    // member's personal account). categories.category_type remains the
    // category's own default/global classification (tier 3 of the
    // resolution priority, unchanged, still NOT NULL - every existing
    // consumer of category_type keeps working exactly as before). This
    // table adds optional, higher-priority overrides scoped to either a
    // specific account or a specific business entity (never both - see
    // the CHECK below), so the same category row can resolve to Income
    // in one context and Expense in another without ever being
    // duplicated. Resolution order (account mapping, then business
    // entity mapping, then the category's own category_type) is applied
    // in application code (resolveCategoryTransactionType), not here.
    sql: `

CREATE TABLE IF NOT EXISTS category_context_mappings (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL,
    account_id TEXT,
    business_entity_id TEXT,
    category_type TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    FOREIGN KEY (category_id) REFERENCES categories(id),
    FOREIGN KEY (account_id) REFERENCES accounts(id),
    FOREIGN KEY (business_entity_id) REFERENCES business_entities(id),
    CHECK (category_type IN ('INCOME', 'EXPENSE')),
    CHECK (
        (account_id IS NOT NULL AND business_entity_id IS NULL)
        OR
        (account_id IS NULL AND business_entity_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_category_context_mappings_account
ON category_context_mappings(category_id, account_id)
WHERE account_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_category_context_mappings_entity
ON category_context_mappings(category_id, business_entity_id)
WHERE business_entity_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_category_context_mappings_category
ON category_context_mappings(category_id);

`
};
