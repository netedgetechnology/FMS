// ---------------------------------------------------------------------
// Import / Reconciliation Cleanup - development-only.
//
// Approved scope (see the Import/Reconciliation Cleanup investigation):
// clears ONLY the five tables below. Nothing else is ever read, written,
// or referenced by this module - no `accounts`, `business_entities`,
// `transactions` (including its `reconciled` / `reconciled_at` columns),
// `financial_plans`, `goals`, `investments`, `loans`, `budgets`,
// `categories`, `institutions`, `currencies`, or any other table.
//
// Why this lives in Rust rather than going through the existing
// `SQLiteProvider.execute()` (TypeScript) path: `@tauri-apps/plugin-sql`'s
// `execute()`/`select()` commands each independently check out a
// connection from its own sqlx connection pool per call (see
// `tauri-plugin-sql`'s `DbPool::execute`/`select`, which call
// `pool.execute(...)` / `pool.fetch_all(...)` directly on the pool, not on
// a held connection). That means a `BEGIN TRANSACTION` issued from
// TypeScript and the `DELETE` statements that follow it are NOT
// guaranteed to run on the same physical SQLite connection under any
// concurrent load - which would silently break the atomicity this cleanup
// depends on. Acquiring one `sqlx::Transaction` here (via `pool.begin()`)
// and running every statement through it is the only way to *guarantee*
// - not just hope - that BEGIN, every DELETE, and COMMIT all happen on
// one verified connection, with a real ROLLBACK if any step fails.
//
// This borrows `tauri-plugin-sql`'s own already-open connection pool
// (via its public `DbInstances` app state) rather than opening a second,
// separate connection to the same database file - both `DbPool` and
// `DbInstances` are `pub` in that crate specifically to allow this.
// ---------------------------------------------------------------------

use serde::Serialize;
use sqlx::{Pool, Sqlite};
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

/// The exact connection string FinWea's frontend uses - see
/// `SQLiteProvider.connect()` (`Database.load("sqlite:financeos.db")`).
/// This is the key `tauri-plugin-sql` stores the pool under internally.
const DB_KEY: &str = "sqlite:financeos.db";

// The complete, exact, and only set of statements this cleanup ever
// executes, in the exact order they run. `import_rows` MUST be deleted
// before `import_batches`: `import_rows.import_batch_id` is `NOT NULL`
// and references `import_batches(id)`, so deleting a batch that still has
// rows pointing at it would fail the foreign key check at the end of that
// statement. The other three (`import_mappings`, `counterparty_rules`,
// `reconciliations`) have no interdependency with each other or with the
// first two, and are listed after them purely for readability.
//
// Deliberately five fixed literals, not a generic "list of tables to
// clear" - this is the narrow Import/Reconciliation cleanup only, and
// must never be widened into (or reuse machinery from) a broader reset.
const DELETE_IMPORT_ROWS: &str = "DELETE FROM import_rows";
const DELETE_IMPORT_BATCHES: &str = "DELETE FROM import_batches";
const DELETE_IMPORT_MAPPINGS: &str = "DELETE FROM import_mappings";
const DELETE_COUNTERPARTY_RULES: &str = "DELETE FROM counterparty_rules";
const DELETE_RECONCILIATIONS: &str = "DELETE FROM reconciliations";

pub(crate) const RESET_STATEMENTS_IN_ORDER: [&str; 5] = [
    DELETE_IMPORT_ROWS,
    DELETE_IMPORT_BATCHES,
    DELETE_IMPORT_MAPPINGS,
    DELETE_COUNTERPARTY_RULES,
    DELETE_RECONCILIATIONS,
];

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportReconciliationResetResult {
    pub import_rows: i64,
    pub import_batches: i64,
    pub import_mappings: i64,
    pub counterparty_rules: i64,
    pub reconciliations: i64,
}

async fn sqlite_pool(app: &AppHandle) -> Result<Pool<Sqlite>, String> {
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;

    match lock.get(DB_KEY) {
        Some(DbPool::Sqlite(pool)) => Ok(pool.clone()),
        None => Err(
            "FinWea's database is not connected yet.".to_string()
        ),
    }
}

