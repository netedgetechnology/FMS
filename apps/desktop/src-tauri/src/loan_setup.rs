// ---------------------------------------------------------------------
// Add Loan setup records (migration 051), written by create_loan_atomic
// in the SAME database transaction as the loan, its mirror account and
// its schedule - a partial failure can never leave a half-created loan.
//
// Accounting rules enforced here, at the last moment before commit:
//   - Nothing here ever creates a bank transaction. A disbursement or an
//     initial expense may only POINT AT an existing, live transaction.
//   - That transaction must be on the stated account, move money the
//     right way (a disbursement is money IN, a separately paid expense is
//     money OUT) and carry exactly the stated amount - no tolerance.
//   - A transaction already used by an Overdraft link, an EMI payment, a
//     disbursement or an expense is refused, so one bank movement is never
//     counted twice. (The partial UNIQUE indexes of migration 051 are a
//     second line of defence for the two new tables.)
// Any refusal returns an error, so create_loan_atomic rolls back the whole
// loan: nothing at all is written.
// ---------------------------------------------------------------------

use serde::Deserialize;
use sqlx::{Row, Sqlite, Transaction};

/// Prefix of a refusal the UI shows as-is (plain language, no SQL).
pub const REFUSED: &str = "LOAN_SETUP_REFUSED: ";

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoanSetupDetails {
    #[serde(default)]
    pub loan_purpose: Option<String>,
    #[serde(default)]
    pub rate_type: Option<String>,
    #[serde(default)]
    pub interest_calculation_method: Option<String>,
    #[serde(default)]
    pub sanction_date: Option<String>,
    #[serde(default)]
    pub sanctioned_amount: Option<f64>,
    #[serde(default)]
    pub first_emi_date: Option<String>,
    #[serde(default)]
    pub repayment_frequency: Option<String>,
    #[serde(default)]
    pub payment_day: Option<i64>,
    #[serde(default)]
    pub grace_period_months: Option<i64>,
    #[serde(default)]
    pub balloon_amount: Option<f64>,
    #[serde(default)]
    pub schedule_source: Option<String>,
    #[serde(default)]
    pub drawing_power: Option<f64>,
    #[serde(default)]
    pub drawing_power_schedule: Vec<NewDrawingPowerStep>,
    #[serde(default)]
    pub disbursements: Vec<NewDisbursement>,
    #[serde(default)]
    pub expenses: Vec<NewInitialExpense>,
}

