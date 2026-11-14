//! Interest Rate History, Stage 3: record a confirmed rate change in ONE
//! database transaction (migration 054).
//!
//! Everything the confirmed change writes succeeds or fails together:
//!   - the loan's original rate row, when it has no history yet (written
//!     before the current rate is changed, from loans.interest_rate);
//!   - a correction's supersession of the entry it replaces (never edited:
//!     the old row is only marked superseded, with the reason);
//!   - the new history row (its previous rate worked out here);
//!   - for a repriced Term Loan, the replacement of its future, unprotected
//!     instalments and the loan's EMI / tenure / maturity / outstanding
//!     interest;
//!   - loans.interest_rate, set to the rate in force today.
//!
//! The one rate rule (Stage 3.1; TS: setup/interestRateHistory.ts): the
//! rate in force on a date is the latest LIVE entry starting on or before
//! it. An entry dated after today is upcoming - it is never written to
//! loans.interest_rate before its date. loans.interest_rate is therefore a
//! snapshot of the rate in force on the day of the last save; the app
//! derives the current rate from the history, and the next save here
//! brings the snapshot up to date (it is never trusted for a loan with
//! history). A loan with no history has only its own rate: its baseline
//! (INITIAL, from its start date) is written here, with the first explicit
//! change and never on its own; a loan whose rows are all superseded has
//! no safe baseline and is refused.
//!
//! The proposal was made in the app from a snapshot of the loan; the
//! command refuses it when the loan's rate, live history or schedule has
//! changed since (a stale proposal). It re-checks every rule itself:
//! protected instalments (paid, partly paid, transaction-linked, with a
//! payment record, settled before FinWea) are never touched; a lender CSV
//! schedule or an Overdraft is never repriced; conflicting or duplicate
//! live rates on one date are refused.
//!
//! A pool connection per call cannot hold a transaction across separate
//! `execute()` calls (see loan_create.rs), hence this command.

use serde::Deserialize;
use sqlx::{Pool, Row, Sqlite, Transaction};
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

const DB_KEY: &str = "sqlite:financeos.db";
pub const REFUSED: &str = "RATE_CHANGE_REFUSED: ";
const MONEY_EPSILON: f64 = 0.005;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExpectedScheduleRow {
    pub id: String,
    pub installment_number: i64,
    pub due_date: String,
    pub principal_amount: f64,
    pub interest_amount: f64,
    pub total_amount: f64,
    pub outstanding_principal: f64,
    pub status: String,
    #[serde(default)]
    pub transaction_id: Option<String>,
    #[serde(default)]
    pub paid_amount: Option<f64>,
    #[serde(default)]
    pub settled_before_finwea: bool,
}

