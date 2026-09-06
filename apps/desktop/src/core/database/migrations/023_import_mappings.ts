import { IMigration } from "../types/IMigration";

export const ImportMappingsMigration: IMigration = {
    version: 23,
    name: "Import Mappings",
    // Confirmed column mappings, keyed by a structural signature of the
    // source file's headers (see @financeos/import-engine's
    // computeHeaderSignature). Reused automatically on future imports
    // whose header structure matches exactly, regardless of bank/format -
    // nothing here is specific to any institution.
    sql: `
CREATE TABLE IF NOT EXISTS import_mappings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    institution_name TEXT,
    import_type TEXT NOT NULL,
    header_signature TEXT NOT NULL UNIQUE,
    headers TEXT NOT NULL,
    mapping TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`
};
