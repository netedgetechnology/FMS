// ---------------------------------------------------------------------
// Loan creation - atomic, single-connection transaction.
//
// Why this lives in Rust rather than going through the existing
// `SQLiteProvider.beginTransaction()/execute()/commit()/rollback()`
// (TypeScript) path: exactly the same reason as
// `import_reconciliation_reset.rs` - `@tauri-apps/plugin-sql`'s
// `execute()`/`select()` commands each independently check out a
// connection from its own sqlx connection pool per call, so a `BEGIN
// TRANSACTION` issued from TypeScript and the statements that follow
// it are NOT guaranteed to run on the same physical SQLite connection.
//
// This was a real production bug, not a theoretical one: creating a
// loan with the Linked Account left blank inserted `account_id = ''`
// into `loans`, which fails `loans`' own FOREIGN KEY constraint against
// `accounts(id)`. Because the `BEGIN`, the account insert, the failing
// loan insert and the subsequent (JS-issued) `ROLLBACK` were not
// guaranteed to share one connection, the connection that actually held
// the open transaction was never explicitly rolled back on itself -
// surfacing as "database is locked" and "cannot rollback - no
// transaction is active" on later attempts, and leaving the create()
// promise (and the "Saving..." UI) hanging on a pool with no usable
// connection left.
//
// Acquiring one `sqlx::Transaction` here (via `pool.begin()`) and
// running every statement of loan creation through it - the loan's own
// mirror account, the loan row, the account link, every EMI schedule
// installment, and the final accounting-balance reconciliation -
// guarantees, rather than hopes, that they all share one connection,
// with a real COMMIT on success and a real ROLLBACK (of everything,
// including whichever earlier statement in this same attempt already
// "succeeded") on any failure. Schedule computation itself (the EMI
// math) stays in TypeScript (`EMIScheduleGenerator`) - this command
// only persists already-computed rows atomically.
//
// This borrows `tauri-plugin-sql`'s own already-open connection pool
// (via its public `DbInstances` app state) rather than opening a second,
// separate connection to the same database file - both `DbPool` and
// `DbInstances` are `pub` in that crate specifically to allow this.
// ---------------------------------------------------------------------

use serde::Deserialize;
use sqlx::{Pool, Sqlite};
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

