// ---------------------------------------------------------------------
// Overdraft edit - atomic, single-connection transaction.
//
// Editing an Overdraft writes its own loan row AND replaces its set of
// linked bank accounts (overdraft_accounts, migration 048) - several
// statements, so they run inside one `sqlx::Transaction` for exactly the
// reason given in loan_create.rs: `@tauri-apps/plugin-sql` runs every
// TypeScript execute() on whichever pooled connection is free, so a JS
// BEGIN/COMMIT cannot hold them together.
//
// Refused, with nothing written:
//   - the loan is not a live Overdraft;
//   - no linked account is given;
//   - an account would be removed while a transaction on it is still
//     linked to this OD (it would silently stop counting) - the user
//     unlinks those transactions first.
//   - a Dropline Overdraft's steps (migration 053) would be invalid:
//     none, a repeated or malformed date, a negative amount, or one above
//     the sanctioned limit - including a limit lowered below a kept step.
// Never touches a transaction, a transaction link, or any Term Loan.
// ---------------------------------------------------------------------

use serde::Deserialize;
use sqlx::{Pool, Row, Sqlite, Transaction};
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::loan_setup::NewDrawingPowerStep;

const DB_KEY: &str = "sqlite:financeos.db";

/// The prefix of a refusal - the rest of the message is for the user.
const REFUSED: &str = "OVERDRAFT_UPDATE_REFUSED: ";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateOverdraftAtomicRequest {
    pub loan_id: String,
    pub name: String,
    /// The lender's own account number (migration 050) - None clears it.
    #[serde(default)]
    pub loan_account_number: Option<String>,
    pub lender_institution_id: Option<String>,
    pub currency_id: String,
    pub interest_rate: f64,
    pub start_date: String,
    pub status: String,
    pub notes: Option<String>,
    pub credit_limit: f64,
    pub opening_used: f64,
    pub opening_used_as_of: String,
    pub account_ids: Vec<String>,
    /// Drawing power revision (migration 051). Only written when
    /// `update_drawing_power` is true, so an older caller never touches it;
    /// None with the flag set clears it (the limit applies again).
    #[serde(default)]
    pub update_drawing_power: bool,
    #[serde(default)]
    pub drawing_power: Option<f64>,
    /// Replace a Dropline Overdraft's dated drawing-power steps (migration
    /// 053) with `drawing_power_schedule`. Only when true - an older
    /// caller never touches the steps.
    #[serde(default)]
    pub update_drawing_power_schedule: bool,
    #[serde(default)]
    pub drawing_power_schedule: Vec<NewDrawingPowerStep>,
}

/// Float noise only - never a rounding allowance.
const MONEY_EPSILON: f64 = 0.005;

/// YYYY-MM-DD with a plausible month and day - the form the steps are stored in.
pub(crate) fn is_iso_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    let shaped = bytes.len() == 10
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            4 | 7 => *byte == b'-',
            _ => byte.is_ascii_digit(),
        });

    shaped
        && matches!(
            (value[5..7].parse::<u32>(), value[8..10].parse::<u32>()),
            (Ok(month), Ok(day)) if (1..=12).contains(&month) && (1..=31).contains(&day)
        )
}

fn drawing_power_schedule_refusal(steps: &[NewDrawingPowerStep], credit_limit: f64) -> Option<String> {
    if steps.is_empty() {
        return Some("A Dropline Overdraft needs at least one drawing-power step.".to_string());
    }

    let mut seen = std::collections::HashSet::new();

    for (index, step) in steps.iter().enumerate() {
        let at = format!("Step {}", index + 1);

        if !is_iso_date(&step.effective_date) {
            return Some(format!("{at}: enter the date it takes effect."));
        }

        if !seen.insert(step.effective_date.as_str()) {
            return Some(format!("{at}: two steps cannot take effect on the same date."));
        }

        if !step.drawing_power.is_finite() || step.drawing_power < 0.0 {
            return Some(format!("{at}: drawing power cannot be negative."));
        }

        if step.drawing_power > credit_limit + MONEY_EPSILON {
            return Some(format!("{at}: drawing power cannot be more than the sanctioned limit."));
        }
    }

    None
}