/// Runs the five approved DELETEs, in the approved order, inside one
/// `sqlx::Transaction` - one checked-out connection for BEGIN, every
/// DELETE, and COMMIT. Any failure rolls back everything (including
/// statements that already ran earlier in this same call) and returns
/// the real underlying database error.
async fn run_reset(
    pool: &Pool<Sqlite>,
) -> Result<ImportReconciliationResetResult, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let outcome: Result<[i64; 5], sqlx::Error> = async {
        let mut affected = [0i64; 5];

        for (index, statement) in
            RESET_STATEMENTS_IN_ORDER.iter().enumerate()
        {
            let result =
                sqlx::query(statement).execute(&mut *tx).await?;

            affected[index] = result.rows_affected() as i64;
        }

        Ok(affected)
    }
    .await;

    match outcome {
        Ok([
            import_rows,
            import_batches,
            import_mappings,
            counterparty_rules,
            reconciliations,
        ]) => {
            tx.commit().await?;

            Ok(ImportReconciliationResetResult {
                import_rows,
                import_batches,
                import_mappings,
                counterparty_rules,
                reconciliations,
            })
        }
        Err(error) => {
            // A dropped `tx` also rolls back automatically, but doing it
            // explicitly makes the intent unambiguous here.
            let _ = tx.rollback().await;

            Err(error)
        }
    }
}

