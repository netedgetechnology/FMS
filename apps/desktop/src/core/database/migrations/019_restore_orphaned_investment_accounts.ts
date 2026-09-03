import { IMigration } from "../types/IMigration";

export const RestoreOrphanedInvestmentAccountsMigration: IMigration = {
    version: 19,
    name: "Restore Orphaned Investment Accounts",
    // A linked investment account can be soft-deleted from the Accounts page
    // while its investment stays live, which leaves the investment invisible
    // under Accounts and unable to self-heal. Un-delete any INVESTMENT account
    // that a live investment still points at, and re-sync its name / business
    // entity from that investment (syncLinkedAccount skips soft-deleted rows,
    // so those columns may be stale). INVESTMENT accounts that no live
    // investment references are genuine user deletions and are left alone.
    // Idempotent: once restored, the row no longer matches deleted_at IS NOT NULL.
    sql: `
UPDATE accounts
SET
    deleted_at = NULL,
    name = COALESCE(
        (
            SELECT investments.name
            FROM investments
            WHERE investments.account_id = accounts.id
              AND investments.deleted_at IS NULL
            LIMIT 1
        ),
        accounts.name
    ),
    business_entity_id = COALESCE(
        accounts.business_entity_id,
        (
            SELECT investments.business_entity_id
            FROM investments
            WHERE investments.account_id = accounts.id
              AND investments.deleted_at IS NULL
            LIMIT 1
        )
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE accounts.account_type = 'INVESTMENT'
  AND accounts.deleted_at IS NOT NULL
  AND accounts.id IN (
      SELECT investments.account_id
      FROM investments
      WHERE investments.deleted_at IS NULL
        AND investments.account_id IS NOT NULL
        AND investments.account_id <> ''
  );
`
};
