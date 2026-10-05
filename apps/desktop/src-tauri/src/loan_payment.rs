// ---------------------------------------------------------------------
// EMI payment recording and reversal - atomic, single-connection
// transactions.
//
// Same defect class, same fix as loan_create.rs / loan_delete.rs:
// `@tauri-apps/plugin-sql`'s `execute()`/`select()` each check out a
// connection from the sqlx pool independently, and the pool hands idle
// connections out first-in-first-out, so consecutive calls rotate
// across connections. The TypeScript `beginTransaction()` / `execute()`
// / `commit()` sequence LoanPaymentService used therefore ran `BEGIN`,
// each write and `COMMIT` on different connections: every write
// auto-committed on its own, and the final `COMMIT` failed with
// "cannot commit - no transaction is active". A real production bug -
// recording an EMI payment saved the transaction, the payment ledger
// row, the schedule update and the loan balances, yet the UI reported
// "Failed to process EMI payment." (inviting a duplicate retry), and
// left a stray open `BEGIN` on some pooled connection. See
// `the_old_js_managed_transaction_reproduces_the_production_failure`
// below.
//
// The payment arithmetic (ledger-based remaining amount, interest-first
// allocation, PARTIAL/PAID status, loan balances) stays in TypeScript
// (LoanPaymentService); these commands persist the already-computed
// rows inside one `sqlx::Transaction` - a real COMMIT on success, a real
// ROLLBACK of everything on any failure. Recording also re-checks,
// inside that same transaction, that the instalment can still take this
// amount, so a repeated or concurrent submission can never overpay it.
// ---------------------------------------------------------------------

use serde::Deserialize;
use sqlx::{Pool, Row, Sqlite};
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

/// The exact connection string FinWea's frontend uses - see
/// `SQLiteProvider.connect()` (`Database.load("sqlite:financeos.db")`).
const DB_KEY: &str = "sqlite:financeos.db";

/// Prefix of a business-rule refusal (as opposed to a technical database
/// error). The frontend shows the text after it to the user verbatim.
pub const GUARD_PREFIX: &str = "EMI_PAYMENT_REFUSED: ";

/// Tolerance for comparing money amounts held as REAL.
const MONEY_EPSILON: f64 = 0.005;

/// The bank-side transaction row, exactly as `TransactionService` builds
/// it (all columns of `TransactionRepository.create`).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmiTransactionRow {
    pub id: String,
    pub account_id: String,
    pub category_id: Option<String>,
    pub subcategory_id: Option<String>,
    pub payee: String,
    pub counterparty: Option<String>,
    pub branch: Option<String>,
    #[serde(rename = "type")]
    pub kind: String,
    pub transfer_direction: Option<String>,
    pub amount: f64,
    pub transaction_date: String,
    pub reference_number: Option<String>,
    pub notes: Option<String>,
    pub tags: Option<String>,
    pub status: String,
    pub payment_method: Option<String>,
    pub upi_reference: Option<String>,
    pub bank_transaction_reference: Option<String>,
    pub card_reference: Option<String>,
    pub transaction_type: Option<String>,
    pub reconciled: bool,
    pub reconciled_at: Option<String>,
    pub is_imported: bool,
    pub source_statement: Option<String>,
    pub external_transaction_id: Option<String>,
    pub original_narration: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// One `loan_schedule_payments` ledger row.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmiPaymentRow {
    pub id: String,
    pub loan_id: String,
    pub schedule_id: String,
    pub transaction_id: String,
    pub payment_date: String,
    pub amount: f64,
    pub principal_amount: f64,
    pub interest_amount: f64,
}

/// The instalment's payment state after this change.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmiScheduleState {
    pub id: String,
    pub status: String,
    pub paid_date: Option<String>,
    pub paid_amount: Option<f64>,
    pub transaction_id: Option<String>,
}

