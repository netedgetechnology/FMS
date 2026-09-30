use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
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

/// Removes the stored file for `document_id` from `root`, if any. A
/// missing `root` (nothing has ever been stored) or a missing matching
/// file are both treated as a no-op, not a failure.
fn delete_document_file_in(
    root: &Path,
    document_id: &str,
) -> Result<(), String> {
    // No file has ever been stored, so there is nothing to remove - this
    // is a no-op, not a failure. `.map_err()` only replaces the error
    // value; it does not turn the Result into `Ok`, so returning early
    // here (rather than falling through to `?`) is required to avoid
    // still propagating an `Err` for a directory that simply doesn't
    // exist yet.
    let mut entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(());
        }
        Err(error) => return Err(error.to_string()),
    };

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
pub async fn delete_document_file(
    app: tauri::AppHandle,
    document_id: String,
) -> Result<(), String> {
    let root = storage_root(&app)?;

    delete_document_file_in(&root, &document_id)
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch_root(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();

        std::env::temp_dir()
            .join(format!("finwea_documents_test_{tag}_{nanos}"))
    }

    #[test]
    fn is_a_no_op_when_the_storage_directory_has_never_been_created() {
        // Regression test: a directory-not-found error used to still
        // propagate as `Err("")` here (`.map_err()` only replaces the
        // error value, it never turns the Result into `Ok`), which
        // permanently blocked every document delete on a fresh install
        // or after the storage folder was cleared, until the very
        // first file was ever stored.
        let root = scratch_root("missing_dir");
        assert!(!root.exists());

        let result = delete_document_file_in(&root, "doc-1");

        assert!(result.is_ok());
    }

    #[test]
    fn is_a_no_op_when_the_directory_exists_but_has_no_matching_file() {
        let root = scratch_root("no_match");
        std::fs::create_dir_all(&root).unwrap();

        let result = delete_document_file_in(&root, "doc-1");

        assert!(result.is_ok());

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn removes_the_file_matching_the_document_id_by_stem() {
        let root = scratch_root("match");
        std::fs::create_dir_all(&root).unwrap();

        let target = root.join("doc-1.pdf");
        std::fs::write(&target, b"pdf bytes").unwrap();

        let unrelated = root.join("doc-2.pdf");
        std::fs::write(&unrelated, b"other bytes").unwrap();

        let result = delete_document_file_in(&root, "doc-1");

        assert!(result.is_ok());
        assert!(!target.exists());
        assert!(unrelated.exists());

        std::fs::remove_dir_all(&root).ok();
    }
}