/// One dated step of a Dropline Overdraft's drawing power (migration 053).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewDrawingPowerStep {
    pub id: String,
    pub effective_date: String,
    pub drawing_power: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewDisbursement {
    pub id: String,
    pub sequence: i64,
    pub disbursement_date: String,
    pub gross_amount: f64,
    pub deductions_amount: f64,
    pub net_amount: f64,
    #[serde(default)]
    pub destination_account_id: Option<String>,
    #[serde(default)]
    pub reference: Option<String>,
    #[serde(default)]
    pub transaction_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewInitialExpense {
    pub id: String,
    pub expense_type: String,
    #[serde(default)]
    pub description: Option<String>,
    pub expense_date: String,
    pub base_amount: f64,
    #[serde(default)]
    pub gst_rate: Option<f64>,
    pub gst_amount: f64,
    pub total_amount: f64,
    pub settlement: String,
    #[serde(default)]
    pub disbursement_id: Option<String>,
    #[serde(default)]
    pub payment_method: Option<String>,
    #[serde(default)]
    pub payment_account_id: Option<String>,
    #[serde(default)]
    pub transaction_reference: Option<String>,
    #[serde(default)]
    pub transaction_id: Option<String>,
}

/// Float noise only - never a rounding allowance (amounts are to the paisa).
const MONEY_EPSILON: f64 = 0.005;

#[derive(Clone, Copy)]
pub(crate) enum MoneySide {
    In,
    Out,
}

fn refused(message: String) -> sqlx::Error {
    sqlx::Error::Protocol(format!("{REFUSED}{message}"))
}

/// The transaction may back this record: live, on `account_id`, moving
/// money `side`, for exactly `amount`, and not used by anything else.
pub(crate) async fn check_transaction(
    tx: &mut Transaction<'_, Sqlite>,
    transaction_id: &str,
    account_id: Option<&str>,
    side: MoneySide,
    amount: f64,
    what: &str,
) -> Result<(), sqlx::Error> {
    let row = sqlx::query(
        r#"
        SELECT account_id, amount, type, transfer_direction, deleted_at
        FROM transactions
        WHERE id = ?
        "#,
    )
    .bind(transaction_id)
    .fetch_optional(&mut **tx)
    .await?;

    let Some(row) = row else {
        return Err(refused(format!(
            "The bank transaction chosen for {what} no longer exists."
        )));
    };

    if row.get::<Option<String>, _>("deleted_at").is_some() {
        return Err(refused(format!(
            "The bank transaction chosen for {what} has been deleted."
        )));
    }

    let txn_account: String = row.get("account_id");

    if let Some(expected) = account_id {
        if expected != txn_account {
            return Err(refused(format!(
                "The bank transaction chosen for {what} is on a different bank account."
            )));
        }
    }

    let txn_type: String = row.get("type");
    let direction: Option<String> = row.get("transfer_direction");
    let is_in = txn_type == "income"
        || (txn_type == "transfer" && direction.as_deref() == Some("IN"));
    let is_out = txn_type == "expense"
        || (txn_type == "transfer" && direction.as_deref() == Some("OUT"));

    match side {
        MoneySide::In if !is_in => {
            return Err(refused(format!(
                "The bank transaction chosen for {what} is not money received."
            )))
        }
        MoneySide::Out if !is_out => {
            return Err(refused(format!(
                "The bank transaction chosen for {what} is not money paid out."
            )))
        }
        _ => {}
    }

    let txn_amount: f64 = row.get("amount");

    if (txn_amount - amount).abs() >= MONEY_EPSILON {
        return Err(refused(format!(
            "The bank transaction chosen for {what} is for {txn_amount:.2}, not {amount:.2}."
        )));
    }

    let claimed: i64 = sqlx::query(
        r#"
        SELECT
            (SELECT COUNT(*) FROM overdraft_transaction_links WHERE transaction_id = ?1)
          + (SELECT COUNT(*) FROM loan_schedule_payments WHERE transaction_id = ?1)
          + (SELECT COUNT(*) FROM loan_disbursements WHERE transaction_id = ?1)
          + (SELECT COUNT(*) FROM loan_initial_expenses WHERE transaction_id = ?1)
            AS claimed
        "#,
    )
    .bind(transaction_id)
    .fetch_one(&mut **tx)
    .await?
    .get("claimed");

    if claimed > 0 {
        return Err(refused(format!(
            "The bank transaction chosen for {what} is already linked to a loan, an overdraft or another loan expense."
        )));
    }

    Ok(())
}

/// Why a Dropline's steps cannot be saved against this loan, if they cannot:
/// it must be an Overdraft with a sanctioned limit, and every step needs a
/// valid date of its own and a drawing power from 0 up to that limit.
fn drawing_power_steps_refusal(
    loan_kind: &str,
    credit_limit: Option<f64>,
    steps: &[NewDrawingPowerStep],
) -> Option<String> {
    if loan_kind != "OVERDRAFT" {
        return Some("Drawing-power steps belong only to an Overdraft.".to_string());
    }

    let Some(limit) = credit_limit.filter(|limit| limit.is_finite()) else {
        return Some("A Dropline Overdraft needs its sanctioned limit before its drawing-power steps.".to_string());
    };

    let mut seen = std::collections::HashSet::new();

    for (index, step) in steps.iter().enumerate() {
        let at = format!("Drawing-power step {}", index + 1);

        if !crate::overdraft_update::is_iso_date(&step.effective_date) {
            return Some(format!("{at}: the date it takes effect is not a valid date."));
        }

        if !seen.insert(step.effective_date.as_str()) {
            return Some(format!("{at}: two steps cannot take effect on the same date."));
        }

        if !step.drawing_power.is_finite() || step.drawing_power < 0.0 {
            return Some(format!("{at}: drawing power cannot be negative."));
        }

        if step.drawing_power > limit + MONEY_EPSILON {
            return Some(format!("{at}: drawing power cannot be more than the sanctioned limit."));
        }
    }

    None
}

/// Writes nothing, and needs no table, when the schedule is empty: only a
/// Dropline Overdraft ever reaches the checks and the insert below, which
/// run inside the create transaction against the loan row just written.
async fn persist_drawing_power_schedule(
    tx: &mut Transaction<'_, Sqlite>,
    loan_id: &str,
    steps: &[NewDrawingPowerStep],
) -> Result<(), sqlx::Error> {
    if steps.is_empty() {
        return Ok(());
    }

    let loan = sqlx::query("SELECT loan_kind, credit_limit FROM loans WHERE id = ?")
        .bind(loan_id)
        .fetch_one(&mut **tx)
        .await?;
    let loan_kind: String = loan.get("loan_kind");
    let credit_limit: Option<f64> = loan.get("credit_limit");

    if let Some(message) = drawing_power_steps_refusal(&loan_kind, credit_limit, steps) {
        return Err(refused(message));
    }

    for step in steps {
        sqlx::query(
            "INSERT INTO loan_drawing_power_schedule (id, loan_id, effective_date, drawing_power) VALUES (?, ?, ?, ?)",
        )
        .bind(&step.id)
        .bind(loan_id)
        .bind(&step.effective_date)
        .bind(step.drawing_power)
        .execute(&mut **tx)
        .await?;
    }

    Ok(())
}

pub async fn persist_setup(
    tx: &mut Transaction<'_, Sqlite>,
    loan_id: &str,
    setup: &LoanSetupDetails,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE loans
        SET
            loan_purpose = ?,
            rate_type = ?,
            interest_calculation_method = ?,
            sanction_date = ?,
            sanctioned_amount = ?,
            first_emi_date = ?,
            repayment_frequency = ?,
            payment_day = ?,
            grace_period_months = ?,
            balloon_amount = ?,
            schedule_source = ?,
            drawing_power = ?
        WHERE id = ?
          AND deleted_at IS NULL
        "#,
    )
    .bind(&setup.loan_purpose)
    .bind(&setup.rate_type)
    .bind(&setup.interest_calculation_method)
    .bind(&setup.sanction_date)
    .bind(setup.sanctioned_amount)
    .bind(&setup.first_emi_date)
    .bind(&setup.repayment_frequency)
    .bind(setup.payment_day)
    .bind(setup.grace_period_months)
    .bind(setup.balloon_amount)
    .bind(&setup.schedule_source)
    .bind(setup.drawing_power)
    .bind(loan_id)
    .execute(&mut **tx)
    .await?;

    persist_drawing_power_schedule(tx, loan_id, &setup.drawing_power_schedule).await?;

    for disbursement in &setup.disbursements {
        let net = disbursement.gross_amount - disbursement.deductions_amount;

        if (net - disbursement.net_amount).abs() >= MONEY_EPSILON {
            return Err(refused(format!(
                "Disbursement {} does not add up: gross less deductions is {net:.2}, not {:.2}.",
                disbursement.sequence, disbursement.net_amount
            )));
        }

        if let Some(transaction_id) = &disbursement.transaction_id {
            check_transaction(
                tx,
                transaction_id,
                disbursement.destination_account_id.as_deref(),
                MoneySide::In,
                disbursement.net_amount,
                &format!("disbursement {}", disbursement.sequence),
            )
            .await?;
        }

        sqlx::query(
            r#"
            INSERT INTO loan_disbursements
            (id, loan_id, sequence, disbursement_date, gross_amount, deductions_amount,
             net_amount, destination_account_id, reference, transaction_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&disbursement.id)
        .bind(loan_id)
        .bind(disbursement.sequence)
        .bind(&disbursement.disbursement_date)
        .bind(disbursement.gross_amount)
        .bind(disbursement.deductions_amount)
        .bind(disbursement.net_amount)
        .bind(&disbursement.destination_account_id)
        .bind(&disbursement.reference)
        .bind(&disbursement.transaction_id)
        .execute(&mut **tx)
        .await?;
    }

    for (index, expense) in setup.expenses.iter().enumerate() {
        let what = format!("initial expense {}", index + 1);

        if (expense.base_amount + expense.gst_amount - expense.total_amount).abs() >= MONEY_EPSILON {
            return Err(refused(format!(
                "The {what} does not add up: base plus GST is not the total."
            )));
        }

        if expense.settlement != "PAID_SEPARATELY" && expense.transaction_id.is_some() {
            return Err(refused(format!(
                "The {what} was not paid from a bank account, so it cannot be linked to a bank transaction."
            )));
        }

        if expense.settlement == "DEDUCTED_FROM_DISBURSEMENT" {
            let belongs = expense.disbursement_id.as_ref().is_some_and(|id| {
                setup.disbursements.iter().any(|d| &d.id == id)
            });

            if !belongs {
                return Err(refused(format!(
                    "The {what} is deducted from a disbursement that is not part of this loan."
                )));
            }
        }

        if let Some(transaction_id) = &expense.transaction_id {
            check_transaction(
                tx,
                transaction_id,
                expense.payment_account_id.as_deref(),
                MoneySide::Out,
                expense.total_amount,
                &what,
            )
            .await?;
        }

        sqlx::query(
            r#"
            INSERT INTO loan_initial_expenses
            (id, loan_id, expense_type, description, expense_date, base_amount, gst_rate,
             gst_amount, total_amount, settlement, disbursement_id, payment_method,
             payment_account_id, transaction_reference, transaction_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&expense.id)
        .bind(loan_id)
        .bind(&expense.expense_type)
        .bind(&expense.description)
        .bind(&expense.expense_date)
        .bind(expense.base_amount)
        .bind(expense.gst_rate)
        .bind(expense.gst_amount)
        .bind(expense.total_amount)
        .bind(&expense.settlement)
        .bind(&expense.disbursement_id)
        .bind(&expense.payment_method)
        .bind(&expense.payment_account_id)
        .bind(&expense.transaction_reference)
        .bind(&expense.transaction_id)
        .execute(&mut **tx)
        .await?;
    }

    // Each deducted expense belongs to one disbursement, and together they
    // are exactly that disbursement's deductions - the lender's deduction
    // is fully explained and never counted twice.
    for disbursement in &setup.disbursements {
        let deducted: f64 = setup
            .expenses
            .iter()
            .filter(|e| {
                e.settlement == "DEDUCTED_FROM_DISBURSEMENT"
                    && e.disbursement_id.as_deref() == Some(disbursement.id.as_str())
            })
            .map(|e| e.total_amount)
            .sum();

        if (deducted - disbursement.deductions_amount).abs() >= MONEY_EPSILON {
            return Err(refused(format!(
                "Disbursement {} lists deductions of {:.2}, but the expenses deducted from it total {deducted:.2}.",
                disbursement.sequence, disbursement.deductions_amount
            )));
        }
    }

    Ok(())
}

/// Stores the lender's own opening principal on an imported schedule row.
pub async fn persist_opening_principal(
    tx: &mut Transaction<'_, Sqlite>,
    installment_id: &str,
    opening_principal: f64,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE loan_payment_schedule SET opening_principal = ? WHERE id = ?")
        .bind(opening_principal)
        .bind(installment_id)
        .execute(&mut **tx)
        .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;
    use sqlx::Pool;

    async fn pool() -> Pool<Sqlite> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();

        sqlx::query(
            r#"
            PRAGMA foreign_keys = ON;
            CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT);
            CREATE TABLE transactions (
                id TEXT PRIMARY KEY, account_id TEXT NOT NULL, amount REAL NOT NULL,
                type TEXT NOT NULL, transfer_direction TEXT, deleted_at TEXT
            );
            CREATE TABLE loans (
                id TEXT PRIMARY KEY, deleted_at TEXT,
                loan_purpose TEXT, rate_type TEXT, interest_calculation_method TEXT,
                sanction_date TEXT, sanctioned_amount REAL, first_emi_date TEXT,
                repayment_frequency TEXT, payment_day INTEGER, grace_period_months INTEGER,
                balloon_amount REAL, schedule_source TEXT, drawing_power REAL
            );
            CREATE TABLE overdraft_transaction_links (id TEXT PRIMARY KEY, loan_id TEXT, transaction_id TEXT UNIQUE);
            CREATE TABLE loan_schedule_payments (id TEXT PRIMARY KEY, loan_id TEXT, transaction_id TEXT);
            CREATE TABLE loan_disbursements (
                id TEXT PRIMARY KEY, loan_id TEXT NOT NULL REFERENCES loans(id), sequence INTEGER NOT NULL,
                disbursement_date TEXT NOT NULL, gross_amount REAL NOT NULL, deductions_amount REAL NOT NULL,
                net_amount REAL NOT NULL, destination_account_id TEXT REFERENCES accounts(id), reference TEXT,
                transaction_id TEXT REFERENCES transactions(id), created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE UNIQUE INDEX d_txn ON loan_disbursements(transaction_id) WHERE transaction_id IS NOT NULL;
            CREATE TABLE loan_initial_expenses (
                id TEXT PRIMARY KEY, loan_id TEXT NOT NULL REFERENCES loans(id), expense_type TEXT NOT NULL,
                description TEXT, expense_date TEXT NOT NULL, base_amount REAL NOT NULL, gst_rate REAL,
                gst_amount REAL NOT NULL, total_amount REAL NOT NULL, settlement TEXT NOT NULL,
                disbursement_id TEXT REFERENCES loan_disbursements(id), payment_method TEXT,
                payment_account_id TEXT REFERENCES accounts(id), transaction_reference TEXT,
                transaction_id TEXT REFERENCES transactions(id), created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE UNIQUE INDEX e_txn ON loan_initial_expenses(transaction_id) WHERE transaction_id IS NOT NULL;
            CREATE TABLE loan_payment_schedule (id TEXT PRIMARY KEY, opening_principal REAL);

            INSERT INTO accounts (id, name) VALUES ('bank', 'Netedge 3999'), ('other', 'Netedge 2790');
            INSERT INTO loans (id) VALUES ('loan-1');
            INSERT INTO transactions (id, account_id, amount, type, transfer_direction) VALUES
                ('credit', 'bank', 712182, 'income', NULL),
                ('credit-transfer', 'bank', 712182, 'transfer', 'IN'),
                ('fee', 'bank', 10620, 'expense', NULL),
                ('od-linked', 'bank', 10620, 'expense', NULL);
            INSERT INTO overdraft_transaction_links (id, loan_id, transaction_id) VALUES ('l1', 'od', 'od-linked');
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();

        pool
    }

    fn disbursement(transaction_id: Option<&str>) -> NewDisbursement {
        NewDisbursement {
            id: "d1".to_string(),
            sequence: 1,
            disbursement_date: "2026-02-12".to_string(),
            gross_amount: 750_000.0,
            deductions_amount: 37_818.0,
            net_amount: 712_182.0,
            destination_account_id: Some("bank".to_string()),
            reference: Some("Cheque".to_string()),
            transaction_id: transaction_id.map(str::to_string),
        }
    }

    fn deducted_fee() -> NewInitialExpense {
        NewInitialExpense {
            id: "e1".to_string(),
            expense_type: "PROCESSING_FEE".to_string(),
            description: None,
            expense_date: "2026-02-12".to_string(),
            base_amount: 32_049.15,
            gst_rate: Some(18.0),
            gst_amount: 5_768.85,
            total_amount: 37_818.0,
            settlement: "DEDUCTED_FROM_DISBURSEMENT".to_string(),
            disbursement_id: Some("d1".to_string()),
            payment_method: None,
            payment_account_id: None,
            transaction_reference: None,
            transaction_id: None,
        }
    }

    fn paid_fee(transaction_id: &str) -> NewInitialExpense {
        NewInitialExpense {
            id: "e2".to_string(),
            expense_type: "LEGAL_CHARGES".to_string(),
            description: Some("Legal opinion".to_string()),
            expense_date: "2026-02-10".to_string(),
            base_amount: 9_000.0,
            gst_rate: Some(18.0),
            gst_amount: 1_620.0,
            total_amount: 10_620.0,
            settlement: "PAID_SEPARATELY".to_string(),
            disbursement_id: None,
            payment_method: Some("NEFT".to_string()),
            payment_account_id: Some("bank".to_string()),
            transaction_reference: None,
            transaction_id: Some(transaction_id.to_string()),
        }
    }

    fn setup(disbursements: Vec<NewDisbursement>, expenses: Vec<NewInitialExpense>) -> LoanSetupDetails {
        LoanSetupDetails {
            loan_purpose: Some("Working capital".to_string()),
            rate_type: Some("FLOATING".to_string()),
            interest_calculation_method: Some("ACTUAL_365".to_string()),
            sanctioned_amount: Some(750_000.0),
            first_emi_date: Some("2026-03-05".to_string()),
            schedule_source: Some("GENERATED".to_string()),
            disbursements,
            expenses,
            ..Default::default()
        }
    }

    async fn run(pool: &Pool<Sqlite>, details: &LoanSetupDetails) -> Result<(), sqlx::Error> {
        let mut tx = pool.begin().await?;
        let result = persist_setup(&mut tx, "loan-1", details).await;
        match result {
            Ok(()) => tx.commit().await,
            Err(error) => {
                let _ = tx.rollback().await;
                Err(error)
            }
        }
    }

    async fn count(pool: &Pool<Sqlite>, table: &str) -> i64 {
        sqlx::query(&format!("SELECT COUNT(*) AS n FROM {table}"))
            .fetch_one(pool)
            .await
            .unwrap()
            .get("n")
    }

    async fn transactions_snapshot(pool: &Pool<Sqlite>) -> Vec<(String, f64, String)> {
        sqlx::query("SELECT id, amount, type FROM transactions ORDER BY id")
            .fetch_all(pool)
            .await
            .unwrap()
            .iter()
            .map(|r| (r.get("id"), r.get("amount"), r.get("type")))
            .collect()
    }

    #[tokio::test]
    async fn links_existing_transactions_and_never_creates_one() {
        let pool = pool().await;
        let before = transactions_snapshot(&pool).await;

        run(&pool, &setup(vec![disbursement(Some("credit"))], vec![deducted_fee(), paid_fee("fee")]))
            .await
            .expect("setup is stored");

        assert_eq!(count(&pool, "loan_disbursements").await, 1);
        assert_eq!(count(&pool, "loan_initial_expenses").await, 2);
        assert_eq!(transactions_snapshot(&pool).await, before, "no bank transaction is created or changed");

        let loan = sqlx::query("SELECT rate_type, interest_calculation_method, first_emi_date FROM loans WHERE id = 'loan-1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(loan.get::<String, _>("rate_type"), "FLOATING");
        assert_eq!(loan.get::<String, _>("interest_calculation_method"), "ACTUAL_365");
        assert_eq!(loan.get::<String, _>("first_emi_date"), "2026-03-05");
    }

    #[tokio::test]
    async fn accepts_a_transfer_in_as_the_disbursement_credit() {
        let pool = pool().await;
        run(&pool, &setup(vec![disbursement(Some("credit-transfer"))], vec![deducted_fee()]))
            .await
            .expect("a transfer IN is money received");
    }

    async fn refusal(pool: &Pool<Sqlite>, details: LoanSetupDetails) -> String {
        let error = run(pool, &details).await.expect_err("refused").to_string();
        assert_eq!(count(pool, "loan_disbursements").await, 0, "nothing is written");
        assert_eq!(count(pool, "loan_initial_expenses").await, 0, "nothing is written");
        error
    }

    #[tokio::test]
    async fn refuses_a_transaction_already_linked_to_an_overdraft() {
        let pool = pool().await;
        let error = refusal(&pool, setup(vec![], vec![paid_fee("od-linked")])).await;
        assert!(error.contains(REFUSED), "{error}");
        assert!(error.contains("already linked"), "{error}");
    }

    #[tokio::test]
    async fn refuses_the_same_transaction_twice_in_one_loan() {
        let pool = pool().await;
        let mut second = paid_fee("fee");
        second.id = "e3".to_string();
        let error = refusal(&pool, setup(vec![], vec![paid_fee("fee"), second])).await;
        assert!(error.contains("already linked"), "{error}");
    }

    #[tokio::test]
    async fn refuses_a_wrong_amount_with_no_tolerance() {
        let pool = pool().await;
        let mut d = disbursement(Some("credit"));
        d.gross_amount = 750_001.0;
        d.net_amount = 712_183.0;
        let mut fee = deducted_fee();
        fee.base_amount = 32_049.15;
        let error = refusal(&pool, setup(vec![d], vec![fee])).await;
        assert!(error.contains("712182.00, not 712183.00"), "{error}");
    }

    #[tokio::test]
    async fn refuses_a_debit_as_a_disbursement_and_a_credit_as_a_paid_expense() {
        let pool = pool().await;
        let mut d = disbursement(Some("fee"));
        d.gross_amount = 10_620.0;
        d.deductions_amount = 0.0;
        d.net_amount = 10_620.0;
        let error = refusal(&pool, setup(vec![d], vec![])).await;
        assert!(error.contains("not money received"), "{error}");

        let mut credit_fee = paid_fee("credit");
        credit_fee.base_amount = 712_182.0;
        credit_fee.gst_amount = 0.0;
        credit_fee.total_amount = 712_182.0;
        let error = refusal(&pool, setup(vec![], vec![credit_fee])).await;
        assert!(error.contains("not money paid out"), "{error}");
    }

    #[tokio::test]
    async fn refuses_a_transaction_on_another_account() {
        let pool = pool().await;
        let mut fee = paid_fee("fee");
        fee.payment_account_id = Some("other".to_string());
        let error = refusal(&pool, setup(vec![], vec![fee])).await;
        assert!(error.contains("different bank account"), "{error}");
    }

    #[tokio::test]
    async fn refuses_deductions_that_the_deducted_expenses_do_not_explain() {
        let pool = pool().await;
        let error = refusal(&pool, setup(vec![disbursement(None)], vec![])).await;
        assert!(error.contains("deductions of 37818.00"), "{error}");
    }

    #[tokio::test]
    async fn refuses_linking_a_deducted_expense_to_a_bank_transaction() {
        let pool = pool().await;
        let mut fee = deducted_fee();
        fee.transaction_id = Some("fee".to_string());
        let error = refusal(&pool, setup(vec![disbursement(None)], vec![fee])).await;
        assert!(error.contains("cannot be linked"), "{error}");
    }
}
