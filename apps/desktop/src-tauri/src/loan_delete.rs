// ---------------------------------------------------------------------
// Loan deletion - atomic, single-connection transaction.
//
// Same defect, same fix as loan_create.rs: LoanService.delete() used to
// issue `beginTransaction()`/several `execute()` calls (delete every
// loan_schedule_payments row, every loan_payment_schedule row,
// soft-delete goal_loan_links, soft-delete the loan itself, soft-delete
// its mirror account)/`commit()` through `SQLiteProvider`, each of
// which independently checks out a connection from
// `@tauri-apps/plugin-sql`'s sqlx pool. That gap is exactly what
// produced a real production bug: deleting a loan reported "error
// returned from database: (code: 1) cannot commit - no transaction is
// active" even though the deletes themselves had already run - because
// the final `COMMIT` could land on a different connection than the one
// that ran `BEGIN` and the deletes, which genuinely has no transaction
// to commit. The user saw a failure toast for an operation that had, in
// fact, (partially or fully, depending on exactly which statements
// landed on which connection) already taken effect.
//
// Acquiring one `sqlx::Transaction` here guarantees every statement of
// a delete shares one connection, with a real COMMIT on success and a
// real ROLLBACK (of every statement from this attempt, including ones
// that already "succeeded") on any failure - so a reported failure
// always means nothing happened, and a reported success always means
// everything did.
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
pub struct DeleteLoanAtomicRequest {
    pub loan_id: String,
    /// The loan's own mirror (liability) account, when it's safe to
    /// remove it too - the frontend decides this beforehand (no live
    /// transaction booked on it; see LoanService.delete's own doc
    /// comment), so this command only ever executes exactly what it's
    /// told, never a decision of its own.
    pub loan_account_id: Option<String>,
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
    request: &DeleteLoanAtomicRequest,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;

    let outcome: Result<(), sqlx::Error> = async {
        // Already confirmed empty by the caller (no recorded payments
        // is a precondition of deletion at all); deleting again here is
        // a defensive no-op, kept for symmetry with the schedule
        // cleanup below - mirrors the original create()/delete() shape.
        sqlx::query(
            "DELETE FROM loan_schedule_payments WHERE loan_id = ?",
        )
        .bind(&request.loan_id)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "DELETE FROM loan_payment_schedule WHERE loan_id = ?",
        )
        .bind(&request.loan_id)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            r#"
            UPDATE goal_loan_links
            SET deleted_at = CURRENT_TIMESTAMP
            WHERE loan_id = ?
              AND deleted_at IS NULL
            "#,
        )
        .bind(&request.loan_id)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "UPDATE loans SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(&request.loan_id)
        .execute(&mut *tx)
        .await?;

        if let Some(loan_account_id) = &request.loan_account_id {
            sqlx::query(
                "UPDATE accounts SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?",
            )
            .bind(loan_account_id)
            .execute(&mut *tx)
            .await?;
        }

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
            // import_reconciliation_reset.rs's run_reset and
            // loan_create.rs's run_create).
            let _ = tx.rollback().await;

            Err(error)
        }
    }
}

