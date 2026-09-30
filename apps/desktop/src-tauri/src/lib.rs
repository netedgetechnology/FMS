mod backup;
mod category_import;
mod db_backup;
mod documents;
mod import_batch_delete;
mod import_reconciliation_reset;
mod loan_create;
mod loan_delete;
mod storage;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            documents::store_document_file,
            backup::create_backup,
            backup::restore_backup,
            db_backup::begin_daily_backup,
            db_backup::finalize_daily_backup,
            documents::delete_document_file,
            documents::open_document_file,
            storage::get_storage_info,
            storage::open_storage_folder,
            import_reconciliation_reset::reset_import_and_reconciliation_data,
            import_batch_delete::delete_import_batch_atomic,
            loan_create::create_loan_atomic,
            loan_delete::delete_loan_atomic,
            category_import::create_categories_atomic,
            category_import::save_category_csv_template,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}









