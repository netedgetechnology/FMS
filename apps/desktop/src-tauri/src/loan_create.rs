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

use std::collections::{HashMap, HashSet};

use serde::Deserialize;
use sqlx::{Pool, Row, Sqlite};
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::loan_setup::{
    check_transaction, persist_opening_principal, persist_setup, LoanSetupDetails, MoneySide,
    REFUSED,
};

/// Float noise only - never a rounding allowance (amounts are to the paisa).
const MONEY_EPSILON: f64 = 0.005;

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
    /// The lender's own account number - see migration 050. Text, never a
    /// number (leading zeros are kept); None when not entered.
    #[serde(default)]
    pub loan_account_number: Option<String>,
    pub principal_amount: f64,
    pub interest_rate: f64,
    pub interest_type: String,
    pub tenure_months: Option<i64>,
    pub emi_amount: Option<f64>,
    /// Optional broken-period (pre-EMI) first instalment - see migration 045.
    #[serde(default)]
    pub first_installment_amount: Option<f64>,
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

#[derive(Debug, Clone, Deserialize)]
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
    /// A lender-imported schedule's own opening principal (migration 051).
    /// Absent for a generated schedule - the opening is the previous row's
    /// closing, exactly as before.
    #[serde(default)]
    pub opening_principal: Option<f64>,
    /// Declared "Settled before FinWea" (migration 052): PAID with no bank
    /// transaction and no payment record behind it.
    #[serde(default)]
    pub settled_before_finwea: bool,
}

/// A historical instalment of a loan that was already running, linked to
/// its EXISTING bank debit. The amount, date and principal/interest split
/// are never taken from the caller: they come from the instalment and the
/// transaction as stored.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoricalPayment {
    pub id: String,
    pub schedule_id: String,
    pub transaction_id: String,
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

/// An Overdraft's own terms (migration 047). Present only when the loan
/// being created is an Overdraft; a Term Loan request has none and is
/// created exactly as before.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverdraftTerms {
    pub credit_limit: f64,
    pub opening_used: f64,
    pub opening_used_as_of: String,
    /// Every bank account linked to the OD (migration 048) - one
    /// overdraft_accounts row each.
    #[serde(default)]
    pub account_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLoanAtomicRequest {
    pub loan_account: LoanMirrorAccount,
    pub loan: NewLoan,
    #[serde(default)]
    pub overdraft: Option<OverdraftTerms>,
    pub schedule: Vec<LoanScheduleInstallment>,
    pub balances: LoanAccountingBalances,
    /// The Add Loan setup (migration 051): extra lender terms, disbursements
    /// and initial expenses - see loan_setup.rs. Absent from every older
    /// caller, which then behaves exactly as before.
    #[serde(default)]
    pub setup: Option<LoanSetupDetails>,
    /// One per historical instalment linked to its bank debit. Absent from
    /// every older caller (which then may not send any PAID instalment).
    #[serde(default)]
    pub historical_payments: Vec<HistoricalPayment>,
}

fn refused(message: String) -> sqlx::Error {
    sqlx::Error::Protocol(format!("{REFUSED}{message}"))
}

fn day(value: &str) -> &str {
    value.get(..10).unwrap_or(value)
}

/// Today's local date, YYYY-MM-DD - the same "today" the wizard uses.
fn local_today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// The new loan's instalments may only be PAID when each one is backed by
/// something real:
///   - a linked historical payment (`historical_payments`) for exactly the
///     instalment, pointing at the instalment's own transaction; or
///   - the explicit "Settled before FinWea" flag, with no transaction.
/// PAID instalments must be the leading ones, never due after `today`, and
/// `loans.paid_installments` must be their count. Anything else is refused,
/// so no caller (old or new) can mark an instalment paid out of thin air.
fn check_paid_rows(request: &CreateLoanAtomicRequest, today: &str) -> Result<(), String> {
    let mut by_schedule: HashMap<&str, &HistoricalPayment> = HashMap::new();
    let mut transactions: HashSet<&str> = HashSet::new();

    for payment in &request.historical_payments {
        if !transactions.insert(payment.transaction_id.as_str()) {
            return Err("The same bank transaction is linked to more than one instalment.".to_string());
        }

        if by_schedule.insert(payment.schedule_id.as_str(), payment).is_some() {
            return Err("An instalment is linked to more than one bank transaction.".to_string());
        }
    }

    let mut rows: Vec<&LoanScheduleInstallment> = request.schedule.iter().collect();
    rows.sort_by_key(|row| row.installment_number);

    let mut paid: i64 = 0;
    let mut unpaid_seen = false;

    for row in rows {
        let label = format!("Instalment #{}", row.installment_number);
        let payment = by_schedule.remove(row.id.as_str());

        if row.status == "PAID" {
            if unpaid_seen {
                return Err("Paid instalments must be the first instalments of the schedule, in order.".to_string());
            }

            if day(&row.due_date) > today {
                return Err(format!(
                    "{label} is due on {}, after today - a future instalment cannot be marked paid.",
                    day(&row.due_date)
                ));
            }

            match row.paid_amount {
                Some(amount) if (amount - row.total_amount).abs() < MONEY_EPSILON => {}
                _ => {
                    return Err(format!(
                        "{label} is marked paid for an amount other than the instalment."
                    ))
                }
            }

            if row.settled_before_finwea {
                if row.transaction_id.is_some() || payment.is_some() {
                    return Err(format!(
                        "{label} is marked \"Settled before FinWea\", so it cannot also be linked to a bank transaction."
                    ));
                }
            } else {
                match payment {
                    None => {
                        return Err(format!(
                            "{label} is marked paid without a linked bank transaction. Link its bank debit, or mark it \"Settled before FinWea\"."
                        ))
                    }
                    Some(payment) => {
                        if row.transaction_id.as_deref() != Some(payment.transaction_id.as_str()) {
                            return Err(format!("{label} does not point at its linked bank transaction."));
                        }

                        if row.paid_date.is_none() {
                            return Err(format!("{label} is marked paid without a paid date."));
                        }
                    }
                }
            }

            paid += 1;
        } else {
            if row.status != "UPCOMING" && row.status != "OVERDUE" {
                return Err(format!("{label} has a status a new loan cannot start with ({}).", row.status));
            }

            if row.settled_before_finwea
                || row.paid_date.is_some()
                || row.paid_amount.is_some()
                || row.transaction_id.is_some()
                || payment.is_some()
            {
                return Err(format!("{label} is not paid, so it cannot carry a payment."));
            }

            unpaid_seen = true;
        }
    }

    if !by_schedule.is_empty() {
        return Err("A linked bank transaction points at an instalment that is not in this loan's schedule.".to_string());
    }

    if request.loan.paid_installments != paid {
        return Err(format!(
            "The loan says {} instalment(s) are paid, but its schedule has {paid} paid instalment(s).",
            request.loan.paid_installments
        ));
    }

    Ok(())
}

