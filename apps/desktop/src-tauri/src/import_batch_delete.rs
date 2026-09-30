// ---------------------------------------------------------------------
// Import History deletion - atomic, single-connection transaction.
//
// Same defect class, same fix as loan_create.rs/loan_delete.rs:
// `@tauri-apps/plugin-sql`'s `execute()`/`select()` each independently
// check out a connection from the sqlx pool per call, so a
// `beginTransaction()`/several `execute()` calls/`commit()` sequence
// issued from TypeScript cannot guarantee every statement of a
// multi-statement delete lands on the same connection - which is what
// let loan creation/deletion leave a dangling transaction behind on
// failure. Deleting an import batch requires two statements (its
// import_rows, then the import_batches row itself - import_rows.
// import_batch_id has a FOREIGN KEY on import_batches(id), so the rows
// must go first), so this uses the same real `sqlx::Transaction`
// pattern rather than the old fake-transaction one.
//
// Deliberately narrow: this ONLY ever deletes import_batches and
// import_rows rows for the one given batch id. It never touches
// `transactions` - import_rows.transaction_id references a transaction
// but deleting the import_rows row does not cascade to it (no ON
// DELETE CASCADE in the schema, and this command issues no DELETE
// against `transactions` at all) - so every transaction created from
// this import remains exactly as it is, imported or not.
// ---------------------------------------------------------------------

use serde::Deserialize;
use sqlx::{Pool, Sqlite};
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

/// The exact connection string FinWea's frontend uses - see
/// `SQLiteProvider.connect()` (`Database.load("sqlite:financeos.db")`).
const DB_KEY: &str = "sqlite:financeos.db";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteImportBatchAtomicRequest {
    pub batch_id: String,
}

async fn sqlite_pool(app: &AppHandle) -> Result<Pool<Sqlite>, String> {
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;

    match lock.get(DB_KEY) {
        Some(DbPool::Sqlite(pool)) => Ok(pool.clone()),
        _ => Err("FinWea's database is not connected yet.".to_string()),
    }
}

async fn run_delete(
    pool: &Pool<Sqlite>,
    request: &DeleteImportBatchAtomicRequest,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;

    let outcome: Result<(), sqlx::Error> = async {
        sqlx::query(
            "DELETE FROM import_rows WHERE import_batch_id = ?",
        )
        .bind(&request.batch_id)
        .execute(&mut *tx)
        .await?;

        sqlx::query("DELETE FROM import_batches WHERE id = ?")
            .bind(&request.batch_id)
            .execute(&mut *tx)
            .await?;

        Ok(())
    }
    .await;

    match outcome {
        Ok(()) => {
            tx.commit().await?;
            Ok(())
        }
        Err(error) => {
            // A dropped `tx` also rolls back automatically, but doing it
            // explicitly makes the intent unambiguous here (mirrors
            // import_reconciliation_reset.rs / loan_create.rs /
            // loan_delete.rs).
            let _ = tx.rollback().await;

            Err(error)
        }
    }
}