/// Deletes every loan-owned row for one loan - its schedule payments,
/// its EMI schedule, its goal-loan links (soft-deleted) and the loan
/// itself (soft-deleted) - and, when the caller determined it's safe
/// to, its own mirror liability account (also soft-deleted) - all
/// inside one real database transaction. Any failure rolls back every
/// statement from this attempt and leaves no dangling open transaction
/// on any connection.
#[tauri::command]
pub async fn delete_loan_atomic(
    app: AppHandle,
    request: DeleteLoanAtomicRequest,
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
                name TEXT NOT NULL,
                deleted_at TEXT
            );

            CREATE TABLE goals (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL
            );

            CREATE TABLE loans (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                loan_account_id TEXT,
                deleted_at TEXT,
                FOREIGN KEY (loan_account_id) REFERENCES accounts(id)
            );

            CREATE TABLE loan_payment_schedule (
                id TEXT PRIMARY KEY,
                loan_id TEXT NOT NULL,
                installment_number INTEGER NOT NULL,
                FOREIGN KEY (loan_id) REFERENCES loans(id)
            );

            CREATE TABLE loan_schedule_payments (
                id TEXT PRIMARY KEY,
                loan_id TEXT NOT NULL,
                schedule_id TEXT NOT NULL,
                amount REAL NOT NULL,
                FOREIGN KEY (loan_id) REFERENCES loans(id),
                FOREIGN KEY (schedule_id) REFERENCES loan_payment_schedule(id)
            );

            CREATE TABLE goal_loan_links (
                id TEXT PRIMARY KEY,
                goal_id TEXT NOT NULL,
                loan_id TEXT NOT NULL,
                deleted_at TEXT,
                FOREIGN KEY (goal_id) REFERENCES goals(id),
                FOREIGN KEY (loan_id) REFERENCES loans(id)
            );
            "#,
        )
        .execute(&pool)
        .await
        .expect("create focused test schema");

        pool
    }

    async fn seed_loan_and_its_links(pool: &Pool<Sqlite>) {
        sqlx::query(
            r#"
            INSERT INTO accounts (id, name) VALUES ('loan-acct-1', 'Production Test Loan');
            INSERT INTO goals (id, name) VALUES ('goal-1', 'Debt Free');
            INSERT INTO loans (id, name, loan_account_id) VALUES ('loan-1', 'Production Test Loan', 'loan-acct-1');
            INSERT INTO loan_payment_schedule (id, loan_id, installment_number) VALUES ('sched-1', 'loan-1', 1);
            INSERT INTO loan_schedule_payments (id, loan_id, schedule_id, amount) VALUES ('pay-1', 'loan-1', 'sched-1', 888.49);
            INSERT INTO goal_loan_links (id, goal_id, loan_id) VALUES ('link-1', 'goal-1', 'loan-1');
            "#,
        )
        .execute(pool)
        .await
        .expect("seed the loan and its owned rows");
    }

    /// A second, unrelated loan + account, to prove a delete never
    /// touches anything beyond the one loan it targets.
    async fn seed_unrelated_loan(pool: &Pool<Sqlite>) {
        sqlx::query(
            r#"
            INSERT INTO accounts (id, name) VALUES ('other-acct', 'Other Loan');
            INSERT INTO loans (id, name, loan_account_id) VALUES ('other-loan', 'Other Loan', 'other-acct');
            INSERT INTO loan_payment_schedule (id, loan_id, installment_number) VALUES ('other-sched', 'other-loan', 1);
            "#,
        )
        .execute(pool)
        .await
        .expect("seed an unrelated loan");
    }

    async fn count(pool: &Pool<Sqlite>, table: &str) -> i64 {
        let row = sqlx::query(&format!("SELECT COUNT(*) AS n FROM {table}"))
            .fetch_one(pool)
            .await
            .unwrap();

        row.get::<i64, _>("n")
    }

    async fn is_soft_deleted(
        pool: &Pool<Sqlite>,
        table: &str,
        id: &str,
    ) -> bool {
        let row = sqlx::query(&format!(
            "SELECT deleted_at FROM {table} WHERE id = ?"
        ))
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap();

        row.get::<Option<String>, _>("deleted_at").is_some()
    }

    #[tokio::test]
    async fn deletes_the_schedule_payments_the_schedule_soft_deletes_the_goal_link_the_loan_and_its_mirror_account_then_commits(
    ) {
        let pool = test_pool().await;
        seed_loan_and_its_links(&pool).await;

        run_delete(
            &pool,
            &DeleteLoanAtomicRequest {
                loan_id: "loan-1".to_string(),
                loan_account_id: Some("loan-acct-1".to_string()),
            },
        )
        .await
        .expect("delete succeeds");

        assert_eq!(count(&pool, "loan_schedule_payments").await, 0);
        assert_eq!(count(&pool, "loan_payment_schedule").await, 0);
        assert!(
            is_soft_deleted(&pool, "goal_loan_links", "link-1")
                .await
        );
        assert!(is_soft_deleted(&pool, "loans", "loan-1").await);
        assert!(
            is_soft_deleted(&pool, "accounts", "loan-acct-1")
                .await
        );
    }

    #[tokio::test]
    async fn leaves_the_mirror_account_untouched_when_the_caller_did_not_ask_for_it(
    ) {
        // Mirrors LoanService.delete's own safety rule: an account with
        // a live transaction booked on it is never deleted - the
        // frontend decides this and simply omits loan_account_id here.
        let pool = test_pool().await;
        seed_loan_and_its_links(&pool).await;

        run_delete(
            &pool,
            &DeleteLoanAtomicRequest {
                loan_id: "loan-1".to_string(),
                loan_account_id: None,
            },
        )
        .await
        .expect("delete succeeds");

        assert!(is_soft_deleted(&pool, "loans", "loan-1").await);
        assert!(
            !is_soft_deleted(&pool, "accounts", "loan-acct-1")
                .await,
            "the mirror account must be left alone when the caller didn't ask for it to be removed"
        );
    }

    #[tokio::test]
    async fn rolls_back_every_statement_when_a_later_one_fails_no_partial_delete(
    ) {
        let pool = test_pool().await;
        seed_loan_and_its_links(&pool).await;

        // Force a real failure after the payment and schedule deletes
        // have already run in this same attempt, by dropping the table
        // the next statement (the goal-link soft-delete) needs. (Not
        // `loans` itself - SQLite refuses to drop a table that other
        // tables' FOREIGN KEY constraints still reference.)
        sqlx::query("DROP TABLE goal_loan_links")
            .execute(&pool)
            .await
            .unwrap();

        let result = run_delete(
            &pool,
            &DeleteLoanAtomicRequest {
                loan_id: "loan-1".to_string(),
                loan_account_id: Some("loan-acct-1".to_string()),
            },
        )
        .await;

        assert!(result.is_err());

        // Nothing from this attempt was left behind - not even the
        // schedule/payment deletes that already ran earlier in the
        // same transaction.
        assert_eq!(count(&pool, "loan_schedule_payments").await, 1);
        assert_eq!(count(&pool, "loan_payment_schedule").await, 1);
        assert!(
            !is_soft_deleted(&pool, "loans", "loan-1").await
        );
        assert!(
            !is_soft_deleted(&pool, "accounts", "loan-acct-1")
                .await
        );
    }

    #[tokio::test]
    async fn leaves_no_dangling_transaction_or_lock_after_a_failed_delete(
    ) {
        let pool = test_pool().await;
        seed_loan_and_its_links(&pool).await;
        seed_unrelated_loan(&pool).await;

        sqlx::query("DROP TABLE goal_loan_links")
            .execute(&pool)
            .await
            .unwrap();

        let failed = run_delete(
            &pool,
            &DeleteLoanAtomicRequest {
                loan_id: "loan-1".to_string(),
                loan_account_id: Some("loan-acct-1".to_string()),
            },
        )
        .await;
        assert!(failed.is_err());

        // The single connection in this pool must be fully released -
        // an unrelated, independent write on the same pool must
        // succeed immediately, with no "database is locked" / "cannot
        // commit - no transaction is active" left over.
        sqlx::query(
            "UPDATE accounts SET name = ? WHERE id = 'other-acct'",
        )
        .bind("Renamed")
        .execute(&pool)
        .await
        .expect("a fresh write on the same pool succeeds cleanly");
    }

    #[tokio::test]
    async fn a_fresh_accounts_query_excludes_the_deleted_mirror_account_afterwards(
    ) {
        // Dashboard's Accounts Summary and AccountService.getAll() both
        // read accounts through exactly this filter
        // (AccountRepository.getAll's `WHERE accounts.deleted_at IS
        // NULL`) - proving a fresh run of it excludes the mirror
        // account right after delete is what actually rules out BUG 2
        // (the deleted loan still showing on Dashboard) being a
        // Dashboard-side staleness/caching problem: the data itself is
        // correct the instant this transaction commits, so any fresh
        // read (Dashboard's own useEffect re-fetches on every mount)
        // already reflects it with no extra invalidation needed.
        let pool = test_pool().await;
        seed_loan_and_its_links(&pool).await;
        seed_unrelated_loan(&pool).await;

        run_delete(
            &pool,
            &DeleteLoanAtomicRequest {
                loan_id: "loan-1".to_string(),
                loan_account_id: Some("loan-acct-1".to_string()),
            },
        )
        .await
        .expect("delete succeeds");

        let visible_account_ids: Vec<String> = sqlx::query(
            "SELECT id FROM accounts WHERE deleted_at IS NULL",
        )
        .fetch_all(&pool)
        .await
        .unwrap()
        .iter()
        .map(|row| row.get::<String, _>("id"))
        .collect();

        assert!(
            !visible_account_ids.contains(&"loan-acct-1".to_string()),
            "the deleted loan's mirror account must not appear in a fresh accounts query"
        );
        assert!(
            visible_account_ids.contains(&"other-acct".to_string()),
            "an unrelated account must still appear"
        );
    }

    #[tokio::test]
    async fn never_touches_an_unrelated_loan_or_account() {
        let pool = test_pool().await;
        seed_loan_and_its_links(&pool).await;
        seed_unrelated_loan(&pool).await;

        run_delete(
            &pool,
            &DeleteLoanAtomicRequest {
                loan_id: "loan-1".to_string(),
                loan_account_id: Some("loan-acct-1".to_string()),
            },
        )
        .await
        .expect("delete succeeds");

        assert!(!is_soft_deleted(&pool, "loans", "other-loan").await);
        assert!(
            !is_soft_deleted(&pool, "accounts", "other-acct").await
        );
        assert_eq!(count(&pool, "loan_payment_schedule").await, 1);
    }
}
