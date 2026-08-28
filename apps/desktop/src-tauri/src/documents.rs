use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::Manager;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredDocumentFile {
    pub file_path: String,
    pub file_size: u64,
    pub checksum: String,
}

fn storage_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;

    Ok(app_data.join("storage").join("documents"))
}

#[tauri::command]
pub async fn store_document_file(
    app: tauri::AppHandle,
    source_path: String,
    document_id: String,
) -> Result<StoredDocumentFile, String> {
    let source_path = PathBuf::from(source_path);

    if !source_path.is_file() {
        return Err("Selected file does not exist.".to_string());
    }

    let root = storage_root(&app)?;

    std::fs::create_dir_all(&root)
        .map_err(|error| error.to_string())?;

    let source = std::fs::read(&source_path)
        .map_err(|error| error.to_string())?;

    let checksum = format!("{:x}", Sha256::digest(&source));

    let extension = source_path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| format!(".{}", extension))
        .unwrap_or_default();

    let stored_name = format!("{}{}", document_id, extension);
    let destination = root.join(stored_name);

    std::fs::write(&destination, &source)
        .map_err(|error| error.to_string())?;

    Ok(StoredDocumentFile {
        file_path: destination.to_string_lossy().into_owned(),
        file_size: source.len() as u64,
        checksum,
    })
}

#[tauri::command]
pub async fn delete_document_file(
    app: tauri::AppHandle,
    document_id: String,
) -> Result<(), String> {
    let root = storage_root(&app)?;

    let mut entries = std::fs::read_dir(&root)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                String::new()
            } else {
                error.to_string()
            }
        })?;

    loop {
        let entry = match entries.next() {
            Some(Ok(entry)) => entry,
            Some(Err(error)) => return Err(error.to_string()),
            None => break,
        };

        let path = entry.path();

        if !path.is_file() {
            continue;
        }

        let matches = path
            .file_stem()
            .and_then(|name| name.to_str())
            .map(|name| name == document_id)
            .unwrap_or(false);

        if matches {
            std::fs::remove_file(path)
                .map_err(|error| error.to_string())?;

            break;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn open_document_file(
    file_path: String,
) -> Result<(), String> {
    let path = PathBuf::from(&file_path);

    if !path.is_file() {
        return Err("Stored document file does not exist.".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &file_path])
            .spawn()
            .map_err(|error| error.to_string())?;

        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&file_path)
            .spawn()
            .map_err(|error| error.to_string())?;

        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&file_path)
            .spawn()
            .map_err(|error| error.to_string())?;

        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Opening documents is not supported on this platform.".to_string())
}




