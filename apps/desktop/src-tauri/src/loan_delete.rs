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
// to commit.
//
// Acquiring one `sqlx::Transaction` here guarantees every statement of
// a delete shares one connection, with a real COMMIT on success and a
// real ROLLBACK (of every statement from this attempt, including ones
// that already "succeeded") on any failure - so a reported failure
// always means nothing happened, and a reported success always means
// everything did.
//
// Every protective rule is checked HERE, inside that same transaction,
// before anything is written - never only by the JavaScript caller
// beforehand (which can be stale, or skipped):
//   - the loan must exist and not already be deleted;
//   - no recorded EMI payment (loan_schedule_payments) - its history;
//   - no Overdraft transaction link - an OD's history;
//   - no live financial plan component that uses the loan - it is the
//     user's to remove from the plan, never silently dropped here.
// A refusal changes nothing.
//
// What a successful delete removes is ONLY this loan's own records:
//   hard-deleted  its EMI schedule, its Add Loan setup records (initial
//                 expenses before disbursements, which they may point
//                 at) and its Overdraft account links (overdraft_accounts);
//   soft-deleted  its goal links, the loan itself and - when no live
//                 transaction is booked on it and the caller allows it -
//                 its own mirror (liability) account.
// Never touched: any bank transaction, import batch / import row, category,
// financial plan component, or any other loan's records.
// ---------------------------------------------------------------------

use serde::Deserialize;
use sqlx::{Pool, Row, Sqlite};
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

/// The exact connection string FinWea's frontend uses - see
/// `SQLiteProvider.connect()` (`Database.load("sqlite:financeos.db")`).
const DB_KEY: &str = "sqlite:financeos.db";

/// Prefix of a business-rule refusal. LoanService.delete shows the text
/// after it to the user as-is.
pub const REFUSED: &str = "LOAN_DELETE_REFUSED: ";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteLoanAtomicRequest {
    pub loan_id: String,
    /// The loan's own mirror (liability) account, when the caller allows
    /// removing it too. It must be THIS loan's mirror account, and it is
    /// still only soft-deleted when - re-checked here - no live
    /// transaction is booked on it and no other live loan uses it.
    /// None: the account is left exactly as it is.
    pub loan_account_id: Option<String>,
}

#[derive(Debug)]
pub enum DeleteLoanError {
    /// A protective rule refused the delete - nothing was changed.
    Refused(String),
    Database(sqlx::Error),
}

impl From<sqlx::Error> for DeleteLoanError {
    fn from(error: sqlx::Error) -> Self {
        DeleteLoanError::Database(error)
    }
}

impl DeleteLoanError {
    fn into_message(self) -> String {
        match self {
            DeleteLoanError::Refused(reason) => format!("{REFUSED}{reason}"),
            DeleteLoanError::Database(error) => error.to_string(),
        }
    }
}

async fn sqlite_pool(app: &AppHandle) -> Result<Pool<Sqlite>, String> {
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;

    match lock.get(DB_KEY) {
        Some(DbPool::Sqlite(pool)) => Ok(pool.clone()),
        _ => Err("FinWea's database is not connected yet.".to_string()),
    }
}

async fn count(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    sql: &str,
    id: &str,
) -> Result<i64, sqlx::Error> {
    Ok(sqlx::query(sql)
        .bind(id)
        .fetch_one(&mut **tx)
        .await?
        .get::<i64, _>("n"))
}

/// The protective rules, read inside the delete's own transaction.
/// Returns the loan's own mirror account id (as stored on the loan).
async fn check_deletable(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    request: &DeleteLoanAtomicRequest,
) -> Result<Option<String>, DeleteLoanError> {
    let loan = sqlx::query(
        "SELECT loan_account_id FROM loans WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&request.loan_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| {
        DeleteLoanError::Refused(
            "This loan was not found. It may have already been deleted.".to_string(),
        )
    })?;

    let loan_account_id: Option<String> = loan.get("loan_account_id");

    let payments = count(
        tx,
        "SELECT COUNT(*) AS n FROM loan_schedule_payments WHERE loan_id = ?",
        &request.loan_id,
    )
    .await?;

    if payments > 0 {
        return Err(DeleteLoanError::Refused(
            "This loan has recorded payments and can't be deleted. Reverse every payment from the loan's EMI schedule first, then try again.".to_string(),
        ));
    }

    let overdraft_links = count(
        tx,
        "SELECT COUNT(*) AS n FROM overdraft_transaction_links WHERE loan_id = ?",
        &request.loan_id,
    )
    .await?;

    if overdraft_links > 0 {
        return Err(DeleteLoanError::Refused(
            "This overdraft has linked transactions and can't be deleted. Unlink them first (Transactions, the green loan icon, Unlink), then try again.".to_string(),
        ));
    }

    let plans: Vec<String> = sqlx::query(
        r#"
        SELECT DISTINCT p.name
        FROM financial_plan_components c
        JOIN financial_plans p ON p.id = c.plan_id
        WHERE c.loan_id = ?
          AND c.deleted_at IS NULL
          AND p.deleted_at IS NULL
        ORDER BY p.name
        "#,
    )
    .bind(&request.loan_id)
    .fetch_all(&mut **tx)
    .await?
    .iter()
    .map(|row| row.get::<String, _>("name"))
    .collect();

    if !plans.is_empty() {
        return Err(DeleteLoanError::Refused(format!(
            "This loan is used in the financial plan{} {}. Remove it from {} first, then try again.",
            if plans.len() == 1 { "" } else { "s" },
            plans
                .iter()
                .map(|name| format!("\"{name}\""))
                .collect::<Vec<_>>()
                .join(", "),
            if plans.len() == 1 { "that plan" } else { "those plans" },
        )));
    }

    if let Some(requested) = &request.loan_account_id {
        if loan_account_id.as_deref() != Some(requested.as_str()) {
            return Err(DeleteLoanError::Refused(
                "The account to remove is not this loan's own loan account.".to_string(),
            ));
        }
    }

    Ok(loan_account_id)
}

