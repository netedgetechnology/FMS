import { IMigration } from "../types/IMigration";

export const ImportDuplicateCountMigration: IMigration = {
    version: 13,
    name: "Import Duplicate Count",
    sql: `

ALTER TABLE import_batches
ADD COLUMN duplicate_rows INTEGER NOT NULL DEFAULT 0;

`
};