/// Writes one loan_schedule_payments row per linked historical instalment,
/// after re-checking its bank transaction inside this transaction: live,
/// not used by anything else, money out, on the loan's EMI account, for
/// exactly the instalment amount, dated between the loan start and today
/// and on the instalment's paid date.
async fn persist_historical_payments(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    request: &CreateLoanAtomicRequest,
    today: &str,
) -> Result<(), sqlx::Error> {
    if request.historical_payments.is_empty() {
        return Ok(());
    }

    let loan = &request.loan;
    let account_id = loan
        .account_id
        .as_deref()
        .filter(|id| !id.trim().is_empty())
        .ok_or_else(|| {
            refused("Choose the bank account the EMIs are paid from before linking historical EMI debits.".to_string())
        })?;

    for payment in &request.historical_payments {
        let row = request
            .schedule
            .iter()
            .find(|row| row.id == payment.schedule_id)
            .ok_or_else(|| refused("A linked bank transaction points at an unknown instalment.".to_string()))?;
        let what = format!("instalment #{}", row.installment_number);

        check_transaction(
            tx,
            &payment.transaction_id,
            Some(account_id),
            MoneySide::Out,
            row.total_amount,
            &what,
        )
        .await?;

        let transaction_date: String = sqlx::query(
            "SELECT substr(transaction_date, 1, 10) AS d FROM transactions WHERE id = ?",
        )
        .bind(&payment.transaction_id)
        .fetch_one(&mut **tx)
        .await?
        .get("d");

        if transaction_date.as_str() > today {
            return Err(refused(format!(
                "The bank transaction chosen for {what} is dated after today."
            )));
        }

        if transaction_date.as_str() < day(&loan.start_date) {
            return Err(refused(format!(
                "The bank transaction chosen for {what} is dated before the loan started."
            )));
        }

        if row.paid_date.as_deref().map(day) != Some(transaction_date.as_str()) {
            return Err(refused(format!(
                "The paid date of {what} must be its bank transaction's date ({transaction_date})."
            )));
        }

        sqlx::query(
            r#"
            INSERT INTO loan_schedule_payments
            (id, loan_id, schedule_id, transaction_id, payment_date, amount, principal_amount,
             interest_amount, transaction_linked, settles_installment)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
            "#,
        )
        .bind(&payment.id)
        .bind(&loan.id)
        .bind(&row.id)
        .bind(&payment.transaction_id)
        .bind(&transaction_date)
        .bind(row.total_amount)
        .bind(row.principal_amount)
        .bind(row.interest_amount)
        .execute(&mut **tx)
        .await?;
    }

    Ok(())
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
    run_create_on(pool, request, &local_today()).await
}