/// What the proposal was made from.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExpectedLoanState {
    pub interest_rate: f64,
    pub live_history_ids: Vec<String>,
    pub schedule: Vec<ExpectedScheduleRow>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NewRateEntry {
    pub id: String,
    pub effective_from: String,
    pub rate: f64,
    #[serde(default)]
    pub rate_type: Option<String>,
    pub source: String,
    #[serde(default)]
    pub reference: Option<String>,
    #[serde(default)]
    pub document_id: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Supersession {
    pub id: String,
    pub reason: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NewScheduleRow {
    pub id: String,
    pub installment_number: i64,
    pub due_date: String,
    pub principal_amount: f64,
    pub interest_amount: f64,
    pub total_amount: f64,
    pub outstanding_principal: f64,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleReplacement {
    /// The first instalment replaced; every earlier one is kept as it is.
    pub from_instalment: i64,
    pub rows: Vec<NewScheduleRow>,
    pub emi_amount: f64,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecordRateChangeRequest {
    pub loan_id: String,
    pub expected: ExpectedLoanState,
    /// The loan's original rate, for a loan with no live history yet.
    #[serde(default)]
    pub initial_entry: Option<NewRateEntry>,
    pub entry: NewRateEntry,
    #[serde(default)]
    pub supersedes: Option<Supersession>,
    #[serde(default)]
    pub schedule: Option<ScheduleReplacement>,
}

fn refused(message: impl Into<String>) -> sqlx::Error {
    sqlx::Error::Protocol(format!("{REFUSED}{}", message.into()))
}

fn same_money(a: f64, b: f64) -> bool {
    (a - b).abs() < MONEY_EPSILON
}

fn is_iso_date(value: &str) -> bool {
    chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok() && value.len() == 10
}

fn is_rate(value: f64) -> bool {
    value.is_finite() && (0.0..=100.0).contains(&value)
}

fn local_today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn day(value: &str) -> &str {
    value.get(..10).unwrap_or(value)
}

fn check_entry(entry: &NewRateEntry, allowed_sources: &[&str]) -> Result<(), sqlx::Error> {
    if entry.id.trim().is_empty() {
        return Err(refused("The rate entry has no id."));
    }
    if !is_iso_date(&entry.effective_from) {
        return Err(refused("The effective date must be a valid date (YYYY-MM-DD)."));
    }
    if !is_rate(entry.rate) {
        return Err(refused("The rate must be from 0 to 100 (% per year)."));
    }
    if let Some(rate_type) = entry.rate_type.as_deref() {
        if rate_type != "FIXED" && rate_type != "FLOATING" {
            return Err(refused("The rate type must be Fixed or Floating."));
        }
    }
    if !allowed_sources.contains(&entry.source.as_str()) {
        return Err(refused(format!("The source {} is not allowed here.", entry.source)));
    }
    Ok(())
}

async fn insert_entry(
    tx: &mut Transaction<'_, Sqlite>,
    loan_id: &str,
    entry: &NewRateEntry,
    previous_rate: Option<f64>,
    applied_from_instalment: Option<i64>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO loan_interest_rate_history
        (id, loan_id, effective_from, rate, previous_rate, rate_type, source, reference,
         document_id, notes, applied_from_instalment, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&entry.id)
    .bind(loan_id)
    .bind(&entry.effective_from)
    .bind(entry.rate)
    .bind(previous_rate)
    .bind(&entry.rate_type)
    .bind(&entry.source)
    .bind(entry.reference.as_deref().map(str::trim).filter(|v| !v.is_empty()))
    .bind(entry.document_id.as_deref().filter(|v| !v.trim().is_empty()))
    .bind(entry.notes.as_deref().map(str::trim).filter(|v| !v.is_empty()))
    .bind(applied_from_instalment)
    .bind(&entry.created_at)
    .execute(&mut **tx)
    .await
    .map(|_| ())
    .map_err(|error| {
        if error.to_string().contains("UNIQUE") {
            refused("This rate is already recorded from that date.")
        } else {
            error
        }
    })
}

/// The live entries, in date order (then the order they were recorded).
async fn live_entries(tx: &mut Transaction<'_, Sqlite>, loan_id: &str) -> Result<Vec<(String, String, f64)>, sqlx::Error> {
    Ok(sqlx::query(
        "SELECT id, effective_from, rate FROM loan_interest_rate_history WHERE loan_id = ? AND superseded_at IS NULL ORDER BY effective_from, created_at, id",
    )
    .bind(loan_id)
    .fetch_all(&mut **tx)
    .await?
    .iter()
    .map(|row| (row.get("id"), row.get("effective_from"), row.get("rate")))
    .collect())
}

/// Refused unless the loan, its live history and its schedule are exactly
/// what the proposal was made from.
async fn check_not_stale(tx: &mut Transaction<'_, Sqlite>, request: &RecordRateChangeRequest, current_rate: f64) -> Result<(), sqlx::Error> {
    const STALE: &str = "The loan has changed since this rate change was prepared (its rate, rate history or schedule). Nothing was saved - prepare it again.";

    if !same_money(current_rate, request.expected.interest_rate) {
        return Err(refused(STALE));
    }

    let mut live: Vec<String> = live_entries(tx, &request.loan_id).await?.into_iter().map(|(id, _, _)| id).collect();
    let mut expected_ids = request.expected.live_history_ids.clone();
    live.sort();
    expected_ids.sort();
    if live != expected_ids {
        return Err(refused(STALE));
    }

    let rows = sqlx::query(
        r#"
        SELECT id, installment_number, substr(due_date, 1, 10) AS due_date, principal_amount, interest_amount, total_amount,
               outstanding_principal, status, transaction_id, paid_amount, COALESCE(settled_before_finwea, 0) AS settled
        FROM loan_payment_schedule
        WHERE loan_id = ?
        ORDER BY installment_number
        "#,
    )
    .bind(&request.loan_id)
    .fetch_all(&mut **tx)
    .await?;

    if rows.len() != request.expected.schedule.len() {
        return Err(refused(STALE));
    }

    for (row, expected) in rows.iter().zip(request.expected.schedule.iter()) {
        let paid: Option<f64> = row.get("paid_amount");
        let same = row.get::<String, _>("id") == expected.id
            && row.get::<i64, _>("installment_number") == expected.installment_number
            && row.get::<String, _>("due_date") == day(&expected.due_date)
            && same_money(row.get("principal_amount"), expected.principal_amount)
            && same_money(row.get("interest_amount"), expected.interest_amount)
            && same_money(row.get("total_amount"), expected.total_amount)
            && same_money(row.get("outstanding_principal"), expected.outstanding_principal)
            && row.get::<String, _>("status") == expected.status
            && row.get::<Option<String>, _>("transaction_id") == expected.transaction_id
            && same_money(paid.unwrap_or(0.0), expected.paid_amount.unwrap_or(0.0))
            && (row.get::<i64, _>("settled") != 0) == expected.settled_before_finwea;
        if !same {
            return Err(refused(STALE));
        }
    }

    Ok(())
}

async fn replace_schedule(
    tx: &mut Transaction<'_, Sqlite>,
    loan_id: &str,
    loan_principal: f64,
    replacement: &ScheduleReplacement,
) -> Result<(), sqlx::Error> {
    let from = replacement.from_instalment;
    if from < 1 || replacement.rows.is_empty() {
        return Err(refused("The revised schedule is empty."));
    }

    // Every instalment replaced must be free of any payment.
    let protected: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM loan_payment_schedule s
        WHERE s.loan_id = ? AND s.installment_number >= ?
          AND (s.status NOT IN ('UPCOMING', 'OVERDUE')
               OR s.transaction_id IS NOT NULL
               OR COALESCE(s.paid_amount, 0) <> 0
               OR COALESCE(s.settled_before_finwea, 0) <> 0
               OR EXISTS (SELECT 1 FROM loan_schedule_payments p WHERE p.schedule_id = s.id))
        "#,
    )
    .bind(loan_id)
    .bind(from)
    .fetch_one(&mut **tx)
    .await?;
    if protected > 0 {
        return Err(refused("An instalment that would be replaced is paid, partly paid, linked or settled. Paid instalments are never changed."));
    }

    // Where the revised instalments start: the instalment before, as it is.
    let (opening, previous_due): (f64, Option<String>) = if from == 1 {
        (loan_principal, None)
    } else {
        let row = sqlx::query("SELECT outstanding_principal, substr(due_date, 1, 10) AS due FROM loan_payment_schedule WHERE loan_id = ? AND installment_number = ?")
            .bind(loan_id)
            .bind(from - 1)
            .fetch_optional(&mut **tx)
            .await?
            .ok_or_else(|| refused("The instalment before the revised ones does not exist."))?;
        (row.get("outstanding_principal"), Some(row.get("due")))
    };

    let mut balance = opening;
    let mut last_due = previous_due;
    for (index, row) in replacement.rows.iter().enumerate() {
        let label = format!("Revised instalment {}", row.installment_number);
        if row.installment_number != from + index as i64 {
            return Err(refused(format!("{label} is out of sequence.")));
        }
        if !is_iso_date(&row.due_date) || last_due.as_deref().is_some_and(|due| row.due_date.as_str() <= due) {
            return Err(refused(format!("{label} has an invalid or out-of-order due date.")));
        }
        if row.id.trim().is_empty()
            || [row.principal_amount, row.interest_amount, row.total_amount, row.outstanding_principal].iter().any(|v| !v.is_finite() || *v < 0.0)
            || !same_money(row.principal_amount + row.interest_amount, row.total_amount)
            || !same_money(balance - row.principal_amount, row.outstanding_principal)
        {
            return Err(refused(format!("{label} does not add up.")));
        }
        balance = row.outstanding_principal;
        last_due = Some(row.due_date.clone());
    }
    if !same_money(balance, 0.0) {
        return Err(refused("The revised schedule does not end at zero."));
    }

    let old_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM loan_payment_schedule WHERE loan_id = ?")
        .bind(loan_id)
        .fetch_one(&mut **tx)
        .await?;

    let old_interest: f64 = sqlx::query_scalar("SELECT COALESCE(SUM(interest_amount), 0) FROM loan_payment_schedule WHERE loan_id = ? AND installment_number >= ?")
        .bind(loan_id)
        .bind(from)
        .fetch_one(&mut **tx)
        .await?;

    for row in &replacement.rows {
        let updated = sqlx::query(
            r#"
            UPDATE loan_payment_schedule
            SET due_date = ?, principal_amount = ?, interest_amount = ?, total_amount = ?, outstanding_principal = ?,
                opening_principal = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE loan_id = ? AND installment_number = ?
            "#,
        )
        .bind(&row.due_date)
        .bind(row.principal_amount)
        .bind(row.interest_amount)
        .bind(row.total_amount)
        .bind(row.outstanding_principal)
        .bind(loan_id)
        .bind(row.installment_number)
        .execute(&mut **tx)
        .await?
        .rows_affected();

        if updated == 0 {
            sqlx::query(
                r#"
                INSERT INTO loan_payment_schedule
                (id, loan_id, installment_number, due_date, principal_amount, interest_amount, total_amount,
                 outstanding_principal, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UPCOMING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                "#,
            )
            .bind(&row.id)
            .bind(loan_id)
            .bind(row.installment_number)
            .bind(&row.due_date)
            .bind(row.principal_amount)
            .bind(row.interest_amount)
            .bind(row.total_amount)
            .bind(row.outstanding_principal)
            .execute(&mut **tx)
            .await?;
        }
    }

    let last = from + replacement.rows.len() as i64 - 1;
    sqlx::query("DELETE FROM loan_payment_schedule WHERE loan_id = ? AND installment_number > ?")
        .bind(loan_id)
        .bind(last)
        .execute(&mut **tx)
        .await?;

    let new_interest: f64 = replacement.rows.iter().map(|row| row.interest_amount).sum();
    let new_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM loan_payment_schedule WHERE loan_id = ?")
        .bind(loan_id)
        .fetch_one(&mut **tx)
        .await?;

    sqlx::query(
        r#"
        UPDATE loans
        SET emi_amount = ?, tenure_months = COALESCE(tenure_months, ?) + ?, maturity_date = ?,
            outstanding_interest = ROUND(MAX(0, outstanding_interest - ? + ?), 2),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        "#,
    )
    .bind(replacement.emi_amount)
    // tenure_months moves with the number of instalments (a broken-period
    // first instalment is not counted in it, so it is not recomputed).
    .bind(old_count)
    .bind(new_count - old_count)
    .bind(last_due)
    .bind(old_interest)
    .bind(new_interest)
    .bind(loan_id)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

pub(crate) async fn run_record_on(pool: &Pool<Sqlite>, request: &RecordRateChangeRequest, today: &str) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;

    let outcome: Result<(), sqlx::Error> = async {
        let table: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'loan_interest_rate_history'")
            .fetch_one(&mut *tx)
            .await?;
        if table == 0 {
            return Err(refused("Interest rate history needs a database update (migration 054) that has not been applied."));
        }

        let loan = sqlx::query(
            "SELECT loan_kind, interest_rate, principal_amount, substr(start_date, 1, 10) AS start_date, schedule_source, deleted_at FROM loans WHERE id = ?",
        )
        .bind(&request.loan_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| refused("The loan does not exist."))?;
        if loan.get::<Option<String>, _>("deleted_at").is_some() {
            return Err(refused("The loan has been deleted."));
        }
        let loan_kind: String = loan.get("loan_kind");
        let current_rate: f64 = loan.get("interest_rate");
        let start_date: String = loan.get("start_date");

        check_not_stale(&mut tx, request, current_rate).await?;

        // The original rate first, for a loan with no history yet.
        let live_before = live_entries(&mut tx, &request.loan_id).await?;
        if live_before.is_empty() {
            let any_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM loan_interest_rate_history WHERE loan_id = ?")
                .bind(&request.loan_id)
                .fetch_one(&mut *tx)
                .await?;
            if any_rows > 0 {
                return Err(refused(
                    "This loan's rate history has only corrected (superseded) entries and no current one, so its original rate is ambiguous. Nothing was saved.",
                ));
            }
        }
        match (&request.initial_entry, live_before.is_empty()) {
            (Some(initial), true) => {
                check_entry(initial, &["INITIAL"])?;
                if !same_money(initial.rate, current_rate) || initial.effective_from != start_date {
                    return Err(refused("The original rate must be the loan's own rate from its start date."));
                }
                insert_entry(&mut tx, &request.loan_id, initial, None, None).await?;
            }
            (Some(_), false) => return Err(refused("The loan already has rate history; its original rate is not recorded again.")),
            (None, true) => return Err(refused("Record the loan's original rate before changing it.")),
            (None, false) => {}
        }

        // A correction: mark the replaced entry superseded (never edit it).
        let corrects_initial = if let Some(supersession) = &request.supersedes {
            if supersession.reason.trim().is_empty() {
                return Err(refused("Give the reason for the correction."));
            }
            let target = sqlx::query("SELECT source, superseded_at FROM loan_interest_rate_history WHERE id = ? AND loan_id = ?")
                .bind(&supersession.id)
                .bind(&request.loan_id)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or_else(|| refused("The entry being corrected does not belong to this loan."))?;
            if target.get::<Option<String>, _>("superseded_at").is_some() {
                return Err(refused("The entry being corrected has already been corrected."));
            }
            // The new row is inserted below; its reference is checked at commit.
            sqlx::query("PRAGMA defer_foreign_keys = ON").execute(&mut *tx).await?;
            sqlx::query(
                "UPDATE loan_interest_rate_history SET superseded_by = ?, superseded_at = CURRENT_TIMESTAMP, correction_reason = ? WHERE id = ?",
            )
            .bind(&request.entry.id)
            .bind(supersession.reason.trim())
            .bind(&supersession.id)
            .execute(&mut *tx)
            .await?;
            target.get::<String, _>("source") == "INITIAL"
        } else {
            false
        };

        let sources: &[&str] = if corrects_initial { &["INITIAL"] } else { &["MANUAL", "STATEMENT_IMPORT", "LENDER_NOTICE"] };
        check_entry(&request.entry, sources)?;
        if corrects_initial && request.entry.effective_from != start_date {
            return Err(refused("The original rate applies from the loan's start date."));
        }
        if request.entry.effective_from.as_str() < start_date.as_str() {
            return Err(refused("The effective date is before the loan started."));
        }

        let live = live_entries(&mut tx, &request.loan_id).await?;
        if let Some((_, _, rate)) = live.iter().find(|(_, date, _)| *date == request.entry.effective_from) {
            return Err(refused(if same_money(*rate, request.entry.rate) {
                "This rate is already recorded from that date.".to_string()
            } else {
                format!("Another rate ({rate}%) is already recorded from that date. Correct that entry instead.")
            }));
        }
        let previous_rate = live.iter().filter(|(_, date, _)| *date < request.entry.effective_from).last().map(|(_, _, rate)| *rate);

        // The schedule, for a repriced Term Loan only.
        let applied_from = match &request.schedule {
            Some(replacement) => {
                if loan_kind != "TERM_LOAN" {
                    return Err(refused("An Overdraft's interest is not calculated; only its rate history is recorded."));
                }
                if loan.get::<Option<String>, _>("schedule_source").as_deref() == Some("LENDER_CSV") {
                    return Err(refused("This loan uses the lender's own schedule (CSV). FinWea does not reprice it - import the lender's revised schedule."));
                }
                replace_schedule(&mut tx, &request.loan_id, loan.get("principal_amount"), replacement).await?;
                Some(replacement.from_instalment)
            }
            None => None,
        };

        insert_entry(&mut tx, &request.loan_id, &request.entry, previous_rate, applied_from).await?;

        // The loan's current rate: the one in force today.
        let in_force = live_entries(&mut tx, &request.loan_id)
            .await?
            .into_iter()
            .filter(|(_, date, _)| date.as_str() <= today)
            .last()
            .map(|(_, _, rate)| rate);
        if let Some(rate) = in_force {
            sqlx::query("UPDATE loans SET interest_rate = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
                .bind(rate)
                .bind(&request.loan_id)
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
            let _ = tx.rollback().await;
            Err(error)
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

#[tauri::command]
pub async fn record_rate_change_atomic(app: AppHandle, request: RecordRateChangeRequest) -> Result<(), String> {
    let pool = sqlite_pool(&app).await?;

    run_record_on(&pool, &request, &local_today()).await.map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    const MIGRATION_054: &str = include_str!("../../src/core/database/migrations/054_loan_interest_rate_history.ts");
    const TODAY: &str = "2026-06-01";

    /// A synthetic Term Loan: 30,000 at 12% from 10/01/2026, three
    /// instalments, the first PAID. Foreign keys ON, as in the app.
    async fn pool_with(with_054: bool) -> Pool<Sqlite> {
        let pool = SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        sqlx::query("PRAGMA foreign_keys = ON").execute(&pool).await.unwrap();
        for statement in [
            "CREATE TABLE documents (id TEXT PRIMARY KEY)",
            r#"CREATE TABLE loans (
                id TEXT PRIMARY KEY, loan_kind TEXT NOT NULL DEFAULT 'TERM_LOAN', name TEXT NOT NULL,
                principal_amount REAL NOT NULL, interest_rate REAL NOT NULL, start_date TEXT NOT NULL,
                schedule_source TEXT, emi_amount REAL, tenure_months INTEGER, maturity_date TEXT,
                outstanding_principal REAL NOT NULL DEFAULT 0, outstanding_interest REAL NOT NULL DEFAULT 0,
                deleted_at TEXT, updated_at TEXT)"#,
            r#"CREATE TABLE loan_payment_schedule (
                id TEXT PRIMARY KEY, loan_id TEXT NOT NULL REFERENCES loans(id), installment_number INTEGER NOT NULL,
                due_date TEXT NOT NULL, principal_amount REAL NOT NULL, interest_amount REAL NOT NULL,
                total_amount REAL NOT NULL, outstanding_principal REAL NOT NULL, status TEXT NOT NULL,
                paid_date TEXT, paid_amount REAL, transaction_id TEXT, opening_principal REAL,
                settled_before_finwea INTEGER NOT NULL DEFAULT 0, created_at TEXT, updated_at TEXT)"#,
            r#"CREATE TABLE loan_schedule_payments (
                id TEXT PRIMARY KEY, loan_id TEXT NOT NULL, schedule_id TEXT NOT NULL REFERENCES loan_payment_schedule(id),
                transaction_id TEXT NOT NULL)"#,
            r#"INSERT INTO loans (id, name, principal_amount, interest_rate, start_date, schedule_source, emi_amount, tenure_months, maturity_date, outstanding_principal, outstanding_interest)
               VALUES ('loan-1', 'Synthetic Term Loan', 30000, 12, '2026-01-10', 'GENERATED', 10200, 3, '2026-04-10', 20100, 302.01)"#,
            r#"INSERT INTO loan_payment_schedule (id, loan_id, installment_number, due_date, principal_amount, interest_amount, total_amount, outstanding_principal, status, paid_date, paid_amount, transaction_id) VALUES
               ('s1', 'loan-1', 1, '2026-02-10', 9900, 300, 10200, 20100, 'PAID', '2026-02-10', 10200, 'txn-1'),
               ('s2', 'loan-1', 2, '2026-03-10', 9999, 201, 10200, 10101, 'UPCOMING', NULL, NULL, NULL),
               ('s3', 'loan-1', 3, '2026-04-10', 10101, 101.01, 10202.01, 0, 'UPCOMING', NULL, NULL, NULL)"#,
            "INSERT INTO loan_schedule_payments (id, loan_id, schedule_id, transaction_id) VALUES ('p1', 'loan-1', 's1', 'txn-1')",
        ] {
            sqlx::query(statement).execute(&pool).await.unwrap();
        }
        if with_054 {
            let start = MIGRATION_054.find("sql: `").unwrap() + "sql: `".len();
            let end = start + MIGRATION_054[start..].find('`').unwrap();
            for statement in MIGRATION_054[start..end].split(';').map(str::trim).filter(|s| !s.is_empty()) {
                sqlx::query(statement).execute(&pool).await.unwrap();
            }
        }
        pool
    }

    async fn pool() -> Pool<Sqlite> {
        pool_with(true).await
    }

    /// The app's snapshot of the loan, as the proposal is made.
    async fn snapshot(pool: &Pool<Sqlite>) -> ExpectedLoanState {
        let rate: f64 = sqlx::query_scalar("SELECT interest_rate FROM loans WHERE id = 'loan-1'").fetch_one(pool).await.unwrap();
        let live_history_ids: Vec<String> = sqlx::query_scalar("SELECT id FROM loan_interest_rate_history WHERE loan_id = 'loan-1' AND superseded_at IS NULL")
            .fetch_all(pool)
            .await
            .unwrap_or_default();
        let schedule = sqlx::query("SELECT * FROM loan_payment_schedule WHERE loan_id = 'loan-1' ORDER BY installment_number")
            .fetch_all(pool)
            .await
            .unwrap()
            .iter()
            .map(|r| ExpectedScheduleRow {
                id: r.get("id"),
                installment_number: r.get("installment_number"),
                due_date: r.get("due_date"),
                principal_amount: r.get("principal_amount"),
                interest_amount: r.get("interest_amount"),
                total_amount: r.get("total_amount"),
                outstanding_principal: r.get("outstanding_principal"),
                status: r.get("status"),
                transaction_id: r.get("transaction_id"),
                paid_amount: r.get("paid_amount"),
                settled_before_finwea: r.get::<i64, _>("settled_before_finwea") != 0,
            })
            .collect();
        ExpectedLoanState { interest_rate: rate, live_history_ids, schedule }
    }

    fn entry(id: &str, effective_from: &str, rate: f64, source: &str) -> NewRateEntry {
        NewRateEntry {
            id: id.to_string(),
            effective_from: effective_from.to_string(),
            rate,
            rate_type: Some("FLOATING".to_string()),
            source: source.to_string(),
            reference: Some("SYN-NOTICE-1".to_string()),
            document_id: None,
            notes: Some("Synthetic".to_string()),
            created_at: format!("{effective_from}T00:00:00Z"),
        }
    }

    fn initial() -> NewRateEntry {
        entry("rate-initial", "2026-01-10", 12.0, "INITIAL")
    }

    /// Instalments 2-3 re-priced at 15% from 15/02/2026 (synthetic figures that add up).
    fn repriced() -> ScheduleReplacement {
        ScheduleReplacement {
            from_instalment: 2,
            emi_amount: 10239.13,
            rows: vec![
                NewScheduleRow { id: "n2".into(), installment_number: 2, due_date: "2026-03-10".into(), principal_amount: 9986.87, interest_amount: 252.26, total_amount: 10239.13, outstanding_principal: 10113.13 },
                NewScheduleRow { id: "n3".into(), installment_number: 3, due_date: "2026-04-10".into(), principal_amount: 10113.13, interest_amount: 126.41, total_amount: 10239.54, outstanding_principal: 0.0 },
            ],
        }
    }

    async fn change_request(pool: &Pool<Sqlite>) -> RecordRateChangeRequest {
        RecordRateChangeRequest {
            loan_id: "loan-1".into(),
            expected: snapshot(pool).await,
            initial_entry: Some(initial()),
            entry: entry("rate-2", "2026-02-15", 15.0, "LENDER_NOTICE"),
            supersedes: None,
            schedule: Some(repriced()),
        }
    }

    type History = Vec<(String, String, f64, Option<f64>, String, Option<i64>, Option<String>, Option<String>)>;

    async fn history(pool: &Pool<Sqlite>) -> History {
        sqlx::query("SELECT id, effective_from, rate, previous_rate, source, applied_from_instalment, superseded_by, correction_reason FROM loan_interest_rate_history ORDER BY created_at, id")
            .fetch_all(pool)
            .await
            .unwrap()
            .iter()
            .map(|r| (r.get("id"), r.get("effective_from"), r.get("rate"), r.get("previous_rate"), r.get("source"), r.get("applied_from_instalment"), r.get("superseded_by"), r.get("correction_reason")))
            .collect()
    }

    async fn everything(pool: &Pool<Sqlite>) -> String {
        let mut out = String::new();
        for table in ["loans", "loan_payment_schedule", "loan_schedule_payments", "loan_interest_rate_history"] {
            let rows = sqlx::query(&format!("SELECT * FROM {table} ORDER BY 1")).fetch_all(pool).await.unwrap_or_default();
            for row in rows {
                let columns = row.len();
                let values: Vec<String> = (0..columns)
                    .map(|i| {
                        row.try_get::<Option<String>, _>(i)
                            .map(|v| format!("{v:?}"))
                            .or_else(|_| row.try_get::<Option<f64>, _>(i).map(|v| format!("{v:?}")))
                            .or_else(|_| row.try_get::<Option<i64>, _>(i).map(|v| format!("{v:?}")))
                            .unwrap_or_default()
                    })
                    .collect();
                out.push_str(&format!("{table}: {}\n", values.join("|")));
            }
        }
        out
    }

    async fn refusal(pool: &Pool<Sqlite>, request: &RecordRateChangeRequest) -> String {
        let before = everything(pool).await;
        let error = run_record_on(pool, request, TODAY).await.expect_err("refused").to_string();
        assert!(error.contains(REFUSED), "{error}");
        assert_eq!(everything(pool).await, before, "a refused change writes nothing");
        error
    }

    async fn loan_row(pool: &Pool<Sqlite>) -> (f64, Option<f64>, Option<i64>, Option<String>, f64) {
        let r = sqlx::query("SELECT interest_rate, emi_amount, tenure_months, maturity_date, outstanding_interest FROM loans WHERE id = 'loan-1'").fetch_one(pool).await.unwrap();
        (r.get("interest_rate"), r.get("emi_amount"), r.get("tenure_months"), r.get("maturity_date"), r.get("outstanding_interest"))
    }

    // ------------------------------------------------------------------

    #[tokio::test]
    async fn records_the_original_rate_then_the_change_and_reprices_only_future_instalments() {
        let pool = pool().await;
        let paid_before = sqlx::query("SELECT * FROM loan_payment_schedule WHERE id = 's1'").fetch_one(&pool).await.unwrap();
        let paid_before: (f64, f64, f64, String) = (paid_before.get("principal_amount"), paid_before.get("interest_amount"), paid_before.get("outstanding_principal"), paid_before.get("status"));

        run_record_on(&pool, &change_request(&pool).await, TODAY).await.expect("saved");

        assert_eq!(
            history(&pool).await,
            vec![
                ("rate-initial".into(), "2026-01-10".into(), 12.0, None, "INITIAL".into(), None, None, None),
                ("rate-2".into(), "2026-02-15".into(), 15.0, Some(12.0), "LENDER_NOTICE".into(), Some(2), None, None),
            ]
        );
        // The paid instalment is exactly as it was.
        let paid = sqlx::query("SELECT * FROM loan_payment_schedule WHERE id = 's1'").fetch_one(&pool).await.unwrap();
        assert_eq!((paid.get::<f64, _>("principal_amount"), paid.get::<f64, _>("interest_amount"), paid.get::<f64, _>("outstanding_principal"), paid.get::<String, _>("status")), paid_before);
        // Future rows replaced in place (ids kept), amounts as proposed.
        let future: Vec<(String, f64, f64)> = sqlx::query("SELECT id, interest_amount, outstanding_principal FROM loan_payment_schedule WHERE installment_number >= 2 ORDER BY installment_number")
            .fetch_all(&pool)
            .await
            .unwrap()
            .iter()
            .map(|r| (r.get("id"), r.get("interest_amount"), r.get("outstanding_principal")))
            .collect();
        assert_eq!(future, vec![("s2".into(), 252.26, 10113.13), ("s3".into(), 126.41, 0.0)]);
        // The loan: today's rate, the new EMI, outstanding interest moved by the difference only.
        assert_eq!(loan_row(&pool).await, (15.0, Some(10239.13), Some(3), Some("2026-04-10".into()), 378.67));
    }

    #[tokio::test]
    async fn a_future_dated_change_leaves_todays_rate_on_the_loan() {
        let pool = pool().await;
        let mut request = change_request(&pool).await;
        request.entry.effective_from = "2026-03-01".into();
        run_record_on(&pool, &request, "2026-02-20").await.expect("saved");

        assert_eq!(loan_row(&pool).await.0, 12.0);
    }

    #[tokio::test]
    async fn keeping_the_emi_can_add_or_remove_instalments_and_tenure_follows() {
        let pool = pool().await;
        let mut longer = change_request(&pool).await;
        longer.schedule = Some(ScheduleReplacement {
            from_instalment: 2,
            emi_amount: 10200.0,
            rows: vec![
                NewScheduleRow { id: "n2".into(), installment_number: 2, due_date: "2026-03-10".into(), principal_amount: 9947.74, interest_amount: 252.26, total_amount: 10200.0, outstanding_principal: 10152.26 },
                NewScheduleRow { id: "n3".into(), installment_number: 3, due_date: "2026-04-10".into(), principal_amount: 10073.36, interest_amount: 126.64, total_amount: 10200.0, outstanding_principal: 78.90 },
                NewScheduleRow { id: "n4".into(), installment_number: 4, due_date: "2026-05-10".into(), principal_amount: 78.90, interest_amount: 0.99, total_amount: 79.89, outstanding_principal: 0.0 },
            ],
        });
        run_record_on(&pool, &longer, TODAY).await.expect("saved");
        let (_, _, tenure, maturity, _) = loan_row(&pool).await;
        assert_eq!((tenure, maturity.as_deref()), (Some(4), Some("2026-05-10")));
        let added: String = sqlx::query_scalar("SELECT status FROM loan_payment_schedule WHERE id = 'n4'").fetch_one(&pool).await.unwrap();
        assert_eq!(added, "UPCOMING");

        let pool = self::pool().await;
        let mut shorter = change_request(&pool).await;
        shorter.entry.rate = 1.0;
        shorter.schedule = Some(ScheduleReplacement {
            from_instalment: 2,
            emi_amount: 10200.0,
            rows: vec![NewScheduleRow { id: "n2".into(), installment_number: 2, due_date: "2026-03-10".into(), principal_amount: 20100.0, interest_amount: 16.75, total_amount: 20116.75, outstanding_principal: 0.0 }],
        });
        run_record_on(&pool, &shorter, TODAY).await.expect("saved");
        let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM loan_payment_schedule").fetch_one(&pool).await.unwrap();
        assert_eq!(rows, 2);
        assert_eq!(loan_row(&pool).await.2, Some(2));
    }

    #[tokio::test]
    async fn a_stale_proposal_is_refused_and_nothing_is_written() {
        let pool = pool().await;

        let mut rate = change_request(&pool).await;
        rate.expected.interest_rate = 11.0;
        assert!(refusal(&pool, &rate).await.contains("has changed since"));

        let mut schedule = change_request(&pool).await;
        schedule.expected.schedule[1].interest_amount += 0.01;
        assert!(refusal(&pool, &schedule).await.contains("has changed since"));

        let mut status = change_request(&pool).await;
        status.expected.schedule[2].status = "PAID".into();
        assert!(refusal(&pool, &status).await.contains("has changed since"));

        let mut history = change_request(&pool).await;
        history.expected.live_history_ids = vec!["someone-else".into()];
        assert!(refusal(&pool, &history).await.contains("has changed since"));

        let mut rows = change_request(&pool).await;
        rows.expected.schedule.pop();
        assert!(refusal(&pool, &rows).await.contains("has changed since"));
    }

    #[tokio::test]
    async fn protected_instalments_are_never_replaced() {
        // A payment record, a linked transaction, a paid amount, a settled flag or a PAID/PARTIAL status on instalment 2.
        for change in [
            "INSERT INTO loan_schedule_payments (id, loan_id, schedule_id, transaction_id) VALUES ('p2', 'loan-1', 's2', 'txn-2')",
            "UPDATE loan_payment_schedule SET transaction_id = 'txn-2' WHERE id = 's2'",
            "UPDATE loan_payment_schedule SET paid_amount = 100 WHERE id = 's2'",
            "UPDATE loan_payment_schedule SET settled_before_finwea = 1 WHERE id = 's2'",
            "UPDATE loan_payment_schedule SET status = 'PARTIAL' WHERE id = 's2'",
            "UPDATE loan_payment_schedule SET status = 'PAID' WHERE id = 's2'",
        ] {
            let pool = pool().await;
            sqlx::query(change).execute(&pool).await.unwrap();
            let request = change_request(&pool).await;
            assert!(refusal(&pool, &request).await.contains("never changed"), "{change}");
        }
    }

    #[tokio::test]
    async fn a_revised_schedule_that_does_not_add_up_is_refused() {
        let pool = pool().await;
        let base = change_request(&pool).await;

        let mut not_zero = base.clone();
        not_zero.schedule.as_mut().unwrap().rows[1].principal_amount = 10000.0;
        not_zero.schedule.as_mut().unwrap().rows[1].total_amount = 10126.41;
        not_zero.schedule.as_mut().unwrap().rows[1].outstanding_principal = 113.13;
        assert!(refusal(&pool, &not_zero).await.contains("does not end at zero"));

        let mut split = base.clone();
        split.schedule.as_mut().unwrap().rows[0].total_amount = 1.0;
        assert!(refusal(&pool, &split).await.contains("does not add up"));

        let mut opening = base.clone();
        opening.schedule.as_mut().unwrap().from_instalment = 1;
        assert!(refusal(&pool, &opening).await.contains("never changed"));

        let mut order = base.clone();
        order.schedule.as_mut().unwrap().rows[1].due_date = "2026-03-01".into();
        assert!(refusal(&pool, &order).await.contains("out-of-order"));
    }

    #[tokio::test]
    async fn conflicting_or_duplicate_rates_on_one_date_are_refused() {
        let pool = pool().await;
        run_record_on(&pool, &change_request(&pool).await, TODAY).await.expect("saved");

        let mut same = change_request(&pool).await;
        same.initial_entry = None;
        same.entry.id = "rate-3".into();
        same.schedule = None;
        assert!(refusal(&pool, &same).await.contains("already recorded"));

        let mut other = same.clone();
        other.entry.rate = 16.0;
        assert!(refusal(&pool, &other).await.contains("Correct that entry instead"));
    }

    #[tokio::test]
    async fn the_original_rate_is_required_once_and_must_be_the_loans_own() {
        let pool = pool().await;

        let mut missing = change_request(&pool).await;
        missing.initial_entry = None;
        assert!(refusal(&pool, &missing).await.contains("original rate before"));

        let mut wrong_rate = change_request(&pool).await;
        wrong_rate.initial_entry.as_mut().unwrap().rate = 11.0;
        assert!(refusal(&pool, &wrong_rate).await.contains("loan's own rate"));

        let mut wrong_date = change_request(&pool).await;
        wrong_date.initial_entry.as_mut().unwrap().effective_from = "2026-01-11".into();
        assert!(refusal(&pool, &wrong_date).await.contains("loan's own rate"));

        run_record_on(&pool, &change_request(&pool).await, TODAY).await.expect("saved");
        let mut again = change_request(&pool).await;
        again.entry = entry("rate-3", "2026-03-15", 16.0, "MANUAL");
        again.schedule = None;
        assert!(refusal(&pool, &again).await.contains("not recorded again"));
    }

    #[tokio::test]
    async fn a_correction_supersedes_the_entry_with_its_reason_and_keeps_the_audit_trail() {
        let pool = pool().await;
        run_record_on(&pool, &change_request(&pool).await, TODAY).await.expect("saved");

        let correction = RecordRateChangeRequest {
            loan_id: "loan-1".into(),
            expected: snapshot(&pool).await,
            initial_entry: None,
            entry: entry("rate-2b", "2026-02-15", 14.0, "LENDER_NOTICE"),
            supersedes: Some(Supersession { id: "rate-2".into(), reason: "Synthetic typo: the notice says 14%".into() }),
            schedule: None,
        };
        run_record_on(&pool, &correction, TODAY).await.expect("corrected");

        let rows = history(&pool).await;
        assert_eq!(rows.len(), 3, "nothing is overwritten or deleted");
        let old = rows.iter().find(|r| r.0 == "rate-2").unwrap();
        assert_eq!((old.2, old.6.as_deref(), old.7.as_deref()), (15.0, Some("rate-2b"), Some("Synthetic typo: the notice says 14%")));
        let new = rows.iter().find(|r| r.0 == "rate-2b").unwrap();
        assert_eq!((new.2, new.3, new.6.as_deref()), (14.0, Some(12.0), None));
        assert_eq!(loan_row(&pool).await.0, 14.0);

        // A superseded entry cannot be corrected again; a reason is required.
        let mut twice = correction.clone();
        twice.expected = snapshot(&pool).await;
        twice.entry.id = "rate-2c".into();
        assert!(refusal(&pool, &twice).await.contains("already been corrected"));
        let mut no_reason = twice.clone();
        no_reason.supersedes = Some(Supersession { id: "rate-2b".into(), reason: "  ".into() });
        assert!(refusal(&pool, &no_reason).await.contains("reason"));
    }

    #[tokio::test]
    async fn the_original_rate_can_be_corrected_but_stays_the_original() {
        let pool = pool().await;
        run_record_on(&pool, &change_request(&pool).await, TODAY).await.expect("saved");

        let mut correction = RecordRateChangeRequest {
            loan_id: "loan-1".into(),
            expected: snapshot(&pool).await,
            initial_entry: None,
            entry: entry("rate-initial-b", "2026-01-10", 11.5, "MANUAL"),
            supersedes: Some(Supersession { id: "rate-initial".into(), reason: "Synthetic: sanction letter says 11.5%".into() }),
            schedule: None,
        };
        assert!(refusal(&pool, &correction).await.contains("not allowed"));

        correction.entry.source = "INITIAL".into();
        run_record_on(&pool, &correction, TODAY).await.expect("corrected");
        let initial = history(&pool).await.into_iter().find(|r| r.0 == "rate-initial-b").unwrap();
        assert_eq!((initial.2, initial.3, initial.4.as_str()), (11.5, None, "INITIAL"));
    }

    #[tokio::test]
    async fn a_lender_csv_schedule_is_never_repriced_but_its_rate_can_be_recorded() {
        let pool = pool().await;
        sqlx::query("UPDATE loans SET schedule_source = 'LENDER_CSV'").execute(&pool).await.unwrap();

        let request = change_request(&pool).await;
        assert!(refusal(&pool, &request).await.contains("import the lender's revised schedule"));

        let mut record_only = change_request(&pool).await;
        record_only.schedule = None;
        let schedule_before = everything(&pool).await.lines().filter(|l| l.starts_with("loan_payment_schedule")).map(String::from).collect::<Vec<_>>();
        run_record_on(&pool, &record_only, TODAY).await.expect("recorded");
        let schedule_after = everything(&pool).await.lines().filter(|l| l.starts_with("loan_payment_schedule")).map(String::from).collect::<Vec<_>>();
        assert_eq!(schedule_after, schedule_before);
        assert_eq!(loan_row(&pool).await.0, 15.0);
    }

    #[tokio::test]
    async fn an_overdraft_records_its_rate_history_only() {
        let pool = pool().await;
        sqlx::query("UPDATE loans SET loan_kind = 'OVERDRAFT'").execute(&pool).await.unwrap();

        let reprice = change_request(&pool).await;
        assert!(refusal(&pool, &reprice).await.contains("only its rate history is recorded"));

        let mut info = change_request(&pool).await;
        info.schedule = None;
        run_record_on(&pool, &info, TODAY).await.expect("recorded");
        assert_eq!(history(&pool).await.len(), 2);
        assert_eq!(loan_row(&pool).await, (15.0, Some(10200.0), Some(3), Some("2026-04-10".into()), 302.01));
    }

    #[tokio::test]
    async fn without_migration_054_nothing_can_be_recorded() {
        let pool = pool_with(false).await;
        let request = RecordRateChangeRequest {
            loan_id: "loan-1".into(),
            expected: ExpectedLoanState { interest_rate: 12.0, live_history_ids: vec![], schedule: vec![] },
            initial_entry: Some(initial()),
            entry: entry("rate-2", "2026-02-15", 15.0, "MANUAL"),
            supersedes: None,
            schedule: None,
        };
        let error = run_record_on(&pool, &request, TODAY).await.expect_err("refused").to_string();
        assert!(error.contains("migration 054"), "{error}");
    }

    #[tokio::test]
    async fn a_failure_at_the_very_end_rolls_back_the_history_rows_the_schedule_and_the_loan() {
        let pool = pool().await;
        // The last write (the loan's current rate) fails, after every other write.
        sqlx::query("CREATE TRIGGER fail_rate BEFORE UPDATE OF interest_rate ON loans BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END")
            .execute(&pool)
            .await
            .unwrap();
        let before = everything(&pool).await;

        let error = run_record_on(&pool, &change_request(&pool).await, TODAY).await.expect_err("fails").to_string();

        assert!(error.contains("simulated disk failure"), "{error}");
        assert_eq!(everything(&pool).await, before);

        // Nothing is left locked: the same change saves once the fault is gone.
        sqlx::query("DROP TRIGGER fail_rate").execute(&pool).await.unwrap();
        run_record_on(&pool, &change_request(&pool).await, TODAY).await.expect("saved");
        assert_eq!(history(&pool).await.len(), 2);
    }

    #[tokio::test]
    async fn invalid_entries_are_refused() {
        let pool = pool().await;
        for (field, value) in [("rate", "-1"), ("rate", "101"), ("date", "2026-02-30"), ("date", "15/02/2026"), ("date", "2026-01-01"), ("type", "VARIABLE"), ("source", "GUESS")] {
            let mut request = change_request(&pool).await;
            match field {
                "rate" => request.entry.rate = value.parse().unwrap(),
                "date" => request.entry.effective_from = value.into(),
                "type" => request.entry.rate_type = Some(value.into()),
                _ => request.entry.source = value.into(),
            }
            request.schedule = None;
            refusal(&pool, &request).await;
        }
    }

    // ---------------------------------------------------------- Stage 3.1

    fn record_only(expected: ExpectedLoanState, initial_entry: Option<NewRateEntry>, entry: NewRateEntry) -> RecordRateChangeRequest {
        RecordRateChangeRequest { loan_id: "loan-1".into(), expected, initial_entry, entry, supersedes: None, schedule: None }
    }

    async fn previous_rates(pool: &Pool<Sqlite>) -> Vec<(String, Option<f64>)> {
        let mut rows: Vec<(String, Option<f64>)> = history(pool).await.into_iter().map(|row| (row.0, row.3)).collect();
        rows.sort_by(|a, b| a.0.cmp(&b.0));
        rows
    }

    async fn schedule_rows(pool: &Pool<Sqlite>) -> String {
        everything(pool).await.lines().filter(|line| line.starts_with("loan_payment_schedule")).collect::<Vec<_>>().join("\n")
    }

    #[tokio::test]
    async fn upcoming_rates_stay_off_the_loan_until_their_date_then_the_next_save_catches_up() {
        let pool = pool().await;
        // Another loan with no history: never touched by any of this.
        sqlx::query("INSERT INTO loans (id, name, principal_amount, interest_rate, start_date) VALUES ('loan-2', 'Untouched', 5000, 9.5, '2025-06-01')")
            .execute(&pool)
            .await
            .unwrap();

        // Two upcoming changes recorded on 01/02/2026: neither is in force yet.
        run_record_on(&pool, &record_only(snapshot(&pool).await, Some(initial()), entry("rate-mar", "2026-03-01", 13.0, "LENDER_NOTICE")), "2026-02-01")
            .await
            .expect("saved");
        assert_eq!(loan_row(&pool).await.0, 12.0);
        run_record_on(&pool, &record_only(snapshot(&pool).await, None, entry("rate-may", "2026-05-01", 14.0, "LENDER_NOTICE")), "2026-02-01")
            .await
            .expect("saved");
        assert_eq!(loan_row(&pool).await.0, 12.0, "an upcoming rate is never the loan's rate before its date");

        // On 01/03/2026 the March rate is in force (its date is inclusive). The
        // stored snapshot still says 12% - it is what the stale check compares,
        // so a lagging snapshot never blocks a change - and this save updates it.
        assert_eq!(snapshot(&pool).await.interest_rate, 12.0);
        run_record_on(&pool, &record_only(snapshot(&pool).await, None, entry("rate-apr", "2026-04-01", 13.5, "MANUAL")), "2026-03-01")
            .await
            .expect("saved");
        assert_eq!(loan_row(&pool).await.0, 13.0);

        // After the last upcoming date, the next save moves the snapshot to it.
        run_record_on(&pool, &record_only(snapshot(&pool).await, None, entry("rate-jun", "2026-06-01", 14.5, "MANUAL")), "2026-05-20")
            .await
            .expect("saved");
        assert_eq!(loan_row(&pool).await.0, 14.0);

        // Each entry's stored previous rate: the live rate before its date when it was saved.
        assert_eq!(
            previous_rates(&pool).await,
            vec![
                ("rate-apr".into(), Some(13.0)),
                ("rate-initial".into(), None),
                ("rate-jun".into(), Some(14.0)),
                ("rate-mar".into(), Some(12.0)),
                ("rate-may".into(), Some(13.0)),
            ]
        );
        let untouched: (f64, i64) =
            sqlx::query_as("SELECT interest_rate, (SELECT COUNT(*) FROM loan_interest_rate_history WHERE loan_id = 'loan-2') FROM loans WHERE id = 'loan-2'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(untouched, (9.5, 0));
    }

    #[tokio::test]
    async fn an_overdrafts_upcoming_rate_is_recorded_only_and_left_off_the_loan() {
        let pool = pool().await;
        sqlx::query("UPDATE loans SET loan_kind = 'OVERDRAFT'").execute(&pool).await.unwrap();
        let before = schedule_rows(&pool).await;

        run_record_on(&pool, &record_only(snapshot(&pool).await, Some(initial()), entry("od-next", "2026-07-01", 11.0, "LENDER_NOTICE")), TODAY)
            .await
            .expect("recorded");

        assert_eq!(history(&pool).await.len(), 2);
        assert_eq!(loan_row(&pool).await, (12.0, Some(10200.0), Some(3), Some("2026-04-10".into()), 302.01));
        assert_eq!(schedule_rows(&pool).await, before);
    }

    // ---------------------------------------------------------- Stage 3.3

    /// One open loan window: change, change, correction - each prepared from
    /// a snapshot re-read after the previous save. A request prepared from
    /// any earlier snapshot is still refused, and writes nothing.
    #[tokio::test]
    async fn consecutive_changes_and_a_correction_each_from_a_fresh_snapshot() {
        let pool = pool().await;
        sqlx::query("UPDATE loans SET loan_kind = 'OVERDRAFT'").execute(&pool).await.unwrap();

        let first_snapshot = snapshot(&pool).await;
        run_record_on(&pool, &record_only(first_snapshot.clone(), Some(initial()), entry("od-a", "2026-03-01", 13.0, "LENDER_NOTICE")), TODAY)
            .await
            .expect("first change");

        // Prepared before the first save: refused, nothing written.
        let stale = record_only(first_snapshot, None, entry("od-stale", "2026-05-01", 14.0, "LENDER_NOTICE"));
        assert!(refusal(&pool, &stale).await.contains("has changed since"));

        let second_snapshot = snapshot(&pool).await;
        run_record_on(&pool, &record_only(second_snapshot.clone(), None, entry("od-b", "2026-05-01", 14.0, "LENDER_NOTICE")), TODAY)
            .await
            .expect("second change from a fresh snapshot");

        let mut stale_correction = record_only(second_snapshot, None, entry("od-b2", "2026-05-01", 13.5, "LENDER_NOTICE"));
        stale_correction.supersedes = Some(Supersession { id: "od-b".into(), reason: "Notice misread".into() });
        assert!(refusal(&pool, &stale_correction).await.contains("has changed since"));

        let mut correction = record_only(snapshot(&pool).await, None, entry("od-b2", "2026-05-01", 13.5, "LENDER_NOTICE"));
        correction.supersedes = Some(Supersession { id: "od-b".into(), reason: "Notice misread".into() });
        run_record_on(&pool, &correction, TODAY).await.expect("correction from a fresh snapshot");

        assert_eq!(
            previous_rates(&pool).await,
            vec![("od-a".into(), Some(12.0)), ("od-b".into(), Some(13.0)), ("od-b2".into(), Some(13.0)), ("rate-initial".into(), None)]
        );
        let superseded: Vec<(String, Option<String>)> = history(&pool).await.into_iter().filter(|row| row.6.is_some()).map(|row| (row.0, row.7)).collect();
        assert_eq!(superseded, vec![("od-b".into(), Some("Notice misread".into()))]);
        assert_eq!(loan_row(&pool).await.0, 13.5);
    }

    fn replace_recorded_rate(expected: ExpectedLoanState, reason: &str) -> RecordRateChangeRequest {
        RecordRateChangeRequest {
            loan_id: "loan-1".into(),
            expected,
            initial_entry: Some(initial()),
            entry: entry("rate-2", "2026-01-10", 11.0, "INITIAL"),
            supersedes: Some(Supersession { id: "rate-initial".into(), reason: reason.into() }),
            schedule: None,
        }
    }

    #[tokio::test]
    async fn a_first_change_from_the_start_date_keeps_the_recorded_rate_as_a_superseded_baseline() {
        let pool = pool().await;

        // No reason: refused after the baseline was written in the transaction - nothing is left behind.
        assert!(refusal(&pool, &replace_recorded_rate(snapshot(&pool).await, "  ")).await.contains("reason"));
        assert!(history(&pool).await.is_empty());

        run_record_on(&pool, &replace_recorded_rate(snapshot(&pool).await, "Sanction letter says 11%"), TODAY)
            .await
            .expect("saved");

        assert_eq!(
            history(&pool).await,
            vec![
                ("rate-2".into(), "2026-01-10".into(), 11.0, None, "INITIAL".into(), None, None, None),
                (
                    "rate-initial".into(),
                    "2026-01-10".into(),
                    12.0,
                    None,
                    "INITIAL".into(),
                    None,
                    Some("rate-2".into()),
                    Some("Sanction letter says 11%".into())
                ),
            ]
        );
        assert_eq!(loan_row(&pool).await.0, 11.0);
    }

    #[tokio::test]
    async fn a_failure_after_the_baseline_rolls_it_back_and_the_loan_keeps_no_history() {
        let pool = pool().await;
        sqlx::query(
            "CREATE TRIGGER fail_change BEFORE INSERT ON loan_interest_rate_history WHEN NEW.id = 'rate-2' BEGIN SELECT RAISE(ABORT, 'simulated failure on the change'); END",
        )
        .execute(&pool)
        .await
        .unwrap();
        let before = everything(&pool).await;

        let error = run_record_on(&pool, &change_request(&pool).await, TODAY).await.expect_err("fails").to_string();

        assert!(error.contains("simulated failure on the change"), "{error}");
        assert_eq!(everything(&pool).await, before, "no INITIAL row, no schedule change, the same rate");
        assert!(history(&pool).await.is_empty());
    }

    #[tokio::test]
    async fn a_history_of_only_superseded_rows_has_no_safe_baseline() {
        let pool = pool().await;
        sqlx::query("PRAGMA foreign_keys = OFF").execute(&pool).await.unwrap();
        sqlx::query(
            r#"INSERT INTO loan_interest_rate_history (id, loan_id, effective_from, rate, source, created_at, superseded_by, superseded_at, correction_reason) VALUES
               ('old-a', 'loan-1', '2026-01-10', 12, 'INITIAL', '2026-01-10', 'old-b', '2026-01-11', 'Synthetic'),
               ('old-b', 'loan-1', '2026-01-10', 12.5, 'INITIAL', '2026-01-11', 'old-a', '2026-01-12', 'Synthetic')"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("PRAGMA foreign_keys = ON").execute(&pool).await.unwrap();

        let mut request = change_request(&pool).await;
        request.schedule = None;
        assert!(refusal(&pool, &request).await.contains("ambiguous"));
        request.initial_entry = None;
        assert!(refusal(&pool, &request).await.contains("ambiguous"));
    }
}