async fn delete_steps(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    request: &DeleteLoanAtomicRequest,
) -> Result<(), DeleteLoanError> {
    let loan_account_id = check_deletable(tx, request).await?;

    // No payment can reference the schedule any more (refused above).
    sqlx::query("DELETE FROM loan_payment_schedule WHERE loan_id = ?")
        .bind(&request.loan_id)
        .execute(&mut **tx)
        .await?;

    // The Add Loan setup records (migration 051) belong to this loan
    // only. They are removed with it so the bank transactions they
    // pointed at are free to be linked again (e.g. by a recreated
    // loan). The bank transactions themselves are never touched.
    // Expenses first: they may reference a disbursement.
    sqlx::query("DELETE FROM loan_initial_expenses WHERE loan_id = ?")
        .bind(&request.loan_id)
        .execute(&mut **tx)
        .await?;

    sqlx::query("DELETE FROM loan_disbursements WHERE loan_id = ?")
        .bind(&request.loan_id)
        .execute(&mut **tx)
        .await?;

    // An Overdraft's bank-account links (migration 048) describe only this
    // loan; the bank accounts themselves stay.
    sqlx::query("DELETE FROM overdraft_accounts WHERE loan_id = ?")
        .bind(&request.loan_id)
        .execute(&mut **tx)
        .await?;

    // Dropline steps (migration 053) exist only once that table does.
    let has_dropline_table = sqlx::query(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'loan_drawing_power_schedule'",
    )
    .fetch_optional(&mut **tx)
    .await?
    .is_some();

    if has_dropline_table {
        sqlx::query("DELETE FROM loan_drawing_power_schedule WHERE loan_id = ?")
            .bind(&request.loan_id)
            .execute(&mut **tx)
            .await?;
    }

    sqlx::query(
        r#"
        UPDATE goal_loan_links
        SET deleted_at = CURRENT_TIMESTAMP
        WHERE loan_id = ?
          AND deleted_at IS NULL
        "#,
    )
    .bind(&request.loan_id)
    .execute(&mut **tx)
    .await?;

    let deleted = sqlx::query(
        "UPDATE loans SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&request.loan_id)
    .execute(&mut **tx)
    .await?;

    if deleted.rows_affected() != 1 {
        return Err(DeleteLoanError::Refused(
            "This loan was not found. It may have already been deleted.".to_string(),
        ));
    }

    // The mirror account goes only when the caller allows it AND, re-checked
    // now, nothing still uses it: no live transaction booked on it, and no
    // other live loan pointing at it.
    if let (Some(_), Some(account_id)) = (&request.loan_account_id, &loan_account_id) {
        let in_use = count(
            tx,
            r#"
            SELECT
                (SELECT COUNT(*) FROM transactions WHERE account_id = ?1 AND deleted_at IS NULL)
              + (SELECT COUNT(*) FROM loans WHERE deleted_at IS NULL AND (loan_account_id = ?1 OR account_id = ?1))
                AS n
            "#,
            account_id,
        )
        .await?;

        if in_use == 0 {
            sqlx::query(
                "UPDATE accounts SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL",
            )
            .bind(account_id)
            .execute(&mut **tx)
            .await?;
        }
    }

    Ok(())
}

async fn run_delete(
    pool: &Pool<Sqlite>,
    request: &DeleteLoanAtomicRequest,
) -> Result<(), DeleteLoanError> {
    let mut tx = pool.begin().await?;

    match delete_steps(&mut tx, request).await {
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

/// Deletes one loan - see the header comment for exactly what is removed,
/// what is refused, and what is never touched - inside one real database
/// transaction. Any refusal or failure rolls back every statement from
/// this attempt and leaves no dangling open transaction on any connection.
#[tauri::command]
pub async fn delete_loan_atomic(
    app: AppHandle,
    request: DeleteLoanAtomicRequest,
) -> Result<(), String> {
    let pool = sqlite_pool(&app).await?;

    run_delete(&pool, &request)
        .await
        .map_err(DeleteLoanError::into_message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

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

            CREATE TABLE categories (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL
            );

            CREATE TABLE goals (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL
            );

            CREATE TABLE loans (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                account_id TEXT,
                loan_account_id TEXT,
                loan_kind TEXT NOT NULL DEFAULT 'TERM_LOAN',
                deleted_at TEXT,
                FOREIGN KEY (account_id) REFERENCES accounts(id),
                FOREIGN KEY (loan_account_id) REFERENCES accounts(id)
            );

            CREATE TABLE transactions (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL DEFAULT 'bank',
                category_id TEXT,
                amount REAL NOT NULL,
                deleted_at TEXT
            );

            CREATE TABLE loan_payment_schedule (
                id TEXT PRIMARY KEY,
                loan_id TEXT NOT NULL,
                installment_number INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'UPCOMING',
                transaction_id TEXT,
                settled_before_finwea INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (loan_id) REFERENCES loans(id),
                FOREIGN KEY (transaction_id) REFERENCES transactions(id)
            );

            CREATE TABLE loan_schedule_payments (
                id TEXT PRIMARY KEY,
                loan_id TEXT NOT NULL,
                schedule_id TEXT NOT NULL,
                transaction_id TEXT,
                amount REAL NOT NULL,
                FOREIGN KEY (loan_id) REFERENCES loans(id),
                FOREIGN KEY (schedule_id) REFERENCES loan_payment_schedule(id),
                FOREIGN KEY (transaction_id) REFERENCES transactions(id)
            );

            CREATE TABLE loan_disbursements (
                id TEXT PRIMARY KEY,
                loan_id TEXT NOT NULL,
                transaction_id TEXT,
                FOREIGN KEY (loan_id) REFERENCES loans(id),
                FOREIGN KEY (transaction_id) REFERENCES transactions(id)
            );

            CREATE TABLE loan_initial_expenses (
                id TEXT PRIMARY KEY,
                loan_id TEXT NOT NULL,
                disbursement_id TEXT,
                transaction_id TEXT,
                FOREIGN KEY (loan_id) REFERENCES loans(id),
                FOREIGN KEY (disbursement_id) REFERENCES loan_disbursements(id),
                FOREIGN KEY (transaction_id) REFERENCES transactions(id)
            );

            CREATE TABLE overdraft_accounts (
                id TEXT PRIMARY KEY,
                loan_id TEXT NOT NULL,
                account_id TEXT NOT NULL,
                UNIQUE (loan_id, account_id),
                FOREIGN KEY (loan_id) REFERENCES loans(id),
                FOREIGN KEY (account_id) REFERENCES accounts(id)
            );

            CREATE TABLE overdraft_transaction_links (
                id TEXT PRIMARY KEY,
                loan_id TEXT NOT NULL,
                transaction_id TEXT NOT NULL UNIQUE,
                FOREIGN KEY (loan_id) REFERENCES loans(id),
                FOREIGN KEY (transaction_id) REFERENCES transactions(id)
            );

            CREATE TABLE financial_plans (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                deleted_at TEXT
            );

            CREATE TABLE financial_plan_components (
                id TEXT PRIMARY KEY,
                plan_id TEXT NOT NULL,
                loan_id TEXT,
                deleted_at TEXT,
                FOREIGN KEY (plan_id) REFERENCES financial_plans(id),
                FOREIGN KEY (loan_id) REFERENCES loans(id)
            );

            CREATE TABLE goal_loan_links (
                id TEXT PRIMARY KEY,
                goal_id TEXT NOT NULL,
                loan_id TEXT NOT NULL,
                deleted_at TEXT,
                FOREIGN KEY (goal_id) REFERENCES goals(id),
                FOREIGN KEY (loan_id) REFERENCES loans(id)
            );

            CREATE TABLE import_batches (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL
            );

            CREATE TABLE import_rows (
                id TEXT PRIMARY KEY,
                import_batch_id TEXT NOT NULL,
                transaction_id TEXT,
                FOREIGN KEY (import_batch_id) REFERENCES import_batches(id),
                FOREIGN KEY (transaction_id) REFERENCES transactions(id)
            );

            INSERT INTO accounts (id, name) VALUES ('bank', 'Netedge 3999');
            "#,
        )
        .execute(&pool)
        .await
        .expect("create focused test schema");

        pool
    }

    /// A term loan with no recorded payments: its schedule, a goal link,
    /// and its Add Loan setup records pointing at two real bank
    /// transactions (which also have import history).
    async fn seed_loan_and_its_links(pool: &Pool<Sqlite>) {
        sqlx::query(
            r#"
            INSERT INTO accounts (id, name) VALUES ('loan-acct-1', 'Production Test Loan');
            INSERT INTO categories (id, name) VALUES ('cat-fee', 'Bank Charges');
            INSERT INTO goals (id, name) VALUES ('goal-1', 'Debt Free');
            INSERT INTO loans (id, name, account_id, loan_account_id) VALUES ('loan-1', 'Production Test Loan', 'bank', 'loan-acct-1');
            INSERT INTO loan_payment_schedule (id, loan_id, installment_number, status, settled_before_finwea)
                VALUES ('sched-1', 'loan-1', 1, 'PAID', 1), ('sched-2', 'loan-1', 2, 'UPCOMING', 0);
            INSERT INTO goal_loan_links (id, goal_id, loan_id) VALUES ('link-1', 'goal-1', 'loan-1');
            INSERT INTO transactions (id, amount, category_id) VALUES ('credit', 712182, NULL), ('fee', 10620, 'cat-fee');
            INSERT INTO import_batches (id, account_id) VALUES ('batch-1', 'bank');
            INSERT INTO import_rows (id, import_batch_id, transaction_id) VALUES ('row-1', 'batch-1', 'credit'), ('row-2', 'batch-1', 'fee');
            INSERT INTO loan_disbursements (id, loan_id, transaction_id) VALUES ('d1', 'loan-1', 'credit');
            INSERT INTO loan_initial_expenses (id, loan_id, disbursement_id, transaction_id) VALUES
                ('e1', 'loan-1', 'd1', NULL),
                ('e2', 'loan-1', NULL, 'fee');
            "#,
        )
        .execute(pool)
        .await
        .expect("seed the loan and its owned rows");
    }

    /// A second, unrelated loan with its own schedule, payment, setup
    /// record and plan component - none of it may ever be touched.
    async fn seed_unrelated_loan(pool: &Pool<Sqlite>) {
        sqlx::query(
            r#"
            INSERT INTO accounts (id, name) VALUES ('other-acct', 'Other Loan');
            INSERT INTO loans (id, name, loan_account_id) VALUES ('other-loan', 'Other Loan', 'other-acct');
            INSERT INTO loan_payment_schedule (id, loan_id, installment_number) VALUES ('other-sched', 'other-loan', 1);
            INSERT INTO transactions (id, amount) VALUES ('other-emi', 5000), ('other-credit', 90000);
            INSERT INTO loan_schedule_payments (id, loan_id, schedule_id, transaction_id, amount)
                VALUES ('other-pay', 'other-loan', 'other-sched', 'other-emi', 5000);
            INSERT INTO loan_disbursements (id, loan_id, transaction_id) VALUES ('d-other', 'other-loan', 'other-credit');
            INSERT INTO financial_plans (id, name) VALUES ('plan-other', 'Other Plan');
            INSERT INTO financial_plan_components (id, plan_id, loan_id) VALUES ('c-other', 'plan-other', 'other-loan');
            "#,
        )
        .execute(pool)
        .await
        .expect("seed an unrelated loan");
    }

    async fn count_rows(pool: &Pool<Sqlite>, table: &str) -> i64 {
        sqlx::query(&format!("SELECT COUNT(*) AS n FROM {table}"))
            .fetch_one(pool)
            .await
            .unwrap()
            .get::<i64, _>("n")
    }

    async fn is_soft_deleted(pool: &Pool<Sqlite>, table: &str, id: &str) -> bool {
        sqlx::query(&format!("SELECT deleted_at FROM {table} WHERE id = ?"))
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap()
            .get::<Option<String>, _>("deleted_at")
            .is_some()
    }

    fn delete_request(loan_account_id: Option<&str>) -> DeleteLoanAtomicRequest {
        DeleteLoanAtomicRequest {
            loan_id: "loan-1".to_string(),
            loan_account_id: loan_account_id.map(str::to_string),
        }
    }

    fn refusal(result: Result<(), DeleteLoanError>) -> String {
        match result {
            Err(DeleteLoanError::Refused(message)) => message,
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    /// Every row of the given tables, as text - to prove nothing changed.
    async fn snapshot(pool: &Pool<Sqlite>, tables: &[&str]) -> Vec<String> {
        let mut out = Vec::new();

        for table in tables {
            let rows = sqlx::query(&format!("SELECT * FROM {table} ORDER BY 1"))
                .fetch_all(pool)
                .await
                .unwrap();

            for row in rows {
                let mut values = Vec::new();

                for index in 0..sqlx::Row::len(&row) {
                    let value: Option<String> = row
                        .try_get::<Option<String>, _>(index)
                        .or_else(|_| row.try_get::<Option<f64>, _>(index).map(|v| v.map(|n| n.to_string())))
                        .or_else(|_| row.try_get::<Option<i64>, _>(index).map(|v| v.map(|n| n.to_string())))
                        .unwrap_or(None);
                    values.push(value.unwrap_or_else(|| "NULL".to_string()));
                }

                out.push(format!("{table}: {}", values.join("|")));
            }
        }

        out
    }

    const PROTECTED_TABLES: &[&str] = &[
        "transactions",
        "categories",
        "import_batches",
        "import_rows",
        "financial_plans",
        "financial_plan_components",
        "loan_schedule_payments",
    ];

    #[tokio::test]
    async fn deletes_the_schedule_the_setup_records_soft_deletes_the_goal_link_the_loan_and_its_mirror_account() {
        let pool = test_pool().await;
        seed_loan_and_its_links(&pool).await;

        run_delete(&pool, &delete_request(Some("loan-acct-1")))
            .await
            .expect("delete succeeds");

        assert_eq!(count_rows(&pool, "loan_payment_schedule").await, 0);
        assert_eq!(count_rows(&pool, "loan_initial_expenses").await, 0);
        assert_eq!(count_rows(&pool, "loan_disbursements").await, 0);
        assert!(is_soft_deleted(&pool, "goal_loan_links", "link-1").await);
        assert!(is_soft_deleted(&pool, "loans", "loan-1").await);
        assert!(is_soft_deleted(&pool, "accounts", "loan-acct-1").await);
    }

    #[tokio::test]
    async fn keeps_every_bank_transaction_its_category_and_its_import_history() {
        let pool = test_pool().await;
        seed_loan_and_its_links(&pool).await;
        seed_unrelated_loan(&pool).await;
        let before = snapshot(&pool, PROTECTED_TABLES).await;

        run_delete(&pool, &delete_request(Some("loan-acct-1")))
            .await
            .expect("delete succeeds");

        assert_eq!(snapshot(&pool, PROTECTED_TABLES).await, before);
        assert!(!is_soft_deleted(&pool, "accounts", "bank").await, "the EMI bank account stays");
    }

    #[tokio::test]
    async fn removes_only_the_target_loans_setup_records_and_never_touches_an_unrelated_loan() {
        let pool = test_pool().await;
        seed_loan_and_its_links(&pool).await;
        seed_unrelated_loan(&pool).await;

        run_delete(&pool, &delete_request(Some("loan-acct-1")))
            .await
            .expect("delete succeeds");

        assert_eq!(count_rows(&pool, "loan_disbursements").await, 1, "only the other loan's disbursement remains");
        assert_eq!(count_rows(&pool, "loan_payment_schedule").await, 1, "only the other loan's schedule remains");
        assert_eq!(count_rows(&pool, "loan_schedule_payments").await, 1, "the other loan's payment remains");
        assert!(!is_soft_deleted(&pool, "loans", "other-loan").await);
        assert!(!is_soft_deleted(&pool, "accounts", "other-acct").await);
    }

    #[tokio::test]
    async fn refuses_a_loan_with_recorded_payments_and_changes_nothing() {
        let pool = test_pool().await;
        seed_loan_and_its_links(&pool).await;
        sqlx::query(
            r#"
            INSERT INTO transactions (id, amount) VALUES ('emi-1', 888.49);
            INSERT INTO loan_schedule_payments (id, loan_id, schedule_id, transaction_id, amount)
                VALUES ('pay-1', 'loan-1', 'sched-2', 'emi-1', 888.49);
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
        let before = snapshot(&pool, &["loans", "accounts", "loan_payment_schedule", "loan_disbursements", "loan_initial_expenses", "goal_loan_links", "loan_schedule_payments"]).await;

        let message = refusal(run_delete(&pool, &delete_request(Some("loan-acct-1"))).await);

        assert!(message.contains("recorded payments"), "{message}");
        assert_eq!(
            snapshot(&pool, &["loans", "accounts", "loan_payment_schedule", "loan_disbursements", "loan_initial_expenses", "goal_loan_links", "loan_schedule_payments"]).await,
            before
        );
    }

    #[tokio::test]
    async fn refuses_an_overdraft_with_linked_transactions() {
        let pool = test_pool().await;
        sqlx::query(
            r#"
            INSERT INTO accounts (id, name) VALUES ('od-acct', 'TATA OD'), ('bank-2', 'Netedge 2790');
            INSERT INTO loans (id, name, account_id, loan_account_id, loan_kind) VALUES ('loan-1', 'TATA OD', 'bank', 'od-acct', 'OVERDRAFT');
            INSERT INTO overdraft_accounts (id, loan_id, account_id) VALUES ('oa-1', 'loan-1', 'bank'), ('oa-2', 'loan-1', 'bank-2');
            INSERT INTO transactions (id, amount) VALUES ('repay', 1000000);
            INSERT INTO overdraft_transaction_links (id, loan_id, transaction_id) VALUES ('odl-1', 'loan-1', 'repay');
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();

        let message = refusal(run_delete(&pool, &delete_request(Some("od-acct"))).await);

        assert!(message.contains("linked transactions"), "{message}");
        assert_eq!(count_rows(&pool, "overdraft_accounts").await, 2);
        assert_eq!(count_rows(&pool, "overdraft_transaction_links").await, 1);
        assert!(!is_soft_deleted(&pool, "loans", "loan-1").await);
    }

    #[tokio::test]
    async fn an_unlinked_overdraft_loses_only_its_own_account_links_never_the_bank_accounts() {
        let pool = test_pool().await;
        sqlx::query(
            r#"
            INSERT INTO accounts (id, name) VALUES ('od-acct', 'TATA OD'), ('bank-2', 'Netedge 2790'), ('other-od-acct', 'Other OD');
            INSERT INTO loans (id, name, account_id, loan_account_id, loan_kind) VALUES
                ('loan-1', 'TATA OD', 'bank', 'od-acct', 'OVERDRAFT'),
                ('other-od', 'Other OD', 'bank', 'other-od-acct', 'OVERDRAFT');
            INSERT INTO overdraft_accounts (id, loan_id, account_id) VALUES
                ('oa-1', 'loan-1', 'bank'), ('oa-2', 'loan-1', 'bank-2'), ('oa-3', 'other-od', 'bank');
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();

        run_delete(&pool, &delete_request(Some("od-acct")))
            .await
            .expect("delete succeeds");

        let remaining: Vec<String> = sqlx::query("SELECT id FROM overdraft_accounts ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap()
            .iter()
            .map(|row| row.get::<String, _>("id"))
            .collect();
        assert_eq!(remaining, vec!["oa-3"]);
        assert!(!is_soft_deleted(&pool, "accounts", "bank").await);
        assert!(!is_soft_deleted(&pool, "accounts", "bank-2").await);
        assert!(is_soft_deleted(&pool, "accounts", "od-acct").await);
        assert!(!is_soft_deleted(&pool, "loans", "other-od").await);
    }

    #[tokio::test]
    async fn refuses_a_loan_used_by_a_live_financial_plan_and_keeps_the_plan() {
        let pool = test_pool().await;
        seed_loan_and_its_links(&pool).await;
        sqlx::query(
            r#"
            INSERT INTO financial_plans (id, name) VALUES ('plan-1', 'Debt Payoff 2027');
            INSERT INTO financial_plan_components (id, plan_id, loan_id) VALUES ('c-1', 'plan-1', 'loan-1');
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();

        let message = refusal(run_delete(&pool, &delete_request(Some("loan-acct-1"))).await);

        assert!(message.contains("\"Debt Payoff 2027\""), "{message}");
        assert!(!is_soft_deleted(&pool, "loans", "loan-1").await);
        assert!(!is_soft_deleted(&pool, "financial_plan_components", "c-1").await);
        assert_eq!(count_rows(&pool, "loan_payment_schedule").await, 2);
    }

    #[tokio::test]
    async fn a_component_already_removed_or_on_a_deleted_plan_does_not_block_and_is_left_as_history() {
        let pool = test_pool().await;
        seed_loan_and_its_links(&pool).await;
        sqlx::query(
            r#"
            INSERT INTO financial_plans (id, name) VALUES ('plan-live', 'Live'), ('plan-gone', 'Gone');
            UPDATE financial_plans SET deleted_at = '2026-10-01' WHERE id = 'plan-gone';
            INSERT INTO financial_plan_components (id, plan_id, loan_id, deleted_at) VALUES
                ('c-removed', 'plan-live', 'loan-1', '2026-10-02'),
                ('c-on-deleted-plan', 'plan-gone', 'loan-1', NULL);
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
        let before = snapshot(&pool, &["financial_plans", "financial_plan_components"]).await;

        run_delete(&pool, &delete_request(Some("loan-acct-1")))
            .await
            .expect("delete succeeds");

        assert!(is_soft_deleted(&pool, "loans", "loan-1").await);
        assert_eq!(snapshot(&pool, &["financial_plans", "financial_plan_components"]).await, before);
    }

    /// A Dropline Overdraft (migration 053's table, as that migration
    /// creates it) with two drawing-power steps, beside an unrelated
    /// overdraft whose own step must survive.
    async fn seed_dropline_overdraft(pool: &Pool<Sqlite>) {
        sqlx::query(
            r#"
            CREATE TABLE loan_drawing_power_schedule (
                id TEXT PRIMARY KEY,
                loan_id TEXT NOT NULL,
                effective_date TEXT NOT NULL,
                drawing_power REAL NOT NULL CHECK (drawing_power >= 0),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (loan_id, effective_date),
                FOREIGN KEY (loan_id) REFERENCES loans(id)
            );
            INSERT INTO accounts (id, name) VALUES ('loan-acct-1', 'Synthetic Dropline OD');
            INSERT INTO loans (id, name, account_id, loan_account_id, loan_kind)
                VALUES ('loan-1', 'Synthetic Dropline OD', 'bank', 'loan-acct-1', 'OVERDRAFT'),
                       ('other-od', 'Other OD', 'bank', NULL, 'OVERDRAFT');
            INSERT INTO loan_drawing_power_schedule (id, loan_id, effective_date, drawing_power) VALUES
                ('dp-1', 'loan-1', '2026-01-01', 1000000),
                ('dp-2', 'loan-1', '2026-07-01', 800000),
                ('dp-other', 'other-od', '2026-01-01', 500000);
            "#,
        )
        .execute(pool)
        .await
        .expect("seed a dropline overdraft");
    }

    async fn steps_of(pool: &Pool<Sqlite>, loan_id: &str) -> i64 {
        sqlx::query("SELECT COUNT(*) AS n FROM loan_drawing_power_schedule WHERE loan_id = ?")
            .bind(loan_id)
            .fetch_one(pool)
            .await
            .unwrap()
            .get::<i64, _>("n")
    }

    #[tokio::test]
    async fn deleting_a_dropline_overdraft_removes_its_drawing_power_steps_and_soft_deletes_the_loan() {
        let pool = test_pool().await;
        seed_dropline_overdraft(&pool).await;

        run_delete(&pool, &delete_request(Some("loan-acct-1")))
            .await
            .expect("delete succeeds");

        assert!(is_soft_deleted(&pool, "loans", "loan-1").await);
        assert_eq!(count_rows(&pool, "loans").await, 2, "the loan row is kept, only soft-deleted");
        assert_eq!(steps_of(&pool, "loan-1").await, 0);
        assert_eq!(steps_of(&pool, "other-od").await, 1, "another overdraft's step is never touched");
        assert!(!is_soft_deleted(&pool, "loans", "other-od").await);
    }

    #[tokio::test]
    async fn a_failure_after_the_steps_are_removed_rolls_the_whole_delete_back() {
        let pool = test_pool().await;
        seed_dropline_overdraft(&pool).await;

        // Fails the soft delete of the loan, which runs AFTER its steps are
        // deleted - so only a real rollback can bring the steps back.
        sqlx::query(
            r#"
            CREATE TRIGGER fail_loan_soft_delete BEFORE UPDATE OF deleted_at ON loans
            BEGIN
                SELECT RAISE(ABORT, 'injected failure');
            END;
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
        let before = snapshot(&pool, &["loans", "loan_drawing_power_schedule", "accounts"]).await;

        let result = run_delete(&pool, &delete_request(Some("loan-acct-1"))).await;

        assert!(result.is_err(), "the injected failure surfaces");
        assert_eq!(steps_of(&pool, "loan-1").await, 2);
        assert!(!is_soft_deleted(&pool, "loans", "loan-1").await);
        assert_eq!(snapshot(&pool, &["loans", "loan_drawing_power_schedule", "accounts"]).await, before);
    }

    #[tokio::test]
    async fn refuses_an_already_deleted_or_unknown_loan() {
        let pool = test_pool().await;
        seed_loan_and_its_links(&pool).await;

        run_delete(&pool, &delete_request(None)).await.expect("first delete succeeds");
        let message = refusal(run_delete(&pool, &delete_request(None)).await);
        assert!(message.contains("not found"), "{message}");

        let message = refusal(
            run_delete(
                &pool,
                &DeleteLoanAtomicRequest { loan_id: "missing".to_string(), loan_account_id: None },
            )
            .await,
        );
        assert!(message.contains("not found"), "{message}");
    }

    #[tokio::test]
    async fn refuses_to_remove_an_account_that_is_not_the_loans_own() {
        let pool = test_pool().await;
        seed_loan_and_its_links(&pool).await;

        let message = refusal(run_delete(&pool, &delete_request(Some("bank"))).await);

        assert!(message.contains("not this loan's own"), "{message}");
        assert!(!is_soft_deleted(&pool, "accounts", "bank").await);
        assert!(!is_soft_deleted(&pool, "loans", "loan-1").await);
    }

    #[tokio::test]
    async fn leaves_the_mirror_account_untouched_when_the_caller_did_not_ask_for_it() {
        let pool = test_pool().await;
        seed_loan_and_its_links(&pool).await;

        run_delete(&pool, &delete_request(None)).await.expect("delete succeeds");

        assert!(is_soft_deleted(&pool, "loans", "loan-1").await);
        assert!(!is_soft_deleted(&pool, "accounts", "loan-acct-1").await);
    }

    #[tokio::test]
    async fn keeps_the_mirror_account_when_a_live_transaction_is_booked_on_it_even_if_asked() {
        let pool = test_pool().await;
        seed_loan_and_its_links(&pool).await;
        sqlx::query("INSERT INTO transactions (id, account_id, amount) VALUES ('on-mirror', 'loan-acct-1', 100)")
            .execute(&pool)
            .await
            .unwrap();

        run_delete(&pool, &delete_request(Some("loan-acct-1")))
            .await
            .expect("delete succeeds");

        assert!(is_soft_deleted(&pool, "loans", "loan-1").await);
        assert!(!is_soft_deleted(&pool, "accounts", "loan-acct-1").await);
    }

    #[tokio::test]
    async fn rolls_back_every_statement_when_a_later_one_fails_no_partial_delete() {
        let pool = test_pool().await;
        seed_loan_and_its_links(&pool).await;

        // Force a real failure after the schedule and setup deletes have
        // already run in this same attempt, by dropping the table the next
        // statement (the goal-link soft-delete) needs.
        sqlx::query("DROP TABLE goal_loan_links").execute(&pool).await.unwrap();

        let result = run_delete(&pool, &delete_request(Some("loan-acct-1"))).await;

        assert!(matches!(result, Err(DeleteLoanError::Database(_))));
        assert_eq!(count_rows(&pool, "loan_payment_schedule").await, 2);
        assert_eq!(count_rows(&pool, "loan_disbursements").await, 1);
        assert_eq!(count_rows(&pool, "loan_initial_expenses").await, 2);
        assert!(!is_soft_deleted(&pool, "loans", "loan-1").await);
        assert!(!is_soft_deleted(&pool, "accounts", "loan-acct-1").await);
    }

    #[tokio::test]
    async fn a_foreign_key_failure_on_a_dependent_record_rolls_everything_back() {
        // A record of ANOTHER loan pointing at this loan's disbursement
        // (never created by FinWea - loan_setup.rs refuses it) must make the
        // delete fail as a whole, never be silently removed.
        let pool = test_pool().await;
        seed_loan_and_its_links(&pool).await;
        seed_unrelated_loan(&pool).await;
        sqlx::query("INSERT INTO loan_initial_expenses (id, loan_id, disbursement_id) VALUES ('e-foreign', 'other-loan', 'd1')")
            .execute(&pool)
            .await
            .unwrap();

        let result = run_delete(&pool, &delete_request(Some("loan-acct-1"))).await;

        assert!(matches!(result, Err(DeleteLoanError::Database(_))));
        assert_eq!(count_rows(&pool, "loan_initial_expenses").await, 3);
        assert_eq!(count_rows(&pool, "loan_disbursements").await, 2);
        assert_eq!(count_rows(&pool, "loan_payment_schedule").await, 3);
        assert!(!is_soft_deleted(&pool, "loans", "loan-1").await);
    }

    #[tokio::test]
    async fn leaves_no_dangling_transaction_or_lock_after_a_failed_delete() {
        let pool = test_pool().await;
        seed_loan_and_its_links(&pool).await;
        seed_unrelated_loan(&pool).await;

        sqlx::query("DROP TABLE goal_loan_links").execute(&pool).await.unwrap();

        let failed = run_delete(&pool, &delete_request(Some("loan-acct-1"))).await;
        assert!(failed.is_err());

        sqlx::query("UPDATE accounts SET name = ? WHERE id = 'other-acct'")
            .bind("Renamed")
            .execute(&pool)
            .await
            .expect("a fresh write on the same pool succeeds cleanly");
    }

    #[tokio::test]
    async fn a_fresh_accounts_query_excludes_the_deleted_mirror_account_afterwards() {
        let pool = test_pool().await;
        seed_loan_and_its_links(&pool).await;
        seed_unrelated_loan(&pool).await;

        run_delete(&pool, &delete_request(Some("loan-acct-1")))
            .await
            .expect("delete succeeds");

        let visible: Vec<String> = sqlx::query("SELECT id FROM accounts WHERE deleted_at IS NULL")
            .fetch_all(&pool)
            .await
            .unwrap()
            .iter()
            .map(|row| row.get::<String, _>("id"))
            .collect();

        assert!(!visible.contains(&"loan-acct-1".to_string()));
        assert!(visible.contains(&"other-acct".to_string()));
    }

    #[test]
    fn a_refusal_carries_the_prefix_the_frontend_strips() {
        assert_eq!(
            DeleteLoanError::Refused("No.".to_string()).into_message(),
            "LOAN_DELETE_REFUSED: No."
        );
    }
}