async fn run_create_on(
    pool: &Pool<Sqlite>,
    request: &CreateLoanAtomicRequest,
    today: &str,
) -> Result<(), sqlx::Error> {
    // Nothing is written when a PAID instalment is not backed by a real
    // payment or an explicit "Settled before FinWea".
    check_paid_rows(request, today).map_err(refused)?;

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
                loan_account_number,
                principal_amount,
                interest_rate,
                interest_type,
                tenure_months,
                emi_amount,
                first_installment_amount,
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
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&loan.id)
        .bind(&loan.account_id)
        .bind(&loan.lender_institution_id)
        .bind(&loan.loan_type)
        .bind(&loan.name)
        .bind(&loan.loan_account_number)
        .bind(loan.principal_amount)
        .bind(loan.interest_rate)
        .bind(&loan.interest_type)
        .bind(loan.tenure_months)
        .bind(loan.emi_amount)
        .bind(loan.first_installment_amount)
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
                    settled_before_finwea,
                    notes,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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
            .bind(if installment.settled_before_finwea { 1_i64 } else { 0_i64 })
            .execute(&mut *tx)
            .await?;

            if let Some(opening_principal) = installment.opening_principal {
                persist_opening_principal(&mut tx, &installment.id, opening_principal).await?;
            }
        }

        persist_historical_payments(&mut tx, request, today).await?;

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

        // An Overdraft: its Loan Type and terms, in this same transaction.
        // Its used amount is never stored - it is derived from the linked
        // transactions (loans/repositories/overdraftPositionSql.ts).
        if let Some(overdraft) = &request.overdraft {
            sqlx::query(
                r#"
                UPDATE loans
                SET
                    loan_kind = 'OVERDRAFT',
                    credit_limit = ?,
                    opening_used = ?,
                    opening_used_as_of = ?
                WHERE id = ?
                  AND deleted_at IS NULL
                "#,
            )
            .bind(overdraft.credit_limit)
            .bind(overdraft.opening_used)
            .bind(&overdraft.opening_used_as_of)
            .bind(&loan.id)
            .execute(&mut *tx)
            .await?;

            for account_id in &overdraft.account_ids {
                sqlx::query(
                    r#"
                    INSERT OR IGNORE INTO overdraft_accounts (id, loan_id, account_id)
                    VALUES (lower(hex(randomblob(16))), ?, ?)
                    "#,
                )
                .bind(&loan.id)
                .bind(account_id)
                .execute(&mut *tx)
                .await?;
            }
        }

        if let Some(setup) = &request.setup {
            persist_setup(&mut tx, &loan.id, setup).await?;
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
                loan_account_number TEXT,
                principal_amount REAL NOT NULL,
                interest_rate REAL NOT NULL DEFAULT 0,
                interest_type TEXT NOT NULL DEFAULT 'REDUCING',
                tenure_months INTEGER,
                emi_amount REAL,
                first_installment_amount REAL,
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
                settled_before_finwea INTEGER NOT NULL DEFAULT 0,
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
                loan_account_number: Some("0099000123".to_string()),
                principal_amount: 10000.0,
                interest_rate: 12.0,
                interest_type: "REDUCING".to_string(),
                tenure_months: Some(12),
                emi_amount: Some(888.49),
                first_installment_amount: None,
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
            overdraft: None,
            setup: None,
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
                opening_principal: None,
                settled_before_finwea: false,
            }],
            historical_payments: vec![],
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
            "SELECT account_id, loan_account_id, loan_account_number, outstanding_principal, outstanding_interest, status FROM loans WHERE id = 'loan-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        // Stored as text, leading zeros intact.
        assert_eq!(
            loan.get::<Option<String>, _>("loan_account_number").as_deref(),
            Some("0099000123")
        );

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

    /// The Overdraft columns of migration 047, added to the focused schema.
    async fn add_overdraft_columns(pool: &Pool<Sqlite>) {
        sqlx::query(
            r#"
            ALTER TABLE loans ADD COLUMN loan_kind TEXT NOT NULL DEFAULT 'TERM_LOAN' CHECK (loan_kind IN ('TERM_LOAN', 'OVERDRAFT'));
            ALTER TABLE loans ADD COLUMN credit_limit REAL;
            ALTER TABLE loans ADD COLUMN opening_used REAL;
            ALTER TABLE loans ADD COLUMN opening_used_as_of TEXT;
            CREATE TABLE overdraft_accounts (
                id TEXT PRIMARY KEY,
                loan_id TEXT NOT NULL REFERENCES loans(id),
                account_id TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (loan_id, account_id)
            );
            "#,
        )
        .execute(pool)
        .await
        .expect("add the overdraft columns");
    }

    fn overdraft_request() -> CreateLoanAtomicRequest {
        let mut request = valid_request();
        request.loan.loan_type = "Overdraft".to_string();
        request.loan.principal_amount = 0.0;
        request.loan.tenure_months = None;
        request.loan.emi_amount = None;
        request.loan.maturity_date = None;
        request.loan.outstanding_principal = 0.0;
        request.loan.outstanding_interest = 0.0;
        request.schedule = vec![];
        request.balances = LoanAccountingBalances {
            outstanding_principal: 0.0,
            outstanding_interest: 0.0,
            status: "ACTIVE".to_string(),
        };
        request.overdraft = Some(OverdraftTerms {
            credit_limit: 5_000_000.0,
            opening_used: 2_000_000.0,
            opening_used_as_of: "2026-10-01".to_string(),
            account_ids: vec!["acct-a".to_string(), "acct-b".to_string()],
        });
        request
    }

    #[tokio::test]
    async fn a_term_loan_stays_a_term_loan_with_no_overdraft_terms() {
        let pool = test_pool().await;
        add_overdraft_columns(&pool).await;

        run_create(&pool, &valid_request())
            .await
            .expect("create succeeds");

        let loan = sqlx::query(
            "SELECT loan_kind, credit_limit, opening_used, opening_used_as_of FROM loans WHERE id = 'loan-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(loan.get::<String, _>("loan_kind"), "TERM_LOAN");
        assert!(loan.get::<Option<f64>, _>("credit_limit").is_none());
        assert!(loan.get::<Option<f64>, _>("opening_used").is_none());
        assert!(loan.get::<Option<String>, _>("opening_used_as_of").is_none());
    }

    #[tokio::test]
    async fn creates_an_overdraft_with_its_terms_and_no_schedule() {
        let pool = test_pool().await;
        add_overdraft_columns(&pool).await;

        run_create(&pool, &overdraft_request())
            .await
            .expect("create succeeds");

        assert_eq!(count(&pool, "accounts").await, 1);
        assert_eq!(count(&pool, "loans").await, 1);
        assert_eq!(count(&pool, "loan_payment_schedule").await, 0);

        let loan = sqlx::query(
            "SELECT loan_kind, credit_limit, opening_used, opening_used_as_of, loan_account_id FROM loans WHERE id = 'loan-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(loan.get::<String, _>("loan_kind"), "OVERDRAFT");
        assert_eq!(loan.get::<f64, _>("credit_limit"), 5_000_000.0);
        assert_eq!(loan.get::<f64, _>("opening_used"), 2_000_000.0);
        assert_eq!(loan.get::<String, _>("opening_used_as_of"), "2026-10-01");
        assert_eq!(loan.get::<String, _>("loan_account_id"), "loan-acct-1");

        let accounts: Vec<String> = sqlx::query(
            "SELECT account_id FROM overdraft_accounts WHERE loan_id = 'loan-1' ORDER BY account_id",
        )
        .fetch_all(&pool)
        .await
        .unwrap()
        .iter()
        .map(|row| row.get::<String, _>("account_id"))
        .collect();
        assert_eq!(accounts, vec!["acct-a", "acct-b"]);
    }

    #[tokio::test]
    async fn a_failed_overdraft_write_rolls_back_the_loan_and_its_account() {
        // No overdraft columns: the OD UPDATE - the last statement - fails.
        let pool = test_pool().await;

        let result = run_create(&pool, &overdraft_request()).await;

        assert!(result.is_err());
        assert_eq!(count(&pool, "accounts").await, 0);
        assert_eq!(count(&pool, "loans").await, 0);
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

    /// The setup columns and tables of migration 051, added to the focused schema.
    async fn add_setup_schema(pool: &Pool<Sqlite>) {
        sqlx::query(
            r#"
            ALTER TABLE loans ADD COLUMN loan_purpose TEXT;
            ALTER TABLE loans ADD COLUMN rate_type TEXT;
            ALTER TABLE loans ADD COLUMN interest_calculation_method TEXT;
            ALTER TABLE loans ADD COLUMN sanction_date TEXT;
            ALTER TABLE loans ADD COLUMN sanctioned_amount REAL;
            ALTER TABLE loans ADD COLUMN first_emi_date TEXT;
            ALTER TABLE loans ADD COLUMN repayment_frequency TEXT;
            ALTER TABLE loans ADD COLUMN payment_day INTEGER;
            ALTER TABLE loans ADD COLUMN grace_period_months INTEGER;
            ALTER TABLE loans ADD COLUMN balloon_amount REAL;
            ALTER TABLE loans ADD COLUMN schedule_source TEXT;
            ALTER TABLE loans ADD COLUMN drawing_power REAL;
            ALTER TABLE loan_payment_schedule ADD COLUMN opening_principal REAL;
            CREATE TABLE transactions (
                id TEXT PRIMARY KEY, account_id TEXT NOT NULL, amount REAL NOT NULL,
                type TEXT NOT NULL, transfer_direction TEXT, deleted_at TEXT,
                transaction_date TEXT NOT NULL DEFAULT '2026-09-20'
            );
            CREATE TABLE overdraft_transaction_links (id TEXT PRIMARY KEY, transaction_id TEXT UNIQUE);
            CREATE TABLE loan_schedule_payments (
                id TEXT PRIMARY KEY, loan_id TEXT NOT NULL REFERENCES loans(id),
                schedule_id TEXT NOT NULL REFERENCES loan_payment_schedule(id), transaction_id TEXT NOT NULL,
                payment_date TEXT NOT NULL, amount REAL NOT NULL, principal_amount REAL NOT NULL,
                interest_amount REAL NOT NULL, transaction_linked INTEGER NOT NULL DEFAULT 0,
                settles_installment INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE loan_disbursements (
                id TEXT PRIMARY KEY, loan_id TEXT NOT NULL REFERENCES loans(id), sequence INTEGER NOT NULL,
                disbursement_date TEXT NOT NULL, gross_amount REAL NOT NULL, deductions_amount REAL NOT NULL,
                net_amount REAL NOT NULL, destination_account_id TEXT, reference TEXT, transaction_id TEXT
            );
            CREATE TABLE loan_initial_expenses (
                id TEXT PRIMARY KEY, loan_id TEXT NOT NULL REFERENCES loans(id), expense_type TEXT NOT NULL,
                description TEXT, expense_date TEXT NOT NULL, base_amount REAL NOT NULL, gst_rate REAL,
                gst_amount REAL NOT NULL, total_amount REAL NOT NULL, settlement TEXT NOT NULL,
                disbursement_id TEXT, payment_method TEXT, payment_account_id TEXT,
                transaction_reference TEXT, transaction_id TEXT
            );
            INSERT INTO transactions (id, account_id, amount, type) VALUES ('fee', 'bank', 1180, 'expense');
            INSERT INTO overdraft_transaction_links (id, transaction_id) VALUES ('l1', 'fee');
            "#,
        )
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn stores_the_setup_and_the_lender_opening_principal_with_the_loan() {
        let pool = test_pool().await;
        add_setup_schema(&pool).await;

        let mut request = valid_request();
        request.schedule[0].opening_principal = Some(10_000.0);
        request.setup = Some(LoanSetupDetails {
            schedule_source: Some("LENDER_CSV".to_string()),
            first_emi_date: Some("2026-10-20".to_string()),
            ..Default::default()
        });

        run_create(&pool, &request).await.expect("create succeeds");

        let loan = sqlx::query("SELECT schedule_source, first_emi_date FROM loans WHERE id = 'loan-1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(loan.get::<String, _>("schedule_source"), "LENDER_CSV");
        assert_eq!(loan.get::<String, _>("first_emi_date"), "2026-10-20");

        let opening: f64 = sqlx::query("SELECT opening_principal FROM loan_payment_schedule")
            .fetch_one(&pool)
            .await
            .unwrap()
            .get("opening_principal");
        assert_eq!(opening, 10_000.0);
    }

    #[tokio::test]
    async fn a_dropline_overdraft_stores_its_steps_and_a_step_above_the_limit_rolls_back_everything() {
        async fn pool_with_schedule_table() -> Pool<Sqlite> {
            let pool = test_pool().await;
            add_overdraft_columns(&pool).await;
            add_setup_schema(&pool).await;
            sqlx::query(
                "CREATE TABLE loan_drawing_power_schedule (id TEXT PRIMARY KEY, loan_id TEXT NOT NULL, effective_date TEXT NOT NULL, drawing_power REAL NOT NULL, UNIQUE (loan_id, effective_date))",
            )
            .execute(&pool)
            .await
            .unwrap();
            pool
        }

        let step = |id: &str, date: &str, amount: f64| crate::loan_setup::NewDrawingPowerStep {
            id: id.to_string(),
            effective_date: date.to_string(),
            drawing_power: amount,
        };

        let pool = pool_with_schedule_table().await;
        let mut request = overdraft_request();
        request.setup = Some(LoanSetupDetails {
            drawing_power_schedule: vec![step("s1", "2026-01-01", 4_000_000.0), step("s2", "2026-04-01", 3_000_000.0)],
            ..Default::default()
        });
        run_create(&pool, &request).await.expect("create succeeds");

        let stored: Vec<(String, f64)> = sqlx::query_as(
            "SELECT effective_date, drawing_power FROM loan_drawing_power_schedule ORDER BY effective_date",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(stored, vec![("2026-01-01".to_string(), 4_000_000.0), ("2026-04-01".to_string(), 3_000_000.0)]);

        let pool = pool_with_schedule_table().await;
        let mut refused = overdraft_request();
        refused.setup = Some(LoanSetupDetails {
            drawing_power_schedule: vec![step("s3", "2026-01-01", 9_000_000.0)],
            ..Default::default()
        });
        let error = run_create(&pool, &refused).await.expect_err("refused").to_string();
        assert!(error.contains(crate::loan_setup::REFUSED), "{error}");
        assert_eq!(count(&pool, "loans").await, 0);
        assert_eq!(count(&pool, "accounts").await, 0);
        assert_eq!(count(&pool, "loan_drawing_power_schedule").await, 0);
    }

    #[tokio::test]
    async fn dropline_steps_are_refused_unless_valid_for_an_overdraft_and_nothing_is_written() {
        async fn pool_with_schedule_table() -> Pool<Sqlite> {
            let pool = test_pool().await;
            add_overdraft_columns(&pool).await;
            add_setup_schema(&pool).await;
            sqlx::query(
                "CREATE TABLE loan_drawing_power_schedule (id TEXT PRIMARY KEY, loan_id TEXT NOT NULL, effective_date TEXT NOT NULL, drawing_power REAL NOT NULL, UNIQUE (loan_id, effective_date))",
            )
            .execute(&pool)
            .await
            .unwrap();
            pool
        }

        let step = |id: &str, date: &str, amount: f64| crate::loan_setup::NewDrawingPowerStep {
            id: id.to_string(),
            effective_date: date.to_string(),
            drawing_power: amount,
        };

        async fn assert_refused(request: &CreateLoanAtomicRequest, expected: &str) {
            let pool = pool_with_schedule_table().await;
            let error = run_create(&pool, request).await.expect_err("refused").to_string();
            assert!(error.contains(crate::loan_setup::REFUSED), "{error}");
            assert!(error.contains(expected), "{error}");
            assert_eq!(count(&pool, "loans").await, 0);
            assert_eq!(count(&pool, "accounts").await, 0);
            assert_eq!(count(&pool, "loan_payment_schedule").await, 0);
            assert_eq!(count(&pool, "loan_drawing_power_schedule").await, 0);
        }

        // A Term Loan never takes drawing-power steps.
        let mut term = valid_request();
        term.setup = Some(LoanSetupDetails {
            drawing_power_schedule: vec![step("t1", "2026-01-01", 1_000.0)],
            ..Default::default()
        });
        assert_refused(&term, "only to an Overdraft").await;

        let overdraft_with = |steps| {
            let mut request = overdraft_request();
            request.setup = Some(LoanSetupDetails { drawing_power_schedule: steps, ..Default::default() });
            request
        };

        assert_refused(&overdraft_with(vec![step("d1", "2026-13-01", 1_000.0)]), "not a valid date").await;
        assert_refused(&overdraft_with(vec![step("d2", "01/04/2026", 1_000.0)]), "not a valid date").await;
        assert_refused(
            &overdraft_with(vec![step("d3", "2026-04-01", 2_000.0), step("d4", "2026-04-01", 1_000.0)]),
            "same date",
        )
        .await;
        assert_refused(&overdraft_with(vec![step("d5", "2026-04-01", -1.0)]), "cannot be negative").await;
        assert_refused(&overdraft_with(vec![step("d6", "2026-04-01", 9_000_000.0)]), "more than the sanctioned limit").await;

        // A valid set, including a zero step, still saves.
        let pool = pool_with_schedule_table().await;
        run_create(&pool, &overdraft_with(vec![step("ok1", "2026-01-01", 1_000.0), step("ok2", "2026-07-01", 0.0)]))
            .await
            .expect("create succeeds");
        assert_eq!(count(&pool, "loan_drawing_power_schedule").await, 2);
    }

    #[tokio::test]
    async fn an_overdraft_without_steps_never_touches_the_unapplied_schedule_table() {
        let pool = test_pool().await;
        add_overdraft_columns(&pool).await;
        add_setup_schema(&pool).await;

        let mut request = overdraft_request();
        request.setup = Some(LoanSetupDetails::default());
        run_create(&pool, &request).await.expect("create succeeds without migration 053");
        assert_eq!(count(&pool, "loans").await, 1);
    }

    #[tokio::test]
    async fn a_refused_setup_rolls_back_the_whole_loan_account_and_schedule() {
        let pool = test_pool().await;
        add_setup_schema(&pool).await;

        let mut request = valid_request();
        request.setup = Some(LoanSetupDetails {
            expenses: vec![crate::loan_setup::NewInitialExpense {
                id: "e1".to_string(),
                expense_type: "PROCESSING_FEE".to_string(),
                description: None,
                expense_date: "2026-09-20".to_string(),
                base_amount: 1_000.0,
                gst_rate: Some(18.0),
                gst_amount: 180.0,
                total_amount: 1_180.0,
                settlement: "PAID_SEPARATELY".to_string(),
                disbursement_id: None,
                payment_method: None,
                payment_account_id: None,
                transaction_reference: None,
                // Already an OD link - must be refused.
                transaction_id: Some("fee".to_string()),
            }],
            ..Default::default()
        });

        let error = run_create(&pool, &request).await.expect_err("refused").to_string();
        assert!(error.contains(crate::loan_setup::REFUSED), "{error}");

        assert_eq!(count(&pool, "accounts").await, 0);
        assert_eq!(count(&pool, "loans").await, 0);
        assert_eq!(count(&pool, "loan_payment_schedule").await, 0);
        assert_eq!(count(&pool, "loan_initial_expenses").await, 0);
    }

    // ---------------------------------------------------- historical rows

    const TODAY: &str = "2026-11-25";

    fn row(id: &str, number: i64, due: &str) -> LoanScheduleInstallment {
        LoanScheduleInstallment {
            id: id.to_string(),
            installment_number: number,
            due_date: due.to_string(),
            principal_amount: 800.0,
            interest_amount: 200.0,
            total_amount: 1_000.0,
            outstanding_principal: 10_000.0 - 800.0 * number as f64,
            status: "UPCOMING".to_string(),
            paid_date: None,
            paid_amount: None,
            transaction_id: None,
            opening_principal: None,
            settled_before_finwea: false,
        }
    }

    fn paid_linked(mut row: LoanScheduleInstallment, transaction: &str, date: &str) -> LoanScheduleInstallment {
        row.status = "PAID".to_string();
        row.paid_date = Some(date.to_string());
        row.paid_amount = Some(row.total_amount);
        row.transaction_id = Some(transaction.to_string());
        row
    }

    fn settled(mut row: LoanScheduleInstallment) -> LoanScheduleInstallment {
        row.status = "PAID".to_string();
        row.paid_date = Some(row.due_date.clone());
        row.paid_amount = Some(row.total_amount);
        row.settled_before_finwea = true;
        row
    }

    fn historical_payment(schedule: &str, transaction: &str) -> HistoricalPayment {
        HistoricalPayment {
            id: format!("pay-{schedule}"),
            schedule_id: schedule.to_string(),
            transaction_id: transaction.to_string(),
        }
    }

    /// A running loan on the EMI account "bank": instalments due 20 Sep,
    /// 20 Oct, 20 Nov and 20 Dec 2026 (today is 25 Nov), and real EMI
    /// debits on "bank" for some of them.
    async fn historical_pool() -> Pool<Sqlite> {
        let pool = test_pool().await;
        add_setup_schema(&pool).await;
        sqlx::query(
            r#"
            INSERT INTO accounts (id, currency_id, name, account_type, created_at, updated_at)
                VALUES ('bank', 'cur-inr', 'Netedge 3999', 'BANK', '2026-01-01', '2026-01-01'),
                       ('other-bank', 'cur-inr', 'Netedge 2790', 'BANK', '2026-01-01', '2026-01-01');
            INSERT INTO transactions (id, account_id, amount, type, transfer_direction, transaction_date) VALUES
                ('emi-sep', 'bank', 1000, 'expense', NULL, '2026-09-21'),
                ('emi-oct', 'bank', 1000, 'transfer', 'OUT', '2026-10-20'),
                ('emi-nov', 'bank', 1000, 'expense', NULL, '2026-11-20'),
                ('emi-other-account', 'other-bank', 1000, 'expense', NULL, '2026-10-20'),
                ('emi-short', 'bank', 999.99, 'expense', NULL, '2026-10-20'),
                ('emi-credit', 'bank', 1000, 'income', NULL, '2026-10-20'),
                ('emi-future', 'bank', 1000, 'expense', NULL, '2026-11-30');
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    fn historical_request(schedule: Vec<LoanScheduleInstallment>, payments: Vec<HistoricalPayment>) -> CreateLoanAtomicRequest {
        let mut request = valid_request();
        request.loan.account_id = Some("bank".to_string());
        request.loan.start_date = "2026-08-20".to_string();
        request.loan.paid_installments = schedule.iter().filter(|r| r.status == "PAID").count() as i64;
        request.schedule = schedule;
        request.historical_payments = payments;
        request
    }

    fn four_rows() -> Vec<LoanScheduleInstallment> {
        vec![
            row("s1", 1, "2026-09-20"),
            row("s2", 2, "2026-10-20"),
            row("s3", 3, "2026-11-20"),
            row("s4", 4, "2026-12-20"),
        ]
    }

    async fn refusal(pool: &Pool<Sqlite>, request: &CreateLoanAtomicRequest) -> String {
        let error = run_create_on(pool, request, TODAY).await.expect_err("refused").to_string();
        assert!(error.contains(REFUSED), "{error}");
        error
    }

    async fn nothing_written(pool: &Pool<Sqlite>) {
        assert_eq!(count(pool, "loans").await, 0);
        assert_eq!(count(pool, "loan_payment_schedule").await, 0);
        assert_eq!(count(pool, "loan_schedule_payments").await, 0);
        // Only the two seeded bank accounts - no mirror account left behind.
        assert_eq!(count(pool, "accounts").await, 2);
    }

    #[tokio::test]
    async fn refuses_a_paid_instalment_with_no_payment_and_no_settlement_the_old_count_behaviour() {
        let pool = historical_pool().await;
        let mut rows = four_rows();
        rows[0].status = "PAID".to_string();
        rows[0].paid_date = Some("2026-09-20".to_string());
        rows[0].paid_amount = Some(1_000.0);

        let error = refusal(&pool, &historical_request(rows, vec![])).await;

        assert!(error.contains("without a linked bank transaction"), "{error}");
        nothing_written(&pool).await;
    }

    #[tokio::test]
    async fn refuses_marking_a_future_instalment_paid_even_as_settled() {
        let pool = historical_pool().await;
        let rows: Vec<_> = four_rows().into_iter().map(settled).collect();

        let error = refusal(&pool, &historical_request(rows, vec![])).await;

        assert!(error.contains("Instalment #4 is due on 2026-12-20, after today"), "{error}");
        nothing_written(&pool).await;
    }

    #[tokio::test]
    async fn stores_a_settled_before_finwea_instalment_flagged_with_no_payment_record() {
        let pool = historical_pool().await;
        let mut rows = four_rows();
        rows[0] = settled(rows[0].clone());

        run_create_on(&pool, &historical_request(rows, vec![]), TODAY)
            .await
            .expect("create succeeds");

        let stored = sqlx::query(
            "SELECT status, settled_before_finwea, transaction_id FROM loan_payment_schedule ORDER BY installment_number",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(stored[0].get::<String, _>("status"), "PAID");
        assert_eq!(stored[0].get::<i64, _>("settled_before_finwea"), 1);
        assert!(stored[0].get::<Option<String>, _>("transaction_id").is_none());
        assert_eq!(stored[1].get::<i64, _>("settled_before_finwea"), 0);
        assert_eq!(count(&pool, "loan_schedule_payments").await, 0, "a settlement is not a payment");

        let paid: i64 = sqlx::query("SELECT paid_installments FROM loans")
            .fetch_one(&pool)
            .await
            .unwrap()
            .get("paid_installments");
        assert_eq!(paid, 1);
    }

    #[tokio::test]
    async fn links_historical_debits_as_real_linked_payments_and_leaves_the_transactions_unchanged() {
        let pool = historical_pool().await;
        let before: Vec<(String, f64, String)> = sqlx::query("SELECT id, amount, type FROM transactions ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap()
            .iter()
            .map(|r| (r.get("id"), r.get("amount"), r.get("type")))
            .collect();
        let mut rows = four_rows();
        rows[0] = paid_linked(rows[0].clone(), "emi-sep", "2026-09-21");
        // A Transfer OUT is money out too.
        rows[1] = paid_linked(rows[1].clone(), "emi-oct", "2026-10-20");

        run_create_on(
            &pool,
            &historical_request(rows, vec![historical_payment("s1", "emi-sep"), historical_payment("s2", "emi-oct")]),
            TODAY,
        )
        .await
        .expect("create succeeds");

        let payments = sqlx::query(
            "SELECT schedule_id, transaction_id, payment_date, amount, principal_amount, interest_amount, transaction_linked, settles_installment FROM loan_schedule_payments ORDER BY schedule_id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(payments.len(), 2);
        assert_eq!(payments[0].get::<String, _>("transaction_id"), "emi-sep");
        assert_eq!(payments[0].get::<String, _>("payment_date"), "2026-09-21");
        assert_eq!(payments[0].get::<f64, _>("amount"), 1_000.0);
        assert_eq!(payments[0].get::<f64, _>("principal_amount"), 800.0);
        assert_eq!(payments[0].get::<f64, _>("interest_amount"), 200.0);
        assert_eq!(payments[0].get::<i64, _>("transaction_linked"), 1);
        assert_eq!(payments[0].get::<i64, _>("settles_installment"), 0);

        let after: Vec<(String, f64, String)> = sqlx::query("SELECT id, amount, type FROM transactions ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap()
            .iter()
            .map(|r| (r.get("id"), r.get("amount"), r.get("type")))
            .collect();
        assert_eq!(after, before, "linking never creates or changes a bank transaction");
    }

    #[tokio::test]
    async fn refuses_one_bank_transaction_for_two_instalments() {
        let pool = historical_pool().await;
        let mut rows = four_rows();
        rows[0] = paid_linked(rows[0].clone(), "emi-sep", "2026-09-21");
        rows[1] = paid_linked(rows[1].clone(), "emi-sep", "2026-09-21");

        let error = refusal(
            &pool,
            &historical_request(rows, vec![historical_payment("s1", "emi-sep"), historical_payment("s2", "emi-sep")]),
        )
        .await;

        assert!(error.contains("more than one instalment"), "{error}");
        nothing_written(&pool).await;
    }

    #[tokio::test]
    async fn refuses_a_transaction_already_used_by_an_overdraft_link() {
        let pool = historical_pool().await;
        sqlx::query("INSERT INTO overdraft_transaction_links (id, transaction_id) VALUES ('l2', 'emi-sep')")
            .execute(&pool)
            .await
            .unwrap();
        let mut rows = four_rows();
        rows[0] = paid_linked(rows[0].clone(), "emi-sep", "2026-09-21");

        let error = refusal(&pool, &historical_request(rows, vec![historical_payment("s1", "emi-sep")])).await;

        assert!(error.contains("already linked"), "{error}");
        nothing_written(&pool).await;
    }

    #[tokio::test]
    async fn refuses_a_debit_on_another_account_of_another_amount_money_in_or_dated_after_today() {
        for (transaction, date, expected) in [
            ("emi-other-account", "2026-10-20", "different bank account"),
            ("emi-short", "2026-10-20", "not 1000.00"),
            ("emi-credit", "2026-10-20", "not money paid out"),
            ("emi-future", "2026-11-30", "dated after today"),
        ] {
            let pool = historical_pool().await;
            let mut rows = four_rows();
            rows[0] = paid_linked(rows[0].clone(), transaction, date);

            let error = refusal(&pool, &historical_request(rows, vec![historical_payment("s1", transaction)])).await;

            assert!(error.contains(expected), "{transaction}: {error}");
            nothing_written(&pool).await;
        }
    }

    #[tokio::test]
    async fn refuses_a_paid_date_that_is_not_the_transactions_own_date() {
        let pool = historical_pool().await;
        let mut rows = four_rows();
        rows[0] = paid_linked(rows[0].clone(), "emi-sep", "2026-09-20");

        let error = refusal(&pool, &historical_request(rows, vec![historical_payment("s1", "emi-sep")])).await;

        assert!(error.contains("must be its bank transaction's date (2026-09-21)"), "{error}");
        nothing_written(&pool).await;
    }

    #[tokio::test]
    async fn refuses_paid_rows_that_are_not_the_leading_instalments() {
        let pool = historical_pool().await;
        let mut rows = four_rows();
        rows[1] = settled(rows[1].clone());

        let error = refusal(&pool, &historical_request(rows, vec![])).await;

        assert!(error.contains("first instalments of the schedule, in order"), "{error}");
        nothing_written(&pool).await;
    }

    #[tokio::test]
    async fn refuses_a_paid_count_that_does_not_match_the_schedule() {
        let pool = historical_pool().await;
        let mut rows = four_rows();
        rows[0] = settled(rows[0].clone());
        let mut request = historical_request(rows, vec![]);
        request.loan.paid_installments = 8;

        let error = refusal(&pool, &request).await;

        assert!(error.contains("says 8 instalment(s) are paid"), "{error}");
        nothing_written(&pool).await;
    }

    #[tokio::test]
    async fn refuses_a_settled_row_that_also_carries_a_transaction_or_an_unpaid_row_that_carries_one() {
        let pool = historical_pool().await;
        let mut rows = four_rows();
        rows[0] = settled(rows[0].clone());
        rows[0].transaction_id = Some("emi-sep".to_string());

        let error = refusal(&pool, &historical_request(rows, vec![])).await;
        assert!(error.contains("cannot also be linked"), "{error}");

        let mut rows = four_rows();
        rows[0].transaction_id = Some("emi-sep".to_string());
        let error = refusal(&pool, &historical_request(rows, vec![])).await;
        assert!(error.contains("is not paid, so it cannot carry a payment"), "{error}");
        nothing_written(&pool).await;
    }
}
