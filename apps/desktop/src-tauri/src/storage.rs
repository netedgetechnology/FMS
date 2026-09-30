use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub app_data_path: String,
    pub documents_path: String,
    pub documents_size: u64,
    pub database_path: String,
    pub database_size: u64,
}

fn directory_size(path: &PathBuf) -> Result<u64, String> {
    if !path.exists() {
        return Ok(0);
    }

    let mut total = 0u64;

    let entries = fs::read_dir(path)
        .map_err(|error| error.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();

        if path.is_file() {
            total = total.saturating_add(
                entry
                    .metadata()
                    .map_err(|error| error.to_string())?
                    .len(),
            );
        } else if path.is_dir() {
            total = total.saturating_add(directory_size(&path)?);
        }
    }

    Ok(total)
}

#[tauri::command]
pub fn get_storage_info(
    app: tauri::AppHandle,
) -> Result<StorageInfo, String> {
    let app_data_path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;

    let documents_path = app_data_path
        .join("storage")
        .join("documents");

    let database_path = app_data_path
        .join("financeos.db");

    let documents_size = directory_size(&documents_path)?;

    let database_size = if database_path.is_file() {
        fs::metadata(&database_path)
            .map_err(|error| error.to_string())?
            .len()
    } else {
        0
    };

    Ok(StorageInfo {
        app_data_path: app_data_path.to_string_lossy().into_owned(),
        documents_path: documents_path.to_string_lossy().into_owned(),
        documents_size,
        database_path: database_path.to_string_lossy().into_owned(),
        database_size,
    })
}

#[tauri::command]
pub fn open_storage_folder(
    app: tauri::AppHandle,
    folder: String,
) -> Result<(), String> {
    let app_data_path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;

    let target = match folder.as_str() {
        "appData" => app_data_path,
        "documents" => app_data_path.join("storage").join("documents"),
        "database" => app_data_path,
        _ => return Err("Invalid storage folder.".to_string()),
    };

    if !target.exists() {
        return Err(format!(
            "Storage location does not exist: {}",
            target.display()
        ));
    }

    std::process::Command::new("explorer.exe")
        .arg(target)
        .spawn()
        .map_err(|error| error.to_string())?;

    Ok(())
}