/// The Dropline rules of one edit, inside its transaction: replace the
/// steps when asked, and otherwise keep every saved step within the
/// (possibly lowered) limit.
async fn apply_drawing_power_schedule(
    tx: &mut Transaction<'_, Sqlite>,
    request: &UpdateOverdraftAtomicRequest,
) -> Result<(), UpdateError> {
    // The table exists only once migration 053 is applied.
    let has_table = sqlx::query(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'loan_drawing_power_schedule'",
    )
    .fetch_optional(&mut **tx)
    .await?
    .is_some();

    let saved_steps: i64 = if has_table {
        sqlx::query("SELECT COUNT(*) AS n FROM loan_drawing_power_schedule WHERE loan_id = ?")
            .bind(&request.loan_id)
            .fetch_one(&mut **tx)
            .await?
            .get("n")
    } else {
        0
    };
    let is_dropline = saved_steps > 0;

    if is_dropline && request.update_drawing_power && request.drawing_power.is_some() {
        return Err(UpdateError::Refused(
            "This is a Dropline Overdraft: its drawing power follows its dated steps. Change the steps, not a single drawing power.".to_string(),
        ));
    }

    if request.update_drawing_power_schedule {
        if !has_table {
            return Err(UpdateError::Refused(
                "Drawing-power steps need database update 053, which has not been applied.".to_string(),
            ));
        }

        // Steps are added when a Dropline is created; an edit never turns
        // a plain overdraft into one behind the user's back.
        if !is_dropline {
            return Err(UpdateError::Refused(
                "Only a Dropline Overdraft's drawing-power steps can be edited, and this overdraft has none.".to_string(),
            ));
        }

        if let Some(message) = drawing_power_schedule_refusal(&request.drawing_power_schedule, request.credit_limit) {
            return Err(UpdateError::Refused(message));
        }

        sqlx::query("DELETE FROM loan_drawing_power_schedule WHERE loan_id = ?")
            .bind(&request.loan_id)
            .execute(&mut **tx)
            .await?;

        for step in &request.drawing_power_schedule {
            sqlx::query(
                "INSERT INTO loan_drawing_power_schedule (id, loan_id, effective_date, drawing_power) VALUES (?, ?, ?, ?)",
            )
            .bind(&step.id)
            .bind(&request.loan_id)
            .bind(&step.effective_date)
            .bind(step.drawing_power)
            .execute(&mut **tx)
            .await?;
        }
    } else if is_dropline {
        let above: i64 = sqlx::query(
            "SELECT COUNT(*) AS n FROM loan_drawing_power_schedule WHERE loan_id = ? AND drawing_power > ?",
        )
        .bind(&request.loan_id)
        .bind(request.credit_limit + MONEY_EPSILON)
        .fetch_one(&mut **tx)
        .await?
        .get("n");

        if above > 0 {
            return Err(UpdateError::Refused(format!(
                "{above} drawing-power step(s) are above the new sanctioned limit. Lower those steps as well."
            )));
        }
    }

    Ok(())
}

#[derive(Debug)]
enum UpdateError {
    Refused(String),
    Database(sqlx::Error),
}

impl From<sqlx::Error> for UpdateError {
    fn from(error: sqlx::Error) -> Self {
        UpdateError::Database(error)
    }
}

impl std::fmt::Display for UpdateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UpdateError::Refused(message) => write!(f, "{REFUSED}{message}"),
            UpdateError::Database(error) => write!(f, "{error}"),
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