/// Deletes one Import History record - its import_rows and the
/// import_batches row itself - inside one real database transaction.
/// Never deletes, and never even references, any `transactions` row:
/// financial transactions already created from this import (or from
/// any other) are always left exactly as they are. Any failure rolls
/// back both statements from this attempt and leaves no dangling open
/// transaction on any connection.
#[tauri::command]
pub async fn delete_import_batch_atomic(
    app: AppHandle,
    request: DeleteImportBatchAtomicRequest,
) -> Result<(), String> {
    let pool = sqlite_pool(&app).await?;

    run_delete(&pool, &request)
        .await
        .map_err(|error| error.to_string())
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

        sqlx::query(
            r#"
            CREATE TABLE accounts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL
            );

            CREATE TABLE transactions (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                amount REAL NOT NULL,
                FOREIGN KEY (account_id) REFERENCES accounts(id)
            );

            CREATE TABLE import_batches (
                id TEXT PRIMARY KEY,
                account_id TEXT,
                source_file_name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'PENDING',
                FOREIGN KEY (account_id) REFERENCES accounts(id)
            );

            CREATE TABLE import_rows (
                id TEXT PRIMARY KEY,
                import_batch_id TEXT NOT NULL,
                row_number INTEGER NOT NULL,
                transaction_id TEXT,
                FOREIGN KEY (import_batch_id) REFERENCES import_batches(id),
                FOREIGN KEY (transaction_id) REFERENCES transactions(id)
            );
            "#,
        )
        .execute(&pool)
        .await
        .expect("create focused test schema");

        pool
    }

    async fn seed_completed_import(pool: &Pool<Sqlite>) {
        sqlx::query(
            r#"
            INSERT INTO accounts (id, name) VALUES ('acct-1', 'Hardik D Acharya');
            INSERT INTO transactions (id, account_id, amount) VALUES ('txn-1', 'acct-1', 100.0);
            INSERT INTO transactions (id, account_id, amount) VALUES ('txn-2', 'acct-1', 200.0);
            INSERT INTO import_batches (id, account_id, source_file_name, status)
                VALUES ('batch-1', 'acct-1', 'AccountStatement_23092026_144703.xlsx', 'COMPLETED');
            INSERT INTO import_rows (id, import_batch_id, row_number, transaction_id)
                VALUES ('row-1', 'batch-1', 1, 'txn-1');
            INSERT INTO import_rows (id, import_batch_id, row_number, transaction_id)
                VALUES ('row-2', 'batch-1', 2, 'txn-2');
            "#,
        )
        .execute(pool)
        .await
        .expect("seed a completed import batch with rows and real transactions");
    }

    async fn seed_unrelated_import(pool: &Pool<Sqlite>) {
        sqlx::query(
            r#"
            INSERT INTO import_batches (id, account_id, source_file_name, status)
                VALUES ('batch-2', 'acct-1', 'other-statement.xlsx', 'COMPLETED');
            INSERT INTO import_rows (id, import_batch_id, row_number, transaction_id)
                VALUES ('row-3', 'batch-2', 1, NULL);
            "#,
        )
        .execute(pool)
        .await
        .expect("seed an unrelated import batch");
    }

    async fn count(pool: &Pool<Sqlite>, table: &str) -> i64 {
        let row = sqlx::query(&format!("SELECT COUNT(*) AS n FROM {table}"))
            .fetch_one(pool)
            .await
            .unwrap();

        row.get::<i64, _>("n")
    }

    #[tokio::test]
    async fn deletes_the_batch_and_its_rows_but_never_the_transactions_then_commits(
    ) {
        let pool = test_pool().await;
        seed_completed_import(&pool).await;

        run_delete(
            &pool,
            &DeleteImportBatchAtomicRequest {
                batch_id: "batch-1".to_string(),
            },
        )
        .await
        .expect("delete succeeds");

        assert_eq!(count(&pool, "import_batches").await, 0);
        assert_eq!(count(&pool, "import_rows").await, 0);

        // The whole point: financial transactions from this import
        // remain untouched.
        assert_eq!(count(&pool, "transactions").await, 2);
        let txn = sqlx::query(
            "SELECT amount FROM transactions WHERE id = 'txn-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(txn.get::<f64, _>("amount"), 100.0);
    }

    #[tokio::test]
    async fn rolls_back_everything_when_a_later_statement_fails_no_partial_delete(
    ) {
        let pool = test_pool().await;
        seed_completed_import(&pool).await;

        // Force a real failure on the SECOND statement (deleting the
        // import_batches row itself), after the import_rows delete has
        // already run in this same attempt - via a trigger rather than
        // dropping import_batches, since SQLite (with foreign_keys=ON)
        // refuses to drop a table that import_rows' own FOREIGN KEY
        // still references.
        sqlx::query(
            r#"
            CREATE TRIGGER block_batch_delete
            BEFORE DELETE ON import_batches
            WHEN OLD.id = 'batch-1'
            BEGIN
                SELECT RAISE(FAIL, 'simulated failure');
            END;
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();

        let result = run_delete(
            &pool,
            &DeleteImportBatchAtomicRequest {
                batch_id: "batch-1".to_string(),
            },
        )
        .await;

        assert!(result.is_err());

        // Nothing from this attempt was left behind - not even the
        // import_rows delete that already ran earlier in the same
        // transaction.
        assert_eq!(count(&pool, "import_rows").await, 2);
        assert_eq!(count(&pool, "transactions").await, 2);
    }

    #[tokio::test]
    async fn leaves_no_dangling_transaction_or_lock_after_a_failed_delete(
    ) {
        let pool = test_pool().await;
        seed_completed_import(&pool).await;
        seed_unrelated_import(&pool).await;

        sqlx::query(
            r#"
            CREATE TRIGGER block_batch_delete
            BEFORE DELETE ON import_batches
            WHEN OLD.id = 'batch-1'
            BEGIN
                SELECT RAISE(FAIL, 'simulated failure');
            END;
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();

        let failed = run_delete(
            &pool,
            &DeleteImportBatchAtomicRequest {
                batch_id: "batch-1".to_string(),
            },
        )
        .await;
        assert!(failed.is_err());

        // The single connection in this pool must be fully released -
        // an unrelated, independent write on the same pool must
        // succeed immediately, with no dangling lock left over.
        sqlx::query(
            "UPDATE import_rows SET row_number = 99 WHERE id = 'row-3'",
        )
        .execute(&pool)
        .await
        .expect("a fresh write on the same pool succeeds cleanly");
    }

    #[tokio::test]
    async fn never_touches_an_unrelated_import_batch() {
        let pool = test_pool().await;
        seed_completed_import(&pool).await;
        seed_unrelated_import(&pool).await;

        run_delete(
            &pool,
            &DeleteImportBatchAtomicRequest {
                batch_id: "batch-1".to_string(),
            },
        )
        .await
        .expect("delete succeeds");

        assert_eq!(count(&pool, "import_batches").await, 1);
        assert_eq!(count(&pool, "import_rows").await, 1);

        let remaining = sqlx::query(
            "SELECT id FROM import_batches LIMIT 1",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(remaining.get::<String, _>("id"), "batch-2");
    }
}
