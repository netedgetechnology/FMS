use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub backup_path: String,
    pub file_size: u64,
    pub checksum: String,
}

fn app_data_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| error.to_string())
}

fn database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_path(app)?.join("financeos.db"))
}

fn documents_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_path(app)?.join("storage").join("documents"))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let data = fs::read(path).map_err(|error| error.to_string())?;
    Ok(format!("{:x}", Sha256::digest(&data)))
}

fn directory_size(path: &Path) -> Result<u64, String> {
    if !path.exists() {
        return Ok(0);
    }

    let mut total = 0u64;

    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let metadata = entry.metadata().map_err(|error| error.to_string())?;

        if metadata.is_file() {
            total = total.saturating_add(metadata.len());
        } else if metadata.is_dir() {
            total = total.saturating_add(directory_size(&entry.path())?);
        }
    }

    Ok(total)
}

fn copy_directory(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }

    fs::create_dir_all(destination).map_err(|error| error.to_string())?;

    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());

        let metadata = entry.metadata().map_err(|error| error.to_string())?;

        if metadata.is_file() {
            fs::copy(&source_path, &destination_path)
                .map_err(|error| error.to_string())?;
        } else if metadata.is_dir() {
            copy_directory(&source_path, &destination_path)?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn create_backup(
    app: tauri::AppHandle,
    destination_path: String,
) -> Result<BackupResult, String> {
    let destination = PathBuf::from(destination_path);

    fs::create_dir_all(&destination)
        .map_err(|error| error.to_string())?;

    let timestamp = chrono::Local::now()
        .format("%Y%m%d_%H%M%S")
        .to_string();

    let backup_root = destination.join(format!("FinanceOS_Backup_{}", timestamp));
    let database_destination = backup_root.join("database");
    let documents_destination = backup_root.join("documents");

    fs::create_dir_all(&database_destination)
        .map_err(|error| error.to_string())?;

    fs::create_dir_all(&documents_destination)
        .map_err(|error| error.to_string())?;

    let database_source = database_path(&app)?;

    if !database_source.is_file() {
        return Err("FinanceOS database does not exist.".to_string());
    }

    let database_target = database_destination.join("financeos.db");

    fs::copy(&database_source, &database_target)
        .map_err(|error| error.to_string())?;

    copy_directory(
        &documents_path(&app)?,
        &documents_destination,
    )?;

    let database_checksum = sha256_file(&database_target)?;
    let database_size = fs::metadata(&database_target)
        .map_err(|error| error.to_string())?
        .len();

    let documents_size = directory_size(&documents_destination)?;

    let metadata = serde_json::json!({
        "formatVersion": 1,
        "application": "FinanceOS",
        "backupType": "MANUAL",
        "createdAt": chrono::Local::now().to_rfc3339(),
        "databaseFile": "database/financeos.db",
        "databaseSize": database_size,
        "databaseChecksum": database_checksum,
        "documentsPath": "documents",
        "documentsSize": documents_size
    });

    let metadata_path = backup_root.join("metadata.json");

    fs::write(
        &metadata_path,
        serde_json::to_vec_pretty(&metadata)
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    let file_size = directory_size(&backup_root)?;

    let mut hasher = Sha256::new();

    for path in [
        database_target.as_path(),
        metadata_path.as_path(),
    ] {
        hasher.update(
            fs::read(path)
                .map_err(|error| error.to_string())?,
        );
    }

    let checksum = format!("{:x}", hasher.finalize());

    Ok(BackupResult {
        backup_path: backup_root.to_string_lossy().into_owned(),
        file_size,
        checksum,
    })
}

#[tauri::command]
pub fn restore_backup(
    app: tauri::AppHandle,
    backup_path: String,
) -> Result<(), String> {
    let backup_root = PathBuf::from(backup_path);

    if !backup_root.is_dir() {
        return Err("Selected backup folder does not exist.".to_string());
    }

    let metadata_path = backup_root.join("metadata.json");
    let database_source = backup_root.join("database").join("financeos.db");
    let documents_source = backup_root.join("documents");

    if !metadata_path.is_file() {
        return Err("Invalid FinanceOS backup: metadata.json is missing.".to_string());
    }

    if !database_source.is_file() {
        return Err("Invalid FinanceOS backup: database/financeos.db is missing.".to_string());
    }

    let metadata_data = fs::read(&metadata_path)
        .map_err(|error| error.to_string())?;

    let metadata: serde_json::Value =
        serde_json::from_slice(&metadata_data)
            .map_err(|error| format!("Invalid backup metadata: {}", error))?;

    if metadata["application"].as_str() != Some("FinanceOS") {
        return Err("This does not appear to be a FinanceOS backup.".to_string());
    }

    if metadata["formatVersion"].as_u64() != Some(1) {
        return Err("Unsupported FinanceOS backup format.".to_string());
    }

    let expected_checksum = metadata["databaseChecksum"]
        .as_str()
        .ok_or_else(|| "Backup database checksum is missing.".to_string())?;

    let actual_checksum = sha256_file(&database_source)?;

    if actual_checksum != expected_checksum {
        return Err(
            "Backup verification failed: database checksum does not match."
                .to_string()
        );
    }

    let app_data = app_data_path(&app)?;
    let database_destination = database_path(&app)?;
    let documents_destination = documents_path(&app)?;

    fs::create_dir_all(&app_data)
        .map_err(|error| error.to_string())?;

    let restore_temp = app_data.join("financeos_restore_temp.db");

    if restore_temp.exists() {
        fs::remove_file(&restore_temp)
            .map_err(|error| error.to_string())?;
    }

    fs::copy(&database_source, &restore_temp)
        .map_err(|error| error.to_string())?;

    if documents_destination.exists() {
        fs::remove_dir_all(&documents_destination)
            .map_err(|error| error.to_string())?;
    }

    copy_directory(
        &documents_source,
        &documents_destination,
    )?;

    if database_destination.exists() {
        fs::remove_file(&database_destination)
            .map_err(|error| {
                format!(
                    "Unable to replace the FinanceOS database. Please close any open database operation and try again. {}",
                    error
                )
            })?;
    }

    fs::rename(&restore_temp, &database_destination)
        .map_err(|error| error.to_string())?;

    Ok(())
}