async fn run_update(
    pool: &Pool<Sqlite>,
    request: &UpdateOverdraftAtomicRequest,
) -> Result<(), UpdateError> {
    if request.account_ids.is_empty() {
        return Err(UpdateError::Refused(
            "Choose at least one bank account for this overdraft.".to_string(),
        ));
    }

    let account_ids = serde_json::to_string(&request.account_ids)
        .map_err(|error| UpdateError::Refused(error.to_string()))?;

    let mut tx = pool.begin().await?;

    let outcome: Result<(), UpdateError> = async {
        // Transactions linked to this OD that sit on an account being removed.
        let stranded: i64 = sqlx::query(
            r#"
            SELECT COUNT(*) AS n
            FROM overdraft_transaction_links AS link
            JOIN transactions AS txn ON txn.id = link.transaction_id
            WHERE link.loan_id = ?
              AND txn.deleted_at IS NULL
              AND txn.account_id IN (SELECT account_id FROM overdraft_accounts WHERE loan_id = ?)
              AND txn.account_id NOT IN (SELECT value FROM json_each(?))
            "#,
        )
        .bind(&request.loan_id)
        .bind(&request.loan_id)
        .bind(&account_ids)
        .fetch_one(&mut *tx)
        .await?
        .get("n");

        if stranded > 0 {
            return Err(UpdateError::Refused(format!(
                "{stranded} linked transaction(s) are on a bank account you are removing from this overdraft. Unlink them first, then remove the account."
            )));
        }

        // The first account stays in loans.account_id for older code that
        // reads one account; the OD itself uses overdraft_accounts only.
        let updated = sqlx::query(
            r#"
            UPDATE loans
            SET
                account_id = ?,
                name = ?,
                loan_account_number = ?,
                lender_institution_id = ?,
                currency_id = ?,
                interest_rate = ?,
                start_date = ?,
                status = ?,
                notes = ?,
                credit_limit = ?,
                opening_used = ?,
                opening_used_as_of = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND loan_kind = 'OVERDRAFT'
              AND deleted_at IS NULL
            "#,
        )
        .bind(&request.account_ids[0])
        .bind(&request.name)
        .bind(&request.loan_account_number)
        .bind(&request.lender_institution_id)
        .bind(&request.currency_id)
        .bind(request.interest_rate)
        .bind(&request.start_date)
        .bind(&request.status)
        .bind(&request.notes)
        .bind(request.credit_limit)
        .bind(request.opening_used)
        .bind(&request.opening_used_as_of)
        .bind(&request.loan_id)
        .execute(&mut *tx)
        .await?;

        if updated.rows_affected() != 1 {
            return Err(UpdateError::Refused(
                "This overdraft was not found.".to_string(),
            ));
        }

        apply_drawing_power_schedule(&mut tx, request).await?;

        if request.update_drawing_power {
            if let Some(drawing_power) = request.drawing_power {
                if !(drawing_power >= 0.0) {
                    return Err(UpdateError::Refused(
                        "Drawing power cannot be negative.".to_string(),
                    ));
                }

                if drawing_power > request.credit_limit {
                    return Err(UpdateError::Refused(
                        "Drawing power cannot be more than the sanctioned limit.".to_string(),
                    ));
                }
            }

            sqlx::query("UPDATE loans SET drawing_power = ? WHERE id = ?")
                .bind(request.drawing_power)
                .bind(&request.loan_id)
                .execute(&mut *tx)
                .await?;
        }

        sqlx::query(
            r#"
            DELETE FROM overdraft_accounts
            WHERE loan_id = ?
              AND account_id NOT IN (SELECT value FROM json_each(?))
            "#,
        )
        .bind(&request.loan_id)
        .bind(&account_ids)
        .execute(&mut *tx)
        .await?;

        for account_id in &request.account_ids {
            sqlx::query(
                r#"
                INSERT OR IGNORE INTO overdraft_accounts (id, loan_id, account_id)
                VALUES (lower(hex(randomblob(16))), ?, ?)
                "#,
            )
            .bind(&request.loan_id)
            .bind(account_id)
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

/// Updates an Overdraft's terms and its linked bank accounts in one real
/// database transaction - all or nothing.
#[tauri::command]
pub async fn update_overdraft_atomic(
    app: AppHandle,
    request: UpdateOverdraftAtomicRequest,
) -> Result<(), String> {
    let pool = sqlite_pool(&app).await?;

    run_update(&pool, &request)
        .await
        .map_err(|error| error.to_string())
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

        sqlx::query(
            r#"
            CREATE TABLE loans (
                id TEXT PRIMARY KEY,
                account_id TEXT,
                lender_institution_id TEXT,
                loan_kind TEXT NOT NULL DEFAULT 'TERM_LOAN',
                name TEXT NOT NULL,
                loan_account_number TEXT,
                currency_id TEXT NOT NULL,
                interest_rate REAL NOT NULL DEFAULT 0,
                start_date TEXT NOT NULL,
                status TEXT NOT NULL,
                notes TEXT,
                credit_limit REAL,
                opening_used REAL,
                opening_used_as_of TEXT,
                updated_at TEXT,
                deleted_at TEXT
            );
            CREATE TABLE transactions (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                deleted_at TEXT
            );
            CREATE TABLE overdraft_accounts (
                id TEXT PRIMARY KEY,
                loan_id TEXT NOT NULL,
                account_id TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (loan_id, account_id)
            );
            CREATE TABLE overdraft_transaction_links (
                id TEXT PRIMARY KEY,
                loan_id TEXT NOT NULL,
                transaction_id TEXT NOT NULL UNIQUE,
                entry_kind TEXT NOT NULL
            );
            INSERT INTO loans (id, account_id, loan_kind, name, currency_id, start_date, status, credit_limit, opening_used, opening_used_as_of)
            VALUES ('od-1', 'acct-a', 'OVERDRAFT', 'TATA OD', 'cur-inr', '2026-01-31', 'ACTIVE', 100, 0, '2026-10-08');
            INSERT INTO loans (id, account_id, name, currency_id, start_date, status)
            VALUES ('term-1', 'acct-a', 'Term', 'cur-inr', '2026-01-31', 'ACTIVE');
            INSERT INTO overdraft_accounts (id, loan_id, account_id) VALUES ('oa-1', 'od-1', 'acct-a');
            "#,
        )
        .execute(&pool)
        .await
        .expect("create focused test schema");

        pool
    }

    fn request(account_ids: &[&str]) -> UpdateOverdraftAtomicRequest {
        UpdateOverdraftAtomicRequest {
            loan_id: "od-1".to_string(),
            name: "TATA Capital".to_string(),
            loan_account_number: Some("0099000123".to_string()),
            lender_institution_id: None,
            currency_id: "cur-inr".to_string(),
            interest_rate: 10.5,
            start_date: "2026-01-31".to_string(),
            status: "ACTIVE".to_string(),
            notes: None,
            credit_limit: 12_500_000.0,
            opening_used: 0.0,
            opening_used_as_of: "2026-01-31".to_string(),
            account_ids: account_ids.iter().map(|id| id.to_string()).collect(),
            update_drawing_power: false,
            drawing_power: None,
            update_drawing_power_schedule: false,
            drawing_power_schedule: vec![],
        }
    }

    async fn drawing_power(pool: &Pool<Sqlite>) -> Option<f64> {
        sqlx::query("SELECT drawing_power FROM loans WHERE id = 'od-1'")
            .fetch_one(pool)
            .await
            .unwrap()
            .get("drawing_power")
    }

    #[tokio::test]
    async fn revises_drawing_power_only_when_asked_and_refuses_above_the_limit() {
        let pool = test_pool().await;
        sqlx::query("ALTER TABLE loans ADD COLUMN drawing_power REAL")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE loans SET drawing_power = 9000000 WHERE id = 'od-1'")
            .execute(&pool)
            .await
            .unwrap();

        // An older caller (no flag) never touches it.
        run_update(&pool, &request(&["acct-a"])).await.expect("update succeeds");
        assert_eq!(drawing_power(&pool).await, Some(9_000_000.0));

        let mut revise = request(&["acct-a"]);
        revise.update_drawing_power = true;
        revise.drawing_power = Some(12_000_000.0);
        run_update(&pool, &revise).await.expect("revision succeeds");
        assert_eq!(drawing_power(&pool).await, Some(12_000_000.0));

        let mut too_high = request(&["acct-a"]);
        too_high.update_drawing_power = true;
        too_high.drawing_power = Some(12_500_001.0);
        let error = run_update(&pool, &too_high).await.expect_err("refused").to_string();
        assert!(error.contains("more than the sanctioned limit"), "{error}");
        assert_eq!(drawing_power(&pool).await, Some(12_000_000.0), "the refused revision rolled back");

        let mut clear = request(&["acct-a"]);
        clear.update_drawing_power = true;
        run_update(&pool, &clear).await.expect("clearing succeeds");
        assert_eq!(drawing_power(&pool).await, None);
    }

    async fn accounts(pool: &Pool<Sqlite>) -> Vec<String> {
        sqlx::query("SELECT account_id FROM overdraft_accounts WHERE loan_id = 'od-1' ORDER BY account_id")
            .fetch_all(pool)
            .await
            .unwrap()
            .iter()
            .map(|row| row.get::<String, _>("account_id"))
            .collect()
    }

    #[tokio::test]
    async fn adds_a_second_account_and_updates_the_terms_together() {
        let pool = test_pool().await;

        run_update(&pool, &request(&["acct-a", "acct-b"]))
            .await
            .expect("update succeeds");

        assert_eq!(accounts(&pool).await, vec!["acct-a", "acct-b"]);
        let loan = sqlx::query("SELECT credit_limit, opening_used_as_of, account_id, loan_account_number FROM loans WHERE id = 'od-1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(loan.get::<f64, _>("credit_limit"), 12_500_000.0);
        assert_eq!(loan.get::<String, _>("opening_used_as_of"), "2026-01-31");
        assert_eq!(loan.get::<String, _>("account_id"), "acct-a");
        assert_eq!(
            loan.get::<Option<String>, _>("loan_account_number").as_deref(),
            Some("0099000123")
        );
    }

    #[tokio::test]
    async fn removes_an_account_with_no_linked_transactions() {
        let pool = test_pool().await;
        run_update(&pool, &request(&["acct-a", "acct-b"])).await.unwrap();

        run_update(&pool, &request(&["acct-b"])).await.expect("update succeeds");

        assert_eq!(accounts(&pool).await, vec!["acct-b"]);
    }

    #[tokio::test]
    async fn refuses_to_remove_an_account_with_linked_transactions_and_writes_nothing() {
        let pool = test_pool().await;
        sqlx::query(
            "INSERT INTO transactions (id, account_id) VALUES ('t1', 'acct-a');
             INSERT INTO overdraft_transaction_links (id, loan_id, transaction_id, entry_kind) VALUES ('l1', 'od-1', 't1', 'DRAWDOWN');",
        )
        .execute(&pool)
        .await
        .unwrap();

        let error = run_update(&pool, &request(&["acct-b"])).await.unwrap_err().to_string();

        assert!(error.starts_with(REFUSED), "{error}");
        assert_eq!(accounts(&pool).await, vec!["acct-a"]);
        let limit: Option<f64> = sqlx::query("SELECT credit_limit FROM loans WHERE id = 'od-1'")
            .fetch_one(&pool)
            .await
            .unwrap()
            .get("credit_limit");
        assert_eq!(limit, Some(100.0));
    }

    #[tokio::test]
    async fn refuses_no_accounts_and_never_touches_a_term_loan() {
        let pool = test_pool().await;

        assert!(run_update(&pool, &request(&[])).await.is_err());

        let mut term = request(&["acct-b"]);
        term.loan_id = "term-1".to_string();
        let error = run_update(&pool, &term).await.unwrap_err().to_string();
        assert!(error.contains("not found"), "{error}");

        let count: i64 = sqlx::query("SELECT COUNT(*) AS n FROM overdraft_accounts WHERE loan_id = 'term-1'")
            .fetch_one(&pool)
            .await
            .unwrap()
            .get("n");
        assert_eq!(count, 0);
    }
    // ------------------------------------------- Dropline (migration 053)

    /// The migration's table, created only by these tests - exactly as
    /// 053 defines it - with the overdraft made a Dropline by two steps.
    async fn with_dropline_steps(pool: &Pool<Sqlite>) {
        sqlx::query(
            r#"
            ALTER TABLE loans ADD COLUMN drawing_power REAL;
            CREATE TABLE loan_drawing_power_schedule (
                id TEXT PRIMARY KEY,
                loan_id TEXT NOT NULL,
                effective_date TEXT NOT NULL,
                drawing_power REAL NOT NULL CHECK (drawing_power >= 0),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (loan_id, effective_date),
                FOREIGN KEY (loan_id) REFERENCES loans(id)
            );
            INSERT INTO loan_drawing_power_schedule (id, loan_id, effective_date, drawing_power)
            VALUES ('s1', 'od-1', '2026-01-31', 12000000), ('s2', 'od-1', '2026-07-31', 10000000);
            "#,
        )
        .execute(pool)
        .await
        .expect("add the dropline table");
    }

    fn step(id: &str, date: &str, amount: f64) -> NewDrawingPowerStep {
        NewDrawingPowerStep { id: id.to_string(), effective_date: date.to_string(), drawing_power: amount }
    }

    async fn steps(pool: &Pool<Sqlite>) -> Vec<(String, f64)> {
        sqlx::query("SELECT effective_date, drawing_power FROM loan_drawing_power_schedule WHERE loan_id = 'od-1' ORDER BY effective_date")
            .fetch_all(pool)
            .await
            .unwrap()
            .iter()
            .map(|row| (row.get("effective_date"), row.get("drawing_power")))
            .collect()
    }

    async fn loan_name(pool: &Pool<Sqlite>) -> String {
        sqlx::query("SELECT name FROM loans WHERE id = 'od-1'").fetch_one(pool).await.unwrap().get("name")
    }

    fn schedule_request(new_steps: Vec<NewDrawingPowerStep>) -> UpdateOverdraftAtomicRequest {
        let mut request = request(&["acct-a"]);
        request.name = "Renamed".to_string();
        request.update_drawing_power = true;
        request.drawing_power = None;
        request.update_drawing_power_schedule = true;
        request.drawing_power_schedule = new_steps;
        request
    }

    #[tokio::test]
    async fn replaces_a_droplines_steps_together_with_its_terms() {
        let pool = test_pool().await;
        with_dropline_steps(&pool).await;

        run_update(&pool, &schedule_request(vec![
            step("n1", "2026-01-31", 12_000_000.0),
            step("n2", "2026-04-30", 11_000_000.0),
            step("n3", "2026-10-31", 8_000_000.0),
        ]))
        .await
        .expect("update succeeds");

        assert_eq!(
            steps(&pool).await,
            vec![
                ("2026-01-31".to_string(), 12_000_000.0),
                ("2026-04-30".to_string(), 11_000_000.0),
                ("2026-10-31".to_string(), 8_000_000.0),
            ]
        );
        assert_eq!(loan_name(&pool).await, "Renamed");
    }

    #[tokio::test]
    async fn refuses_invalid_steps_and_writes_nothing() {
        let pool = test_pool().await;
        with_dropline_steps(&pool).await;
        let before = steps(&pool).await;

        let cases = [
            (vec![], "at least one"),
            (vec![step("n1", "2026-04-30", 1.0), step("n2", "2026-04-30", 2.0)], "same date"),
            (vec![step("n1", "2026-13-01", 1.0)], "date it takes effect"),
            (vec![step("n1", "30-04-2026", 1.0)], "date it takes effect"),
            (vec![step("n1", "2026-04-30", -1.0)], "negative"),
            (vec![step("n1", "2026-04-30", 12_500_001.0)], "more than the sanctioned limit"),
        ];

        for (new_steps, expected) in cases {
            let error = run_update(&pool, &schedule_request(new_steps)).await.expect_err("refused").to_string();
            assert!(error.starts_with(REFUSED) && error.contains(expected), "{error}");
            assert_eq!(steps(&pool).await, before);
            assert_eq!(loan_name(&pool).await, "TATA OD", "the terms roll back too");
        }
    }

    #[tokio::test]
    async fn refuses_a_limit_lowered_below_a_kept_step() {
        let pool = test_pool().await;
        with_dropline_steps(&pool).await;

        let mut lowered = request(&["acct-a"]);
        lowered.credit_limit = 11_500_000.0;

        let error = run_update(&pool, &lowered).await.expect_err("refused").to_string();
        assert!(error.contains("1 drawing-power step(s) are above the new sanctioned limit"), "{error}");
        assert_eq!(loan_name(&pool).await, "TATA OD");

        // Lowering the limit and the step together is fine.
        let mut both = schedule_request(vec![step("n1", "2026-01-31", 11_500_000.0), step("n2", "2026-07-31", 10_000_000.0)]);
        both.credit_limit = 11_500_000.0;
        run_update(&pool, &both).await.expect("limit and steps lowered together");
    }

    #[tokio::test]
    async fn a_dropline_never_takes_a_single_drawing_power() {
        let pool = test_pool().await;
        with_dropline_steps(&pool).await;

        let mut single = request(&["acct-a"]);
        single.update_drawing_power = true;
        single.drawing_power = Some(1_000_000.0);

        let error = run_update(&pool, &single).await.expect_err("refused").to_string();
        assert!(error.contains("follows its dated steps"), "{error}");
        assert_eq!(steps(&pool).await.len(), 2);
    }

    #[tokio::test]
    async fn a_plain_overdraft_is_never_turned_into_a_dropline_by_an_edit() {
        let pool = test_pool().await;
        with_dropline_steps(&pool).await;
        sqlx::query("DELETE FROM loan_drawing_power_schedule").execute(&pool).await.unwrap();

        let error = run_update(&pool, &schedule_request(vec![step("n1", "2026-04-30", 1.0)]))
            .await
            .expect_err("refused")
            .to_string();
        assert!(error.contains("has none"), "{error}");
        assert!(steps(&pool).await.is_empty());
    }

    #[tokio::test]
    async fn without_migration_053_steps_are_refused_and_ordinary_edits_still_work() {
        let pool = test_pool().await;

        let error = run_update(&pool, &schedule_request(vec![step("n1", "2026-04-30", 1.0)]))
            .await
            .expect_err("refused")
            .to_string();
        assert!(error.contains("database update 053"), "{error}");

        run_update(&pool, &request(&["acct-a"])).await.expect("a plain edit needs no new table");
    }
}