/// The loan's outstanding balances after this change.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmiLoanBalances {
    pub id: String,
    pub outstanding_principal: f64,
    pub outstanding_interest: f64,
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordEmiPaymentRequest {
    pub transaction: EmiTransactionRow,
    pub payment: EmiPaymentRow,
    pub schedule: EmiScheduleState,
    pub loan: EmiLoanBalances,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReverseEmiPaymentRequest {
    pub payment_id: String,
    /// The payment's bank transaction to soft-delete, when it still
    /// exists (None when it was already removed independently).
    pub transaction_id: Option<String>,
    pub schedule: EmiScheduleState,
    pub loan: EmiLoanBalances,
}

#[derive(Debug)]
pub enum EmiWriteError {
    /// A business rule refused the write - nothing was changed.
    Refused(String),
    Database(sqlx::Error),
}

impl From<sqlx::Error> for EmiWriteError {
    fn from(error: sqlx::Error) -> Self {
        EmiWriteError::Database(error)
    }
}

impl EmiWriteError {
    fn into_message(self) -> String {
        match self {
            EmiWriteError::Refused(reason) => format!("{GUARD_PREFIX}{reason}"),
            EmiWriteError::Database(error) => error.to_string(),
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

async fn update_schedule(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    schedule: &EmiScheduleState,
) -> Result<(), EmiWriteError> {
    let updated = sqlx::query(
        r#"
        UPDATE loan_payment_schedule
        SET
            status = ?,
            paid_date = ?,
            paid_amount = ?,
            transaction_id = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        "#,
    )
    .bind(&schedule.status)
    .bind(&schedule.paid_date)
    .bind(schedule.paid_amount)
    .bind(&schedule.transaction_id)
    .bind(&schedule.id)
    .execute(&mut **tx)
    .await?;

    if updated.rows_affected() != 1 {
        return Err(EmiWriteError::Refused("EMI installment not found.".to_string()));
    }

    Ok(())
}

async fn update_loan_balances(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    loan: &EmiLoanBalances,
) -> Result<(), EmiWriteError> {
    let updated = sqlx::query(
        r#"
        UPDATE loans
        SET
            outstanding_principal = ?,
            outstanding_interest = ?,
            status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND deleted_at IS NULL
        "#,
    )
    .bind(loan.outstanding_principal)
    .bind(loan.outstanding_interest)
    .bind(&loan.status)
    .bind(&loan.id)
    .execute(&mut **tx)
    .await?;

    if updated.rows_affected() != 1 {
        return Err(EmiWriteError::Refused("Loan not found.".to_string()));
    }

    Ok(())
}

async fn record_steps(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    request: &RecordEmiPaymentRequest,
) -> Result<(), EmiWriteError> {
    let payment = &request.payment;

    // Re-checked inside the transaction (the frontend already validated
    // against what it read): a repeated or concurrent submission can
    // never overpay the instalment or pay a closed/deleted loan.
    let loan_status: Option<String> = sqlx::query(
        "SELECT status FROM loans WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&payment.loan_id)
    .fetch_optional(&mut **tx)
    .await?
    .map(|row| row.get("status"));

    match loan_status.as_deref() {
        None => return Err(EmiWriteError::Refused("Loan not found.".to_string())),
        Some("CLOSED") => {
            return Err(EmiWriteError::Refused(
                "This loan is closed. No further payments can be recorded.".to_string(),
            ))
        }
        Some(_) => {}
    }

    let schedule = sqlx::query(
        "SELECT loan_id, status, total_amount FROM loan_payment_schedule WHERE id = ?",
    )
    .bind(&payment.schedule_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| EmiWriteError::Refused("EMI installment not found.".to_string()))?;

    let schedule_loan_id: String = schedule.get("loan_id");
    let schedule_status: String = schedule.get("status");
    let total_amount: f64 = schedule.get("total_amount");

    if schedule_loan_id != payment.loan_id {
        return Err(EmiWriteError::Refused(
            "The EMI installment does not belong to this loan.".to_string(),
        ));
    }

    if schedule_status == "PAID" {
        return Err(EmiWriteError::Refused(
            "This EMI installment has already been paid.".to_string(),
        ));
    }

    let paid_before: f64 = sqlx::query(
        "SELECT COALESCE(SUM(amount), 0.0) AS paid FROM loan_schedule_payments WHERE schedule_id = ?",
    )
    .bind(&payment.schedule_id)
    .fetch_one(&mut **tx)
    .await?
    .get("paid");

    let remaining = total_amount - paid_before;

    if payment.amount <= 0.0 {
        return Err(EmiWriteError::Refused(
            "Payment amount must be greater than zero.".to_string(),
        ));
    }

    if payment.amount > remaining + MONEY_EPSILON {
        return Err(EmiWriteError::Refused(format!(
            "This payment was not recorded: only {:.2} remains on this installment (it may already have been paid).",
            remaining.max(0.0)
        )));
    }

    let t = &request.transaction;

    sqlx::query(
        r#"
        INSERT INTO transactions
        (
            id, account_id, category_id, subcategory_id, payee, counterparty,
            branch, type, transfer_direction, amount, transaction_date,
            reference_number, notes, tags, status, payment_method,
            upi_reference, bank_transaction_reference, card_reference,
            transaction_type, reconciled, reconciled_at, is_imported,
            source_statement, external_transaction_id, original_narration,
            created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&t.id)
    .bind(&t.account_id)
    .bind(&t.category_id)
    .bind(&t.subcategory_id)
    .bind(&t.payee)
    .bind(&t.counterparty)
    .bind(&t.branch)
    .bind(&t.kind)
    // One source of direction: only a transfer stores one (as in
    // TransactionRepository.create).
    .bind(if t.kind == "transfer" { t.transfer_direction.clone() } else { None })
    .bind(t.amount)
    .bind(&t.transaction_date)
    .bind(&t.reference_number)
    .bind(&t.notes)
    .bind(&t.tags)
    .bind(&t.status)
    .bind(&t.payment_method)
    .bind(&t.upi_reference)
    .bind(&t.bank_transaction_reference)
    .bind(&t.card_reference)
    .bind(&t.transaction_type)
    .bind(if t.reconciled { 1_i64 } else { 0_i64 })
    .bind(&t.reconciled_at)
    .bind(if t.is_imported { 1_i64 } else { 0_i64 })
    .bind(&t.source_statement)
    .bind(&t.external_transaction_id)
    .bind(&t.original_narration)
    .bind(&t.created_at)
    .bind(&t.updated_at)
    .execute(&mut **tx)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO loan_schedule_payments
        (id, loan_id, schedule_id, transaction_id, payment_date, amount, principal_amount, interest_amount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&payment.id)
    .bind(&payment.loan_id)
    .bind(&payment.schedule_id)
    .bind(&payment.transaction_id)
    .bind(&payment.payment_date)
    .bind(payment.amount)
    .bind(payment.principal_amount)
    .bind(payment.interest_amount)
    .execute(&mut **tx)
    .await?;

    update_schedule(tx, &request.schedule).await?;
    update_loan_balances(tx, &request.loan).await?;

    Ok(())
}

async fn run_record(
    pool: &Pool<Sqlite>,
    request: &RecordEmiPaymentRequest,
) -> Result<(), EmiWriteError> {
    let mut tx = pool.begin().await?;

    match record_steps(&mut tx, request).await {
        Ok(()) => {
            tx.commit().await?;
            Ok(())
        }
        Err(error) => {
            let _ = tx.rollback().await;
            Err(error)
        }
    }
}

async fn reverse_steps(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    request: &ReverseEmiPaymentRequest,
) -> Result<(), EmiWriteError> {
    let exists = sqlx::query("SELECT id FROM loan_schedule_payments WHERE id = ?")
        .bind(&request.payment_id)
        .fetch_optional(&mut **tx)
        .await?
        .is_some();

    if !exists {
        return Err(EmiWriteError::Refused(
            "This payment record was not found. It may have already been reversed.".to_string(),
        ));
    }

    if let Some(transaction_id) = &request.transaction_id {
        // Soft delete only - never a hard delete (as TransactionRepository.delete).
        sqlx::query(
            "UPDATE transactions SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL",
        )
        .bind(transaction_id)
        .execute(&mut **tx)
        .await?;
    }

    sqlx::query("DELETE FROM loan_schedule_payments WHERE id = ?")
        .bind(&request.payment_id)
        .execute(&mut **tx)
        .await?;

    update_schedule(tx, &request.schedule).await?;
    update_loan_balances(tx, &request.loan).await?;

    Ok(())
}

async fn run_reverse(
    pool: &Pool<Sqlite>,
    request: &ReverseEmiPaymentRequest,
) -> Result<(), EmiWriteError> {
    let mut tx = pool.begin().await?;

    match reverse_steps(&mut tx, request).await {
        Ok(()) => {
            tx.commit().await?;
            Ok(())
        }
        Err(error) => {
            let _ = tx.rollback().await;
            Err(error)
        }
    }
}

/// Records one EMI payment - its bank transaction, its payment-ledger
/// row, the instalment's new state and the loan's new balances - in one
/// real database transaction. Any refusal or failure changes nothing.
#[tauri::command]
pub async fn record_emi_payment_atomic(
    app: AppHandle,
    request: RecordEmiPaymentRequest,
) -> Result<(), String> {
    let pool = sqlite_pool(&app).await?;

    run_record(&pool, &request)
        .await
        .map_err(EmiWriteError::into_message)
}

/// Reverses one EMI payment - soft-deletes its bank transaction, removes
/// its ledger row, restores the instalment and the loan balances - in one
/// real database transaction. Any refusal or failure changes nothing.
#[tauri::command]
pub async fn reverse_emi_payment_atomic(
    app: AppHandle,
    request: ReverseEmiPaymentRequest,
) -> Result<(), String> {
    let pool = sqlite_pool(&app).await?;

    run_reverse(&pool, &request)
        .await
        .map_err(EmiWriteError::into_message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::str::FromStr;

    const SCHEMA: &str = r#"
        CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE loans (
            id TEXT PRIMARY KEY, name TEXT NOT NULL,
            outstanding_principal REAL NOT NULL, outstanding_interest REAL NOT NULL,
            status TEXT NOT NULL, deleted_at TEXT, updated_at TEXT
        );
        CREATE TABLE loan_payment_schedule (
            id TEXT PRIMARY KEY, loan_id TEXT NOT NULL REFERENCES loans(id),
            installment_number INTEGER NOT NULL, due_date TEXT NOT NULL,
            total_amount REAL NOT NULL, status TEXT NOT NULL,
            paid_date TEXT, paid_amount REAL, transaction_id TEXT, updated_at TEXT
        );
        CREATE TABLE transactions (
            id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
            category_id TEXT, subcategory_id TEXT, payee TEXT, counterparty TEXT,
            branch TEXT, type TEXT NOT NULL, transfer_direction TEXT,
            amount REAL NOT NULL, transaction_date TEXT NOT NULL,
            reference_number TEXT, notes TEXT, tags TEXT, status TEXT,
            payment_method TEXT, upi_reference TEXT, bank_transaction_reference TEXT,
            card_reference TEXT, transaction_type TEXT, reconciled INTEGER,
            reconciled_at TEXT, is_imported INTEGER, source_statement TEXT,
            external_transaction_id TEXT, original_narration TEXT,
            created_at TEXT, updated_at TEXT, deleted_at TEXT
        );
        CREATE TABLE loan_schedule_payments (
            id TEXT PRIMARY KEY, loan_id TEXT NOT NULL REFERENCES loans(id),
            schedule_id TEXT NOT NULL REFERENCES loan_payment_schedule(id),
            transaction_id TEXT NOT NULL, payment_date TEXT NOT NULL,
            amount REAL NOT NULL, principal_amount REAL NOT NULL,
            interest_amount REAL NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO accounts VALUES ('acct-1', 'Axis Bank');
        INSERT INTO loans VALUES ('loan-1', 'Aditya Birla Capital', 13300000, 13910131.34, 'ACTIVE', NULL, NULL);
        INSERT INTO loan_payment_schedule VALUES
            ('sch-1', 'loan-1', 1, '2026-05-05', 151167.39, 'OVERDUE', NULL, NULL, NULL, NULL),
            ('sch-2', 'loan-1', 2, '2026-06-05', 151167.39, 'UPCOMING', NULL, NULL, NULL, NULL);
    "#;

    async fn test_pool() -> Pool<Sqlite> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open in-memory test database");
        sqlx::query("PRAGMA foreign_keys = ON").execute(&pool).await.unwrap();
        sqlx::raw_sql(SCHEMA).execute(&pool).await.expect("schema");
        pool
    }

    fn transaction_row(id: &str, amount: f64) -> EmiTransactionRow {
        EmiTransactionRow {
            id: id.to_string(),
            account_id: "acct-1".to_string(),
            category_id: None,
            subcategory_id: None,
            payee: "Aditya Birla Capital".to_string(),
            counterparty: None,
            branch: None,
            kind: "expense".to_string(),
            transfer_direction: None,
            amount,
            transaction_date: "2026-04-06".to_string(),
            reference_number: None,
            notes: Some("EMI payment - Installment 1".to_string()),
            tags: None,
            status: "CLEARED".to_string(),
            payment_method: Some("EMANDATE".to_string()),
            upi_reference: None,
            bank_transaction_reference: None,
            card_reference: None,
            transaction_type: None,
            reconciled: false,
            reconciled_at: None,
            is_imported: false,
            source_statement: None,
            external_transaction_id: None,
            original_narration: None,
            created_at: "2026-10-05T14:31:08.000Z".to_string(),
            updated_at: "2026-10-05T14:31:08.000Z".to_string(),
        }
    }

    /// The user's exact payment: Rs 68,943.00 on 2026-04-06 against
    /// instalment 1 (Rs 1,51,167.39, due 2026-05-05) - all interest.
    fn partial_payment(payment_id: &str, txn_id: &str, amount: f64) -> RecordEmiPaymentRequest {
        RecordEmiPaymentRequest {
            transaction: transaction_row(txn_id, amount),
            payment: EmiPaymentRow {
                id: payment_id.to_string(),
                loan_id: "loan-1".to_string(),
                schedule_id: "sch-1".to_string(),
                transaction_id: txn_id.to_string(),
                payment_date: "2026-04-06".to_string(),
                amount,
                principal_amount: 0.0,
                interest_amount: amount,
            },
            schedule: EmiScheduleState {
                id: "sch-1".to_string(),
                status: "PARTIAL".to_string(),
                paid_date: Some("2026-04-06".to_string()),
                paid_amount: Some(amount),
                transaction_id: Some(txn_id.to_string()),
            },
            loan: EmiLoanBalances {
                id: "loan-1".to_string(),
                outstanding_principal: 13300000.0,
                outstanding_interest: 13910131.34 - amount,
                status: "ACTIVE".to_string(),
            },
        }
    }

    async fn count(pool: &Pool<Sqlite>, sql: &str) -> i64 {
        sqlx::query(sql).fetch_one(pool).await.unwrap().get::<i64, _>(0)
    }

    #[tokio::test]
    async fn records_the_partial_payment_atomically() {
        let pool = test_pool().await;

        run_record(&pool, &partial_payment("pay-1", "txn-1", 68943.0)).await.expect("recorded");

        let schedule = sqlx::query("SELECT status, paid_amount, paid_date, transaction_id FROM loan_payment_schedule WHERE id = 'sch-1'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(schedule.get::<String, _>("status"), "PARTIAL");
        assert_eq!(schedule.get::<f64, _>("paid_amount"), 68943.0);
        assert_eq!(schedule.get::<String, _>("paid_date"), "2026-04-06");
        assert_eq!(schedule.get::<String, _>("transaction_id"), "txn-1");

        let txn = sqlx::query("SELECT amount, transaction_date, payment_method, type FROM transactions WHERE id = 'txn-1'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(txn.get::<f64, _>("amount"), 68943.0);
        assert_eq!(txn.get::<String, _>("transaction_date"), "2026-04-06");
        assert_eq!(txn.get::<String, _>("payment_method"), "EMANDATE");
        assert_eq!(txn.get::<String, _>("type"), "expense");

        assert_eq!(count(&pool, "SELECT COUNT(*) FROM loan_schedule_payments").await, 1);
        let interest: f64 = sqlx::query("SELECT outstanding_interest FROM loans WHERE id = 'loan-1'")
            .fetch_one(&pool).await.unwrap().get(0);
        assert!((interest - (13910131.34 - 68943.0)).abs() < 0.001);
    }

    #[tokio::test]
    async fn refuses_an_amount_above_what_remains_and_changes_nothing() {
        let pool = test_pool().await;
        run_record(&pool, &partial_payment("pay-1", "txn-1", 68943.0)).await.unwrap();

        // 82,224.39 remains; 82,224.40 must be refused.
        let error = run_record(&pool, &partial_payment("pay-2", "txn-2", 82224.40)).await.unwrap_err();

        match error {
            EmiWriteError::Refused(reason) => assert!(reason.contains("82224.39"), "{reason}"),
            other => panic!("expected a refusal, got {other:?}"),
        }
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM loan_schedule_payments").await, 1);
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM transactions").await, 1);
    }

    #[tokio::test]
    async fn a_repeated_submission_of_the_same_payment_cannot_duplicate_it() {
        let pool = test_pool().await;
        let request = partial_payment("pay-1", "txn-1", 68943.0);

        run_record(&pool, &request).await.unwrap();
        assert!(run_record(&pool, &request).await.is_err());

        assert_eq!(count(&pool, "SELECT COUNT(*) FROM loan_schedule_payments").await, 1);
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM transactions").await, 1);
        let interest: f64 = sqlx::query("SELECT outstanding_interest FROM loans WHERE id = 'loan-1'")
            .fetch_one(&pool).await.unwrap().get(0);
        assert!((interest - (13910131.34 - 68943.0)).abs() < 0.001);
    }

    #[tokio::test]
    async fn a_failing_later_statement_rolls_back_every_earlier_one_and_leaves_no_lock() {
        let pool = test_pool().await;
        let mut request = partial_payment("pay-1", "txn-1", 68943.0);
        request.loan.id = "no-such-loan".to_string(); // the last statement fails

        assert!(run_record(&pool, &request).await.is_err());

        assert_eq!(count(&pool, "SELECT COUNT(*) FROM transactions").await, 0);
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM loan_schedule_payments").await, 0);
        let status: String = sqlx::query("SELECT status FROM loan_payment_schedule WHERE id = 'sch-1'")
            .fetch_one(&pool).await.unwrap().get(0);
        assert_eq!(status, "OVERDUE");

        // No dangling transaction or lock: a fresh write succeeds at once.
        sqlx::query("UPDATE accounts SET name = 'Renamed' WHERE id = 'acct-1'")
            .execute(&pool).await.expect("fresh write succeeds");
    }

    #[tokio::test]
    async fn refuses_a_closed_loan_and_an_already_paid_installment() {
        let pool = test_pool().await;
        sqlx::query("UPDATE loan_payment_schedule SET status = 'PAID' WHERE id = 'sch-1'").execute(&pool).await.unwrap();
        assert!(matches!(run_record(&pool, &partial_payment("pay-1", "txn-1", 100.0)).await, Err(EmiWriteError::Refused(_))));

        sqlx::query("UPDATE loan_payment_schedule SET status = 'OVERDUE' WHERE id = 'sch-1'").execute(&pool).await.unwrap();
        sqlx::query("UPDATE loans SET status = 'CLOSED' WHERE id = 'loan-1'").execute(&pool).await.unwrap();
        assert!(matches!(run_record(&pool, &partial_payment("pay-1", "txn-1", 100.0)).await, Err(EmiWriteError::Refused(_))));
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM transactions").await, 0);
    }

    #[tokio::test]
    async fn reverses_a_payment_atomically() {
        let pool = test_pool().await;
        run_record(&pool, &partial_payment("pay-1", "txn-1", 68943.0)).await.unwrap();

        run_reverse(
            &pool,
            &ReverseEmiPaymentRequest {
                payment_id: "pay-1".to_string(),
                transaction_id: Some("txn-1".to_string()),
                schedule: EmiScheduleState {
                    id: "sch-1".to_string(),
                    status: "UPCOMING".to_string(),
                    paid_date: None,
                    paid_amount: None,
                    transaction_id: None,
                },
                loan: EmiLoanBalances {
                    id: "loan-1".to_string(),
                    outstanding_principal: 13300000.0,
                    outstanding_interest: 13910131.34,
                    status: "ACTIVE".to_string(),
                },
            },
        )
        .await
        .expect("reversed");

        assert_eq!(count(&pool, "SELECT COUNT(*) FROM loan_schedule_payments").await, 0);
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM transactions WHERE deleted_at IS NOT NULL").await, 1);
        let status: String = sqlx::query("SELECT status FROM loan_payment_schedule WHERE id = 'sch-1'")
            .fetch_one(&pool).await.unwrap().get(0);
        assert_eq!(status, "UPCOMING");

        // Reversing again is refused and changes nothing.
        let again = run_reverse(
            &pool,
            &ReverseEmiPaymentRequest {
                payment_id: "pay-1".to_string(),
                transaction_id: Some("txn-1".to_string()),
                schedule: EmiScheduleState { id: "sch-1".to_string(), status: "UPCOMING".to_string(), paid_date: None, paid_amount: None, transaction_id: None },
                loan: EmiLoanBalances { id: "loan-1".to_string(), outstanding_principal: 1.0, outstanding_interest: 1.0, status: "ACTIVE".to_string() },
            },
        )
        .await;
        assert!(matches!(again, Err(EmiWriteError::Refused(_))));
        let interest: f64 = sqlx::query("SELECT outstanding_interest FROM loans WHERE id = 'loan-1'")
            .fetch_one(&pool).await.unwrap().get(0);
        assert!((interest - 13910131.34).abs() < 0.001);
    }

    /// Reproduces the production failure with the same sqlx pool the app
    /// uses: once the pool has several idle connections (as after the
    /// app's concurrent startup reads), BEGIN / INSERT / COMMIT issued as
    /// separate pool calls - exactly what the TypeScript
    /// beginTransaction()/execute()/commit() did - land on different
    /// connections. The INSERT auto-commits by itself and COMMIT fails.
    #[tokio::test]
    async fn the_old_js_managed_transaction_reproduces_the_production_failure() {
        let path = std::env::temp_dir().join(format!("finwea-emi-pool-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", path.display()))
            .unwrap()
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new().max_connections(3).connect_with(options).await.unwrap();
        sqlx::query("CREATE TABLE t (id INTEGER)").execute(&pool).await.unwrap();

        // Warm the pool: three connections open at once, then idle.
        {
            let a = pool.acquire().await.unwrap();
            let b = pool.acquire().await.unwrap();
            let c = pool.acquire().await.unwrap();
            drop((a, b, c));
        }

        sqlx::query("BEGIN TRANSACTION").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO t VALUES (1)").execute(&pool).await.unwrap();
        let commit = sqlx::query("COMMIT").execute(&pool).await;

        let message = commit.expect_err("COMMIT lands on a connection without the transaction").to_string();
        assert!(message.contains("cannot commit - no transaction is active"), "{message}");

        // ...yet the "failed" write was committed on its own connection.
        let rows: i64 = sqlx::query("SELECT COUNT(*) FROM t").fetch_one(&pool).await.unwrap().get(0);
        assert_eq!(rows, 1);

        pool.close().await;
        let _ = std::fs::remove_file(&path);
    }
}
