import { IMigration } from "../types/IMigration";

export const ImportDraftsMigration: IMigration = {
    version: 42,
    name: "Import Drafts",
    // Auto-recovery for an unfinished Import Preview (see
    // services/importDraft.ts): the complete preview plus every edit made
    // in it, so a refresh/restart never loses manual work.
    //
    // At most one draft exists at a time (a new one replaces the old only
    // after the user confirms). The state is split in two columns so a
    // routine edit rewrites only the small `state_json` (overrides,
    // scope, ...), never the large `preview_json` (normalized rows,
    // document, duplicates) which changes only when the preview itself
    // is recomputed.
    //
    // Deliberately no foreign key to accounts: a draft is disposable
    // working state and must never block deleting an account; a draft
    // whose account is gone is reported on restore instead. Purely
    // additive: no existing table, row or constraint is touched.
    sql: `

CREATE TABLE IF NOT EXISTS import_drafts (
    id TEXT PRIMARY KEY,
    format_version INTEGER NOT NULL,
    account_id TEXT NOT NULL,
    import_type TEXT NOT NULL,
    file_name TEXT NOT NULL,
    row_count INTEGER NOT NULL,
    preview_json TEXT NOT NULL,
    state_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

`
};
