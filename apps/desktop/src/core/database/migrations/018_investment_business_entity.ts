import { IMigration } from "../types/IMigration";

export const InvestmentBusinessEntityMigration: IMigration = {
    version: 18,
    name: "Investment Business Entity",
    // Investments now carry a business entity (like accounts / categories /
    // financial plans). The investment's linked account inherits it.
    //
    // Existing investments are only auto-assigned when there is exactly one
    // business entity - an unambiguous choice, not a guess. When there are
    // zero or multiple, the value is left NULL and the (required) form field
    // makes the assignment explicit and repairable on the next edit.
    sql: `
ALTER TABLE investments ADD COLUMN business_entity_id TEXT REFERENCES business_entities(id);

CREATE INDEX IF NOT EXISTS idx_investments_business_entity
ON investments(business_entity_id);

UPDATE investments
SET business_entity_id = (
    SELECT id FROM business_entities WHERE deleted_at IS NULL LIMIT 1
)
WHERE business_entity_id IS NULL
  AND deleted_at IS NULL
  AND (SELECT COUNT(*) FROM business_entities WHERE deleted_at IS NULL) = 1;

UPDATE accounts
SET business_entity_id = (
    SELECT id FROM business_entities WHERE deleted_at IS NULL LIMIT 1
),
    updated_at = CURRENT_TIMESTAMP
WHERE business_entity_id IS NULL
  AND id IN (
    SELECT account_id FROM investments
    WHERE account_id IS NOT NULL AND account_id <> ''
  )
  AND (SELECT COUNT(*) FROM business_entities WHERE deleted_at IS NULL) = 1;
`
};
