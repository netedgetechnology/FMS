import { invoke } from "@tauri-apps/api/core";

/**
 * Development-only Import/Reconciliation cleanup.
 *
 * Permanently deletes every row from exactly five tables - `import_rows`,
 * `import_batches`, `import_mappings`, `counterparty_rules`, and
 * `reconciliations` - and nothing else. `transactions` (including its
 * `reconciled` / `reconciled_at` columns), `accounts`, `business_entities`,
 * `financial_plans`, `goals`, `investments`, `loans`, `budgets`,
 * `categories`, `institutions`, and `currencies` are never touched.
 *
 * Implemented as a single Rust-side `sqlx` transaction (see
 * `import_reconciliation_reset.rs`) so BEGIN, every DELETE, and COMMIT are
 * guaranteed to run on one verified SQLite connection, with a full
 * rollback if any statement fails - something routing this through the
 * normal `SQLiteProvider` (`@tauri-apps/plugin-sql`'s pooled
 * connections, each `execute()` call independently checking out a
 * connection) cannot guarantee.
 *
 * Never surface this outside a development-gated UI action - see
 * `DEV_TOOLS_ENABLED`.
 */
export interface ImportReconciliationResetResult {
    importRows: number;
    importBatches: number;
    importMappings: number;
    counterpartyRules: number;
    reconciliations: number;
}

/**
 * True only for a `vite dev` build. `import.meta.env.DEV` is a
 * compile-time constant Vite inlines and dead-code-eliminates, so any UI
 * gated on this is compiled out of `vite build` entirely - not just
 * hidden at runtime.
 */
export const DEV_TOOLS_ENABLED: boolean = import.meta.env.DEV;

export async function resetImportAndReconciliationData(): Promise<ImportReconciliationResetResult> {
    return invoke<ImportReconciliationResetResult>(
        "reset_import_and_reconciliation_data"
    );
}
