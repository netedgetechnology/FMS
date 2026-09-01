import { IMigration } from "../types/IMigration";

export const AccountBusinessEntityMigration: IMigration = {
    version: 15,
    name: "Account Business Entity",

    sql: `
ALTER TABLE accounts ADD COLUMN business_entity_id TEXT REFERENCES business_entities(id);

CREATE INDEX IF NOT EXISTS idx_accounts_business_entity
ON accounts(business_entity_id);
`
};