/// The exact connection string FinWea's frontend uses - see
/// `SQLiteProvider.connect()` (`Database.load("sqlite:financeos.db")`).
/// This is the key `tauri-plugin-sql` stores the pool under internally.
const DB_KEY: &str = "sqlite:financeos.db";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoanMirrorAccount {
    pub id: String,
    pub institution_id: Option<String>,
    pub business_entity_id: Option<String>,
    pub currency_id: String,
    pub name: String,
    pub account_type: String,
    pub description: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewLoan {
    pub id: String,
    pub account_id: Option<String>,
    pub lender_institution_id: Option<String>,
    pub loan_type: String,
    pub name: String,
    pub principal_amount: f64,
    pub interest_rate: f64,
    pub interest_type: String,
    pub tenure_months: Option<i64>,
    pub emi_amount: Option<f64>,
    pub start_date: String,
    pub maturity_date: Option<String>,
    pub outstanding_principal: f64,
    pub outstanding_interest: f64,
    pub paid_installments: i64,
    pub currency_id: String,
    pub status: String,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoanScheduleInstallment {
    pub id: String,
    pub installment_number: i64,
    pub due_date: String,
    pub principal_amount: f64,
    pub interest_amount: f64,
    pub total_amount: f64,
    pub outstanding_principal: f64,
    pub status: String,
    pub paid_date: Option<String>,
    pub paid_amount: Option<f64>,
    pub transaction_id: Option<String>,
}

/// The schedule-reconciled accounting balances - see
/// `EMIScheduleService.generateSchedule`'s own doc comment for why the
/// freshly built schedule, not the request's raw input, is the source
/// of truth for these two columns and the derived status.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoanAccountingBalances {
    pub outstanding_principal: f64,
    pub outstanding_interest: f64,
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLoanAtomicRequest {
    pub loan_account: LoanMirrorAccount,
    pub loan: NewLoan,
    pub schedule: Vec<LoanScheduleInstallment>,
    pub balances: LoanAccountingBalances,
}

async fn sqlite_pool(app: &AppHandle) -> Result<Pool<Sqlite>, String> {
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;

    match lock.get(DB_KEY) {
        Some(DbPool::Sqlite(pool)) => Ok(pool.clone()),
        _ => Err("FinWea's database is not connected yet.".to_string()),
    }
}

async fn run_create(
    pool: &Pool<Sqlite>,
    request: &CreateLoanAtomicRequest,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;

    let outcome: Result<(), sqlx::Error> = async {
        let account = &request.loan_account;

        sqlx::query(
            r#"
            INSERT INTO accounts
            (
                id,
                institution_id,
                business_entity_id,
                currency_id,
                name,
                account_type,
                opening_balance,
                description,
                is_active,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
            "#,
        )
        .bind(&account.id)
        .bind(&account.institution_id)
        .bind(&account.business_entity_id)
        .bind(&account.currency_id)
        .bind(&account.name)
        .bind(&account.account_type)
        .bind(&account.description)
        .bind(if account.is_active { 1 } else { 0 })
        .bind(&account.created_at)
        .bind(&account.updated_at)
        .execute(&mut *tx)
        .await?;

        let loan = &request.loan;

        sqlx::query(
            r#"
            INSERT INTO loans
            (
                id,
                account_id,
                lender_institution_id,
                loan_type,
                name,
                principal_amount,
                interest_rate,
                interest_type,
                tenure_months,
                emi_amount,
                start_date,
                maturity_date,
                outstanding_principal,
                outstanding_interest,
                paid_installments,
                currency_id,
                status,
                notes,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&loan.id)
        .bind(&loan.account_id)
        .bind(&loan.lender_institution_id)
        .bind(&loan.loan_type)
        .bind(&loan.name)
        .bind(loan.principal_amount)
        .bind(loan.interest_rate)
        .bind(&loan.interest_type)
        .bind(loan.tenure_months)
        .bind(loan.emi_amount)
        .bind(&loan.start_date)
        .bind(&loan.maturity_date)
        .bind(loan.outstanding_principal)
        .bind(loan.outstanding_interest)
        .bind(loan.paid_installments)
        .bind(&loan.currency_id)
        .bind(&loan.status)
        .bind(&loan.notes)
        .bind(&loan.created_at)
        .bind(&loan.updated_at)
        .execute(&mut *tx)
        .await?;

        // Links the loan to its own just-created mirror account - see
        // LoanRepository.linkLoanAccount, kept as its own statement
        // (not part of the loans INSERT above) to mirror the existing
        // create() shape exactly.
        sqlx::query(
            r#"
            UPDATE loans
            SET loan_account_id = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            "#,
        )
        .bind(&account.id)
        .bind(&loan.id)
        .execute(&mut *tx)
        .await?;

        for installment in &request.schedule {
            sqlx::query(
                r#"
                INSERT INTO loan_payment_schedule
                (
                    id,
                    loan_id,
                    installment_number,
                    due_date,
                    principal_amount,
                    interest_amount,
                    total_amount,
                    outstanding_principal,
                    status,
                    paid_date,
                    paid_amount,
                    transaction_id,
                    notes,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                "#,
            )
            .bind(&installment.id)
            .bind(&loan.id)
            .bind(installment.installment_number)
            .bind(&installment.due_date)
            .bind(installment.principal_amount)
            .bind(installment.interest_amount)
            .bind(installment.total_amount)
            .bind(installment.outstanding_principal)
            .bind(&installment.status)
            .bind(&installment.paid_date)
            .bind(installment.paid_amount)
            .bind(&installment.transaction_id)
            .execute(&mut *tx)
            .await?;
        }

        sqlx::query(
            r#"
            UPDATE loans
            SET
                outstanding_principal = ?,
                outstanding_interest = ?,
                status = COALESCE(?, status),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            "#,
        )
        .bind(request.balances.outstanding_principal)
        .bind(request.balances.outstanding_interest)
        .bind(&request.balances.status)
        .bind(&loan.id)
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
            // import_reconciliation_reset.rs's run_reset).
            let _ = tx.rollback().await;

            Err(error)
        }
    }
}

/// Creates a loan, its own mirror account, the account link and its
/// full EMI schedule, then reconciles the loan's accounting balances
/// against that schedule - all inside one real database transaction.
/// Any failure (including a foreign-key violation from an unresolved
/// Linked Account) rolls back every statement from this attempt and
/// leaves no dangling open transaction on any connection.
#[tauri::command]
pub async fn create_loan_atomic(
    app: AppHandle,
    request: CreateLoanAtomicRequest,
) -> Result<(), String> {
    let pool = sqlite_pool(&app).await?;

    run_create(&pool, &request)
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
                institution_id TEXT,
                business_entity_id TEXT,
                currency_id TEXT NOT NULL,
                name TEXT NOT NULL,
                account_type TEXT NOT NULL,
                opening_balance REAL NOT NULL DEFAULT 0,
                description TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE loans (
                id TEXT PRIMARY KEY,
                account_id TEXT,
                loan_account_id TEXT REFERENCES accounts(id),
                lender_institution_id TEXT,
                loan_type TEXT NOT NULL,
                name TEXT NOT NULL,
                principal_amount REAL NOT NULL,
                interest_rate REAL NOT NULL DEFAULT 0,
                interest_type TEXT NOT NULL DEFAULT 'REDUCING',
                tenure_months INTEGER,
                emi_amount REAL,
                start_date TEXT NOT NULL,
                maturity_date TEXT,
                outstanding_principal REAL NOT NULL DEFAULT 0,
                outstanding_interest REAL NOT NULL DEFAULT 0,
                paid_installments INTEGER NOT NULL DEFAULT 0,
                currency_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'ACTIVE',
                notes TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT,
                FOREIGN KEY (account_id) REFERENCES accounts(id)
            );

            CREATE TABLE loan_payment_schedule (
                id TEXT PRIMARY KEY,
                loan_id TEXT NOT NULL,
                installment_number INTEGER NOT NULL,
                due_date TEXT NOT NULL,
                principal_amount REAL NOT NULL DEFAULT 0,
                interest_amount REAL NOT NULL DEFAULT 0,
                total_amount REAL NOT NULL,
                outstanding_principal REAL NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'UPCOMING',
                paid_date TEXT,
                paid_amount REAL,
                transaction_id TEXT,
                notes TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (loan_id) REFERENCES loans(id)
            );
            "#,
        )
        .execute(&pool)
        .await
        .expect("create focused test schema");

        pool
    }

    fn valid_request() -> CreateLoanAtomicRequest {
        CreateLoanAtomicRequest {
            loan_account: LoanMirrorAccount {
                id: "loan-acct-1".to_string(),
                institution_id: None,
                business_entity_id: None,
                currency_id: "cur-inr".to_string(),
                name: "Production Test Loan".to_string(),
                account_type: "LOAN".to_string(),
                description: Some("Loan liability account".to_string()),
                is_active: true,
                created_at: "2026-09-20T00:00:00.000Z".to_string(),
                updated_at: "2026-09-20T00:00:00.000Z".to_string(),
            },
            loan: NewLoan {
                id: "loan-1".to_string(),
                // The exact reported bug: a blank Linked Account must
                // already be normalized to None by the time it reaches
                // here (LoanService.normalizeAccountId) - never "".
                account_id: None,
                lender_institution_id: None,
                loan_type: "Home Loan".to_string(),
                name: "Production Test Loan".to_string(),
                principal_amount: 10000.0,
                interest_rate: 12.0,
                interest_type: "REDUCING".to_string(),
                tenure_months: Some(12),
                emi_amount: Some(888.49),
                start_date: "2026-09-20".to_string(),
                maturity_date: Some("2027-09-20".to_string()),
                outstanding_principal: 10000.0,
                outstanding_interest: 661.86,
                paid_installments: 0,
                currency_id: "cur-inr".to_string(),
                status: "ACTIVE".to_string(),
                notes: Some("Production loan test".to_string()),
                created_at: "2026-09-20T00:00:00.000Z".to_string(),
                updated_at: "2026-09-20T00:00:00.000Z".to_string(),
            },
            schedule: vec![LoanScheduleInstallment {
                id: "sched-1".to_string(),
                installment_number: 1,
                due_date: "2026-10-20".to_string(),
                principal_amount: 788.49,
                interest_amount: 100.0,
                total_amount: 888.49,
                outstanding_principal: 9211.51,
                status: "UPCOMING".to_string(),
                paid_date: None,
                paid_amount: None,
                transaction_id: None,
            }],
            balances: LoanAccountingBalances {
                outstanding_principal: 9211.51,
                outstanding_interest: 561.86,
                status: "ACTIVE".to_string(),
            },
        }
    }

    async fn count(pool: &Pool<Sqlite>, table: &str) -> i64 {
        let row = sqlx::query(&format!("SELECT COUNT(*) AS n FROM {table}"))
            .fetch_one(pool)
            .await
            .unwrap();

        row.get::<i64, _>("n")
    }

    #[tokio::test]
    async fn creates_the_account_the_loan_its_link_and_the_full_schedule_then_commits(
    ) {
        let pool = test_pool().await;

        run_create(&pool, &valid_request())
            .await
            .expect("create succeeds");

        assert_eq!(count(&pool, "accounts").await, 1);
        assert_eq!(count(&pool, "loans").await, 1);
        assert_eq!(count(&pool, "loan_payment_schedule").await, 1);

        let loan = sqlx::query(
            "SELECT account_id, loan_account_id, outstanding_principal, outstanding_interest, status FROM loans WHERE id = 'loan-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        // The normalized blank Linked Account - the exact reported bug.
        assert!(loan.get::<Option<String>, _>("account_id").is_none());
        assert_eq!(
            loan.get::<String, _>("loan_account_id"),
            "loan-acct-1"
        );

        // The schedule-reconciled balances, not the request's raw input.
        assert_eq!(
            loan.get::<f64, _>("outstanding_principal"),
            9211.51
        );
        assert_eq!(
            loan.get::<f64, _>("outstanding_interest"),
            561.86
        );
    }

    #[tokio::test]
    async fn a_blank_linked_account_sent_as_empty_string_instead_of_null_fails_the_foreign_key_and_rolls_back_everything(
    ) {
        let pool = test_pool().await;

        let mut request = valid_request();
        // Simulate the exact original bug reaching this far anyway -
        // "" instead of None/null.
        request.loan.account_id = Some(String::new());

        let result = run_create(&pool, &request).await;

        assert!(result.is_err());

        // Nothing from this attempt was left behind - not even the
        // account insert that ran successfully earlier in the same
        // transaction.
        assert_eq!(count(&pool, "accounts").await, 0);
        assert_eq!(count(&pool, "loans").await, 0);
        assert_eq!(count(&pool, "loan_payment_schedule").await, 0);
    }

    #[tokio::test]
    async fn rolls_back_every_earlier_statement_when_the_last_one_fails() {
        let pool = test_pool().await;

        let request = valid_request();

        // Force a real failure after the account and loan inserts have
        // already succeeded in this same attempt, by dropping the table
        // the schedule INSERT needs next.
        sqlx::query("DROP TABLE loan_payment_schedule")
            .execute(&pool)
            .await
            .unwrap();

        let result = run_create(&pool, &request).await;

        assert!(result.is_err());
        assert_eq!(count(&pool, "accounts").await, 0);
        assert_eq!(count(&pool, "loans").await, 0);
    }

    #[tokio::test]
    async fn leaves_no_dangling_transaction_or_lock_after_a_failed_create(
    ) {
        let pool = test_pool().await;

        let mut failing_request = valid_request();
        failing_request.loan.account_id = Some(String::new());

        let failed = run_create(&pool, &failing_request).await;
        assert!(failed.is_err());

        // The single connection in this pool must be fully released -
        // a second, independent create on the same pool must succeed
        // immediately, with no "database is locked" / "cannot rollback
        // - no transaction is active" left over from the failed attempt.
        let mut second_request = valid_request();
        second_request.loan.id = "loan-2".to_string();
        second_request.loan_account.id = "loan-acct-2".to_string();
        second_request.schedule[0].id = "sched-2".to_string();

        run_create(&pool, &second_request)
            .await
            .expect("a fresh create on the same pool succeeds cleanly");

        assert_eq!(count(&pool, "loans").await, 1);
    }
}
