import { IMigration } from "../types/IMigration";

export const BackfillImportMappingNameMigration: IMigration = {
    version: 29,
    name: "Backfill Import Mapping Name",
    // Mapping-Name persistence (transactions.source_statement, used by the
    // Transactions page's "Mapping Name" filter) was added after many
    // statements had already been imported, so those older transactions
    // were created with source_statement left NULL - not a bug in the
    // current import flow, just data that predates the column being
    // populated.
    //
    // This backfills them without guessing: for every transaction created
    // by an import (import_rows.transaction_id), it recomputes the exact
    // same header signature the app itself uses to recognize a statement
    // format (see computeHeaderSignature in @financeos/import-engine -
    // import type + the source file's own column headers, lowercased,
    // trimmed and sorted, joined with "|") from that row's stored
    // raw_data, and looks up the saved import_mappings row with that exact
    // signature. Only when a mapping is found does the transaction get
    // stamped with that mapping's name; an old test import whose header
    // structure was never actually saved as a mapping is left untouched
    // rather than assigned a guessed name. Never touches a transaction
    // that already has a source_statement (manual entries, and anything
    // already correctly stamped by the current import flow).
    sql: `
WITH row_signatures AS (
    SELECT
        ir.transaction_id AS transaction_id,
        ib.import_type || '::' || (
            SELECT group_concat(normalized, '|')
            FROM (
                SELECT LOWER(TRIM(je.key)) AS normalized
                FROM json_each(ir.raw_data) je
                WHERE LENGTH(TRIM(je.key)) > 0
                ORDER BY LOWER(TRIM(je.key))
            )
        ) AS header_signature
    FROM import_rows ir
    JOIN import_batches ib ON ib.id = ir.import_batch_id
    WHERE ir.transaction_id IS NOT NULL
      AND ir.status = 'IMPORTED'
)
UPDATE transactions
SET source_statement = (
    SELECT im.name
    FROM row_signatures rs
    JOIN import_mappings im ON im.header_signature = rs.header_signature
    WHERE rs.transaction_id = transactions.id
    LIMIT 1
)
WHERE transactions.source_statement IS NULL
  AND transactions.id IN (
      SELECT rs.transaction_id
      FROM row_signatures rs
      JOIN import_mappings im ON im.header_signature = rs.header_signature
  );
`
};
