// ---------------------------------------------------------------------
// Categories CSV import - atomic bulk insert.
//
// Inserts every new category from one CSV import inside ONE sqlx
// transaction: either all of them are created, or - on any database
// error - none are (full ROLLBACK). Same reason as loan_create.rs /
// import_reconciliation_reset.rs: `tauri-plugin-sql`'s execute()/select()
// each check out their own pooled connection, so a TypeScript
// BEGIN/INSERT.../COMMIT can't guarantee every statement lands on one
// connection. This borrows the plugin's own pool (DbInstances).
//
// Scope: INSERT INTO categories only. It never UPDATEs or DELETEs any
// row, and never touches any other table. Every name is re-checked
// against the current (non-deleted) categories inside the same
// transaction - case-insensitive, whitespace-normalized, the same rule
// as the TypeScript preview (categoryNameKey) - and a name that already
// exists (e.g. created after the preview) is skipped and counted, never
// overwritten. Ids and timestamps come from the TypeScript layer
// (buildCategoryRecord - the app's existing category id generation).
// ---------------------------------------------------------------------

use std::collections::HashSet;
use std::path::Path;

use serde::{Deserialize, Serialize};
use sqlx::{Pool, Row, Sqlite};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_sql::{DbInstances, DbPool};

const DB_KEY: &str = "sqlite:financeos.db";

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NewCategory {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub category_type: String,
    pub finance_scope: String,
    pub business_entity_id: Option<String>,
    pub description: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCategoriesAtomicRequest {
    pub categories: Vec<NewCategory>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateCategoriesAtomicResult {
    pub inserted: i64,
    pub skipped_duplicates: i64,
}

async fn sqlite_pool(app: &AppHandle) -> Result<Pool<Sqlite>, String> {
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;

    match lock.get(DB_KEY) {
        Some(DbPool::Sqlite(pool)) => Ok(pool.clone()),
        _ => Err("FinWea's database is not connected yet.".to_string()),
    }
}

/// Trimmed, internal whitespace collapsed, lower-cased - mirrors
/// categoryNameKey in categoryCsvImport.ts.
fn name_key(name: &str) -> String {
    name.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

async fn run_create(
    pool: &Pool<Sqlite>,
    request: &CreateCategoriesAtomicRequest,
) -> Result<CreateCategoriesAtomicResult, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let outcome: Result<CreateCategoriesAtomicResult, sqlx::Error> = async {
        let existing = sqlx::query(
            "SELECT name FROM categories WHERE deleted_at IS NULL",
        )
        .fetch_all(&mut *tx)
        .await?;

        let mut taken: HashSet<String> = existing
            .iter()
            .map(|row| name_key(&row.get::<String, _>("name")))
            .collect();

        let mut inserted = 0i64;
        let mut skipped_duplicates = 0i64;

        for category in &request.categories {
            if !taken.insert(name_key(&category.name)) {
                skipped_duplicates += 1;
                continue;
            }

            sqlx::query(
                r#"
                INSERT INTO categories
                (
                    id,
                    parent_id,
                    name,
                    category_type,
                    finance_scope,
                    business_entity_id,
                    description,
                    is_active,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                "#,
            )
            .bind(&category.id)
            .bind(&category.parent_id)
            .bind(&category.name)
            .bind(&category.category_type)
            .bind(&category.finance_scope)
            .bind(&category.business_entity_id)
            .bind(&category.description)
            .bind(if category.is_active { 1i64 } else { 0i64 })
            .bind(&category.created_at)
            .bind(&category.updated_at)
            .execute(&mut *tx)
            .await?;

            inserted += 1;
        }

        Ok(CreateCategoriesAtomicResult {
            inserted,
            skipped_duplicates,
        })
    }
    .await;

    match outcome {
        Ok(result) => {
            tx.commit().await?;
            Ok(result)
        }
        Err(error) => {
            let _ = tx.rollback().await;
            Err(error)
        }
    }
}

/// categories.finance_scope values - Personal-only, Business-only, or
/// both. Mirrors FINANCE_SCOPE_VALUES in utils/financeScope.ts.
const VALID_FINANCE_SCOPES: [&str; 3] = ["PERSONAL", "BUSINESS", "BOTH"];

/// Rejects the whole request (nothing is written) if any category has a
/// scope that isn't one of VALID_FINANCE_SCOPES - including an empty one:
/// a category must have at least one scope.
fn validate_request(request: &CreateCategoriesAtomicRequest) -> Result<(), String> {
    for category in &request.categories {
        if !VALID_FINANCE_SCOPES.contains(&category.finance_scope.as_str()) {
            return Err(format!(
                "Invalid scope \"{}\" for category \"{}\". Use PERSONAL, BUSINESS or BOTH.",
                category.finance_scope, category.name
            ));
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn create_categories_atomic(
    app: AppHandle,
    request: CreateCategoriesAtomicRequest,
) -> Result<CreateCategoriesAtomicResult, String> {
    validate_request(&request)?;

    let pool = sqlite_pool(&app).await?;

    run_create(&pool, &request)
        .await
        .map_err(|error| error.to_string())
}

// ---------------------------------------------------------------------
// Categories CSV template - "Download Template".
//
// Opens the native Save dialog and writes the template to the chosen
// file, so the frontend learns the outcome: Ok(true) once the file is
// written, Ok(false) if the user cancelled the dialog, Err(..) if the
// write failed. (A browser-style <a download> gives the page no signal
// at all.) The path only ever comes from the Save dialog - the frontend
// can't direct a write anywhere else. The template text itself comes
// from the frontend (categoryCsvTemplateContent) so it stays defined in
// one place.
// ---------------------------------------------------------------------

fn write_template_file(path: &Path, contents: &str) -> Result<(), String> {
    std::fs::write(path, contents)
        .map_err(|error| format!("Could not write {}: {error}", path.display()))
}

#[tauri::command]
pub async fn save_category_csv_template(
    app: AppHandle,
    file_name: String,
    contents: String,
) -> Result<bool, String> {
    let Some(file_path) = app
        .dialog()
        .file()
        .set_file_name(file_name)
        .add_filter("CSV", &["csv"])
        .blocking_save_file()
    else {
        return Ok(false);
    };

    let path = file_path.into_path().map_err(|error| error.to_string())?;

    write_template_file(&path, &contents)?;

    Ok(true)
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

        // The real categories shape (migration 004), plus a transactions
        // table that must never be touched.
        sqlx::query(
            r#"
            CREATE TABLE business_entities (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL
            );

            CREATE TABLE categories (
                id TEXT PRIMARY KEY,
                parent_id TEXT,
                name TEXT NOT NULL,
                category_type TEXT NOT NULL,
                finance_scope TEXT NOT NULL DEFAULT 'PERSONAL',
                business_entity_id TEXT,
                description TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                deleted_at TEXT,
                FOREIGN KEY (parent_id) REFERENCES categories(id),
                FOREIGN KEY (business_entity_id) REFERENCES business_entities(id)
            );

            CREATE TABLE transactions (
                id TEXT PRIMARY KEY,
                category_id TEXT,
                amount REAL NOT NULL,
                FOREIGN KEY (category_id) REFERENCES categories(id)
            );

            INSERT INTO categories (id, name, category_type, description, updated_at)
                VALUES ('existing-1', 'Bank Charges', 'EXPENSE', 'Original', 'orig');
            INSERT INTO categories (id, name, category_type, deleted_at)
                VALUES ('deleted-1', 'Shopping', 'EXPENSE', '2026-09-01');
            INSERT INTO transactions (id, category_id, amount)
                VALUES ('txn-1', 'existing-1', 42.5);
            "#,
        )
        .execute(&pool)
        .await
        .expect("create focused test schema");

        pool
    }

    fn category(id: &str, name: &str) -> NewCategory {
        NewCategory {
            id: id.to_string(),
            parent_id: None,
            name: name.to_string(),
            category_type: "EXPENSE".to_string(),
            finance_scope: "PERSONAL".to_string(),
            business_entity_id: None,
            description: Some(format!("{name} description")),
            is_active: true,
            created_at: "2026-09-25T00:00:00.000Z".to_string(),
            updated_at: "2026-09-25T00:00:00.000Z".to_string(),
        }
    }

    async fn count(pool: &Pool<Sqlite>, sql: &str) -> i64 {
        sqlx::query(sql)
            .fetch_one(pool)
            .await
            .unwrap()
            .get::<i64, _>(0)
    }

    #[tokio::test]
    async fn inserts_all_new_categories_and_commits() {
        let pool = test_pool().await;

        let result = run_create(
            &pool,
            &CreateCategoriesAtomicRequest {
                categories: vec![
                    category("new-1", "Sales Revenue"),
                    category("new-2", "Café & Restaurants"),
                ],
            },
        )
        .await
        .expect("import succeeds");

        assert_eq!(
            result,
            CreateCategoriesAtomicResult {
                inserted: 2,
                skipped_duplicates: 0
            }
        );

        let row = sqlx::query(
            "SELECT name, category_type, finance_scope, description, is_active FROM categories WHERE id = 'new-2'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(row.get::<String, _>("name"), "Café & Restaurants");
        assert_eq!(row.get::<String, _>("category_type"), "EXPENSE");
        assert_eq!(row.get::<String, _>("finance_scope"), "PERSONAL");
        assert_eq!(row.get::<i64, _>("is_active"), 1);
    }

    #[tokio::test]
    async fn skips_existing_names_case_and_whitespace_insensitively_and_never_updates_them(
    ) {
        let pool = test_pool().await;

        let result = run_create(
            &pool,
            &CreateCategoriesAtomicRequest {
                categories: vec![
                    category("dup-1", "  bank   CHARGES "),
                    category("new-1", "Rent"),
                    category("dup-2", "rent"),
                    // A soft-deleted name is not "existing".
                    category("new-2", "Shopping"),
                ],
            },
        )
        .await
        .expect("import succeeds");

        assert_eq!(
            result,
            CreateCategoriesAtomicResult {
                inserted: 2,
                skipped_duplicates: 2
            }
        );

        let original = sqlx::query(
            "SELECT name, description, updated_at FROM categories WHERE id = 'existing-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(original.get::<String, _>("name"), "Bank Charges");
        assert_eq!(original.get::<String, _>("description"), "Original");
        assert_eq!(original.get::<String, _>("updated_at"), "orig");
        assert_eq!(
            count(&pool, "SELECT COUNT(*) FROM categories WHERE id IN ('dup-1', 'dup-2')").await,
            0
        );
    }

    #[tokio::test]
    async fn rolls_back_every_insert_when_a_later_one_fails() {
        let pool = test_pool().await;

        let result = run_create(
            &pool,
            &CreateCategoriesAtomicRequest {
                categories: vec![
                    category("new-1", "First"),
                    category("new-2", "Second"),
                    // Same primary key as an existing row -> the INSERT fails.
                    category("existing-1", "Third"),
                ],
            },
        )
        .await;

        assert!(result.is_err());
        assert_eq!(
            count(&pool, "SELECT COUNT(*) FROM categories WHERE id IN ('new-1', 'new-2')").await,
            0,
            "earlier inserts must be rolled back"
        );
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM categories").await, 2);
    }

    #[tokio::test]
    async fn never_touches_transactions() {
        let pool = test_pool().await;

        run_create(
            &pool,
            &CreateCategoriesAtomicRequest {
                categories: (0..150)
                    .map(|index| category(&format!("bulk-{index}"), &format!("Category {index}")))
                    .collect(),
            },
        )
        .await
        .expect("bulk import succeeds");

        assert_eq!(count(&pool, "SELECT COUNT(*) FROM categories").await, 152);
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM transactions").await, 1);

        let txn = sqlx::query("SELECT category_id, amount FROM transactions WHERE id = 'txn-1'")
            .fetch_one(&pool)
            .await
            .unwrap();

        assert_eq!(txn.get::<String, _>("category_id"), "existing-1");
        assert_eq!(txn.get::<f64, _>("amount"), 42.5);
    }

    #[tokio::test]
    async fn inserts_personal_business_and_both_scopes_as_given() {
        let pool = test_pool().await;

        let mut personal = category("s-1", "Groceries");
        personal.finance_scope = "PERSONAL".to_string();
        let mut business = category("s-2", "Sales Revenue");
        business.finance_scope = "BUSINESS".to_string();
        let mut both = category("s-3", "Fuel");
        both.finance_scope = "BOTH".to_string();

        let request = CreateCategoriesAtomicRequest {
            categories: vec![personal, business, both],
        };

        validate_request(&request).expect("all scopes valid");
        run_create(&pool, &request).await.expect("import succeeds");

        let scopes: Vec<(String, String)> = sqlx::query(
            "SELECT id, finance_scope FROM categories WHERE id LIKE 's-%' ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .unwrap()
        .iter()
        .map(|row| (row.get("id"), row.get("finance_scope")))
        .collect();

        assert_eq!(
            scopes,
            vec![
                ("s-1".to_string(), "PERSONAL".to_string()),
                ("s-2".to_string(), "BUSINESS".to_string()),
                ("s-3".to_string(), "BOTH".to_string()),
            ]
        );
    }

    #[test]
    fn rejects_an_empty_or_unknown_scope() {
        for bad in ["", "personal", "GLOBAL", "PERSONAL,BUSINESS"] {
            let mut invalid = category("bad", "Bad");
            invalid.finance_scope = bad.to_string();

            let error = validate_request(&CreateCategoriesAtomicRequest {
                categories: vec![category("ok", "Ok"), invalid],
            })
            .unwrap_err();

            assert!(error.starts_with("Invalid scope"), "{bad}: {error}");
        }
    }

    #[test]
    fn write_template_file_writes_the_exact_contents() {
        let path = std::env::temp_dir().join(format!(
            "finwea-category-template-test-{}.csv",
            std::process::id()
        ));
        let contents = "name,type,description\r\nCafé,EXPENSE,\r\n";

        write_template_file(&path, contents).expect("write succeeds");

        let written = std::fs::read_to_string(&path).unwrap();
        let _ = std::fs::remove_file(&path);

        assert_eq!(written, contents);
    }

    #[test]
    fn write_template_file_reports_a_failed_write() {
        let path = std::env::temp_dir()
            .join(format!("finwea-missing-dir-{}", std::process::id()))
            .join("template.csv");

        let error = write_template_file(&path, "x").unwrap_err();

        assert!(error.starts_with("Could not write "), "{error}");
    }

    #[test]
    fn name_key_matches_the_typescript_rule() {
        assert_eq!(name_key("  Bank   Charges "), "bank charges");
        assert_eq!(name_key("CAFÉ"), "café");
    }
}