/// Development-only command: permanently deletes every row from
/// `import_rows`, `import_batches`, `import_mappings`,
/// `counterparty_rules`, and `reconciliations` - and nothing else. The
/// frontend is responsible for gating this behind a dev-only UI
/// (`import.meta.env.DEV`); this command itself performs no environment
/// check, matching every other command in this app.
#[tauri::command]
pub async fn reset_import_and_reconciliation_data(
    app: AppHandle,
) -> Result<ImportReconciliationResetResult, String> {
    let pool = sqlite_pool(&app).await?;

    run_reset(&pool).await.map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;
    use sqlx::Row;

    async fn test_pool() -> Pool<Sqlite> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open in-memory test database");

        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&pool)
            .await
            .unwrap();

        // A focused schema mirroring the real FK shape of every table
        // this cleanup touches or must leave untouched - not the full
        // FinWea schema, but exact on the relationships that matter:
        // import_rows -> import_batches (NOT NULL), import_rows ->
        // transactions, import_batches/counterparty_rules/
        // reconciliations -> accounts.
        sqlx::query(
            r#"
            CREATE TABLE accounts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL
            );

            CREATE TABLE business_entities (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL
            );

            CREATE TABLE categories (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL
            );

            CREATE TABLE loans (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL
            );

            CREATE TABLE investments (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL
            );

            CREATE TABLE financial_plans (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL
            );

            CREATE TABLE goals (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL
            );

            CREATE TABLE transactions (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                amount REAL NOT NULL,
                reconciled INTEGER NOT NULL DEFAULT 0,
                reconciled_at TEXT,
                FOREIGN KEY (account_id) REFERENCES accounts(id)
            );

            CREATE TABLE import_batches (
                id TEXT PRIMARY KEY,
                account_id TEXT,
                source_file_name TEXT NOT NULL,
                FOREIGN KEY (account_id) REFERENCES accounts(id)
            );

            CREATE TABLE import_rows (
                id TEXT PRIMARY KEY,
                import_batch_id TEXT NOT NULL,
                transaction_id TEXT,
                FOREIGN KEY (import_batch_id) REFERENCES import_batches(id),
                FOREIGN KEY (transaction_id) REFERENCES transactions(id)
            );

            CREATE TABLE import_mappings (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL
            );

            CREATE TABLE counterparty_rules (
                id TEXT PRIMARY KEY,
                account_id TEXT,
                pattern TEXT NOT NULL,
                FOREIGN KEY (account_id) REFERENCES accounts(id)
            );

            CREATE TABLE reconciliations (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                statement_date TEXT NOT NULL,
                FOREIGN KEY (account_id) REFERENCES accounts(id)
            );
            "#,
        )
        .execute(&pool)
        .await
        .expect("create focused test schema");

        pool
    }

    async fn seed_everything(pool: &Pool<Sqlite>) {
        sqlx::query(
            r#"
            INSERT INTO accounts (id, name) VALUES ('acc-1', 'Checking');
            INSERT INTO business_entities (id, name) VALUES ('be-1', 'Household');
            INSERT INTO categories (id, name) VALUES ('cat-1', 'Groceries');
            INSERT INTO loans (id, name) VALUES ('loan-1', 'Home Loan');
            INSERT INTO investments (id, name) VALUES ('inv-1', 'Index Fund');
            INSERT INTO financial_plans (id, name) VALUES ('plan-1', 'Retirement');
            INSERT INTO goals (id, name) VALUES ('goal-1', 'Emergency Fund');

            INSERT INTO transactions
                (id, account_id, amount, reconciled, reconciled_at)
            VALUES
                ('txn-1', 'acc-1', 250.75, 1, '2026-01-05T00:00:00.000Z');

            INSERT INTO import_batches (id, account_id, source_file_name)
            VALUES ('batch-1', 'acc-1', 'statement.csv');

            INSERT INTO import_rows (id, import_batch_id, transaction_id)
            VALUES ('row-1', 'batch-1', 'txn-1');

            INSERT INTO import_mappings (id, name)
            VALUES ('mapping-1', 'My Bank');

            INSERT INTO counterparty_rules (id, account_id, pattern)
            VALUES ('rule-1', 'acc-1', 'AMZN*');

            INSERT INTO reconciliations (id, account_id, statement_date)
            VALUES ('recon-1', 'acc-1', '2026-01-31');
            "#,
        )
        .execute(pool)
        .await
        .expect("seed every table");
    }

    async fn count(pool: &Pool<Sqlite>, table: &str) -> i64 {
        let row = sqlx::query(&format!("SELECT COUNT(*) AS n FROM {table}"))
            .fetch_one(pool)
            .await
            .unwrap();

        row.get::<i64, _>("n")
    }

    #[tokio::test]
    async fn empties_all_five_target_tables_and_returns_their_counts() {
        let pool = test_pool().await;
        seed_everything(&pool).await;

        let result = run_reset(&pool).await.expect("reset succeeds");

        assert_eq!(
            result,
            ImportReconciliationResetResult {
                import_rows: 1,
                import_batches: 1,
                import_mappings: 1,
                counterparty_rules: 1,
                reconciliations: 1,
            }
        );

        for table in [
            "import_rows",
            "import_batches",
            "import_mappings",
            "counterparty_rules",
            "reconciliations",
        ] {
            assert_eq!(
                count(&pool, table).await,
                0,
                "{table} should be empty after reset"
            );
        }
    }

    #[tokio::test]
    async fn leaves_transactions_byte_for_byte_unchanged_including_reconciled_flags(
    ) {
        let pool = test_pool().await;
        seed_everything(&pool).await;

        run_reset(&pool).await.expect("reset succeeds");

        let row = sqlx::query(
            "SELECT account_id, amount, reconciled, reconciled_at FROM transactions WHERE id = 'txn-1'",
        )
        .fetch_one(&pool)
        .await
        .expect("the transaction still exists");

        assert_eq!(row.get::<String, _>("account_id"), "acc-1");
        assert_eq!(row.get::<f64, _>("amount"), 250.75);
        assert_eq!(row.get::<i64, _>("reconciled"), 1);
        assert_eq!(
            row.get::<String, _>("reconciled_at"),
            "2026-01-05T00:00:00.000Z"
        );

        assert_eq!(count(&pool, "transactions").await, 1);
    }

    #[tokio::test]
    async fn leaves_every_other_module_untouched() {
        let pool = test_pool().await;
        seed_everything(&pool).await;

        run_reset(&pool).await.expect("reset succeeds");

        for (table, id) in [
            ("accounts", "acc-1"),
            ("business_entities", "be-1"),
            ("categories", "cat-1"),
            ("loans", "loan-1"),
            ("investments", "inv-1"),
            ("financial_plans", "plan-1"),
            ("goals", "goal-1"),
        ] {
            assert_eq!(
                count(&pool, table).await,
                1,
                "{table} row count must be unchanged"
            );

            let row = sqlx::query(&format!(
                "SELECT name FROM {table} WHERE id = ?"
            ))
            .bind(id)
            .fetch_optional(&pool)
            .await
            .unwrap();

            assert!(
                row.is_some(),
                "{table}'s original row ({id}) must still exist unchanged"
            );
        }
    }

    #[tokio::test]
    async fn import_rows_must_be_deleted_before_import_batches() {
        let pool = test_pool().await;
        seed_everything(&pool).await;

        // Deleting in the WRONG order (batches while a row still points
        // at it) must fail the foreign key check - proving the ordering
        // in RESET_STATEMENTS_IN_ORDER is load-bearing, not cosmetic.
        let wrong_order_result =
            sqlx::query("DELETE FROM import_batches")
                .execute(&pool)
                .await;

        assert!(
            wrong_order_result.is_err(),
            "deleting import_batches before import_rows must fail its foreign key check"
        );

        // The actual, approved order succeeds.
        run_reset(&pool).await.expect("approved order succeeds");
    }

    #[tokio::test]
    async fn rolls_back_all_five_deletions_when_a_later_statement_fails() {
        let pool = test_pool().await;
        seed_everything(&pool).await;

        // Force the final statement to fail with a real database error,
        // without touching run_reset's own logic.
        sqlx::query("DROP TABLE reconciliations")
            .execute(&pool)
            .await
            .unwrap();

        let result = run_reset(&pool).await;

        assert!(result.is_err());

        // Every deletion that ran earlier in this same attempt - even
        // though it "succeeded" at the time - must have been rolled back
        // along with the whole transaction.
        for table in [
            "import_rows",
            "import_batches",
            "import_mappings",
            "counterparty_rules",
        ] {
            assert_eq!(
                count(&pool, table).await,
                1,
                "{table} must still have its original row after rollback"
            );
        }
    }

    #[test]
    fn executes_exactly_the_five_approved_delete_statements_and_nothing_else()
    {
        assert_eq!(RESET_STATEMENTS_IN_ORDER.len(), 5);

        let allowed_tables = [
            "import_rows",
            "import_batches",
            "import_mappings",
            "counterparty_rules",
            "reconciliations",
        ];

        for statement in RESET_STATEMENTS_IN_ORDER {
            assert!(
                statement.starts_with("DELETE FROM "),
                "every statement must be a plain DELETE FROM: {statement}"
            );

            assert!(
                !statement.to_uppercase().contains("WHERE"),
                "every statement clears the whole table, never a filtered subset: {statement}"
            );

            let table = statement
                .strip_prefix("DELETE FROM ")
                .unwrap();

            assert!(
                allowed_tables.contains(&table),
                "{table} is not one of the five approved tables"
            );
        }

        // No UPDATE, DROP, ALTER, or any statement touching `transactions`
        // (or any other table) appears anywhere in this constant.
        let joined = RESET_STATEMENTS_IN_ORDER.join(" ");

        for forbidden in [
            "UPDATE", "DROP", "ALTER", "transactions", "accounts",
            "business_entities", "financial_plans", "goals",
            "investments", "loans", "budgets", "categories",
            "institutions", "currencies",
        ] {
            assert!(
                !joined.to_uppercase().contains(&forbidden.to_uppercase()),
                "reset statements must never mention {forbidden}"
            );
        }
    }

    #[test]
    fn import_rows_is_deleted_strictly_before_import_batches() {
        let rows_index = RESET_STATEMENTS_IN_ORDER
            .iter()
            .position(|statement| *statement == DELETE_IMPORT_ROWS)
            .expect("import_rows delete is present");

        let batches_index = RESET_STATEMENTS_IN_ORDER
            .iter()
            .position(|statement| *statement == DELETE_IMPORT_BATCHES)
            .expect("import_batches delete is present");

        assert!(
            rows_index < batches_index,
            "import_rows must be deleted before import_batches"
        );
    }
}
