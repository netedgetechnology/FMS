use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

// ---------------------------------------------------------------------
// Automatic local FinWea backup - one complete backup per calendar day.
//
// Layout produced under the destination directory (D:\FinWea_Backup):
//
//   FinWea_<YYYY-MM-DD_HHMM>/
//       financeos.db     complete SQLite snapshot - schema, indexes and
//                        every committed row. Written by the FRONTEND
//                        via `VACUUM INTO` on the live connection, so it
//                        is transactionally consistent (never a raw copy
//                        of the in-use file).
//       documents/       complete copy of FinWea's document attachment
//                        storage, directory structure preserved.
//       RESTORE.txt      human-readable restore mapping.
//
// RESTORE MAPPING (restore is not automated yet - documented so a future
// restore flow is unambiguous):
//
//   <backup>/financeos.db  ->  FinWea live database
//                              (Tauri app config dir)/financeos.db
//   <backup>/documents/*   ->  FinWea document storage
//                              (Tauri app data dir)/storage/documents/*
//
// A backup is published ATOMICALLY: it is built inside a sibling
// "<name>.partial" directory and `rename`d into place only once the
// database snapshot AND the document copy have both succeeded. A
// ".partial" directory therefore always denotes an incomplete/failed
// attempt - it is never counted as the day's backup and never retained;
// stale ones are swept at the start of the next run.
// ---------------------------------------------------------------------

const BACKUP_PREFIX: &str = "FinWea_";
const PARTIAL_SUFFIX: &str = ".partial";
const DATABASE_FILE: &str = "financeos.db";
const DOCUMENTS_DIR: &str = "documents";
const RESTORE_NOTE_FILE: &str = "RESTORE.txt";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginBackupPlan {
    /// `false` when a *completed* backup folder for the current calendar
    /// day already exists. Restart-safe: the check is against folders on
    /// disk, not in-memory state.
    pub should_run: bool,
    /// Directory the frontend must `VACUUM INTO
    /// <staging_dir>/financeos.db` (created by this call). Forward-slashed.
    pub staging_dir: String,
    /// Final directory the completed backup is published to.
    pub final_dir: String,
    /// `<staging_dir>/financeos.db`, forward-slashed and ready to embed
    /// in a `VACUUM INTO` string literal.
    pub database_target: String,
}

/// True only for a *completed* automatic backup folder name, e.g.
/// `FinWea_2026-09-10_2100` (exactly `FinWea_YYYY-MM-DD_HHMM`).
///
/// Deliberately strict so the daily check and retention never match a
/// manual backup (`FinanceOS_Backup_*`), a `.partial` attempt, a stray
/// file, or any other unrelated entry.
fn is_automatic_backup_dir_name(name: &str) -> bool {
    let Some(rest) = name.strip_prefix(BACKUP_PREFIX) else {
        return false;
    };

    let bytes = rest.as_bytes();

    bytes.len() == 15
        && bytes[0..4].iter().all(u8::is_ascii_digit)
        && bytes[4] == b'-'
        && bytes[5..7].iter().all(u8::is_ascii_digit)
        && bytes[7] == b'-'
        && bytes[8..10].iter().all(u8::is_ascii_digit)
        && bytes[10] == b'_'
        && bytes[11..15].iter().all(u8::is_ascii_digit)
}

/// Given the folder names present in the destination and how many to
/// keep, return the automatic-backup names to delete, oldest first.
///
/// Pure - no filesystem access. Non-automatic names are ignored
/// entirely, so nothing outside our own backups can ever be selected.
fn retention_victims(names: &[String], keep: usize) -> Vec<String> {
    let mut automatic: Vec<&String> = names
        .iter()
        .filter(|name| is_automatic_backup_dir_name(name))
        .collect();

    // The `FinWea_YYYY-MM-DD_HHMM` name sorts chronologically.
    automatic.sort();

    if automatic.len() <= keep {
        return Vec::new();
    }

    automatic[..automatic.len() - keep]
        .iter()
        .map(|name| (*name).clone())
        .collect()
}

/// Recursively copy `source` into `destination`, preserving structure.
///
/// A missing `source` is a successful no-op - FinWea may simply have no
/// document attachments yet. Regular files and directories only;
/// anything else (symlinks, devices) is skipped.
fn copy_tree(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }

    fs::create_dir_all(destination).map_err(|error| {
        format!("create {}: {error}", destination.display())
    })?;

    for entry in fs::read_dir(source)
        .map_err(|error| format!("read {}: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type =
            entry.file_type().map_err(|error| error.to_string())?;
        let from = entry.path();
        let to = destination.join(entry.file_name());

        if file_type.is_dir() {
            copy_tree(&from, &to)?;
        } else if file_type.is_file() {
            fs::copy(&from, &to).map_err(|error| {
                format!("copy {}: {error}", from.display())
            })?;
        }
    }

    Ok(())
}

/// Best-effort removal of leftover `FinWea_*.partial` attempt
/// directories directly under `destination`. Never touches anything
/// that is not one of our own partial attempts.
fn sweep_partials(destination: &Path) {
    let Ok(entries) = fs::read_dir(destination) else {
        return;
    };

    for entry in entries.filter_map(Result::ok) {
        let name = entry.file_name().to_string_lossy().to_string();

        if name.starts_with(BACKUP_PREFIX)
            && name.ends_with(PARTIAL_SUFFIX)
            && entry.file_type().map(|t| t.is_dir()).unwrap_or(false)
        {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

/// Delete automatic backups older than the newest `keep`. Automatic
/// backups only; only direct children of `destination`; never anything
/// else and never anything outside `destination`.
fn prune_retention(destination: &Path, keep: usize) {
    let Ok(entries) = fs::read_dir(destination) else {
        return;
    };

    let names: Vec<String> = entries
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_type().map(|t| t.is_dir()).unwrap_or(false)
        })
        .map(|entry| {
            entry.file_name().to_string_lossy().to_string()
        })
        .collect();

    for victim in retention_victims(&names, keep) {
        let path = destination.join(&victim);

        // Double-guard: a direct child of `destination`, matching our
        // strict pattern, and nothing else.
        if is_automatic_backup_dir_name(&victim)
            && path.parent() == Some(destination)
        {
            let _ = fs::remove_dir_all(&path);
        }
    }
}

/// The document attachment storage directory. MUST match
/// `documents.rs::storage_root` - FinWea's document-storage owner.
fn documents_source(
    app: &tauri::AppHandle,
) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("storage")
        .join(DOCUMENTS_DIR))
}

fn restore_note() -> String {
    format!(
        "FinWea automatic local backup\n\
         Created: {created}\n\
         \n\
         Contents\n\
         --------\n\
         {db}    Complete SQLite database snapshot: schema, indexes and\n\
         {pad}   every committed row (SQLite VACUUM INTO of the live DB).\n\
         {docs}/     Complete copy of FinWea's document attachment storage,\n\
         {pad}   directory structure preserved. Absent only if FinWea has\n\
         {pad}   no attachments.\n\
         \n\
         Restore mapping (restore is not automated yet)\n\
         ---------------------------------------------\n\
         {db}    ->  FinWea live database:     <app config dir>/financeos.db\n\
         {docs}/*    ->  FinWea document storage:  <app data dir>/storage/documents/*\n\
         \n\
         Replace the live files with these copies while FinWea is closed.\n",
        created = chrono::Local::now().to_rfc3339(),
        db = DATABASE_FILE,
        docs = DOCUMENTS_DIR,
        pad = " ".repeat(DATABASE_FILE.len()),
    )
}

/// Step 1 of the automatic daily backup.
///
/// Filesystem only - performs NO database access:
///  - creates `destination_path` (recursively) if missing,
///  - sweeps leftover `*.partial` attempt folders,
///  - reports whether a completed backup for today already exists
///    (disk-based, so it survives restarts / multiple launches),
///  - when a backup is due, creates a fresh `<name>.partial` staging
///    folder for the frontend to `VACUUM INTO`.
#[tauri::command]
pub fn begin_daily_backup(
    destination_path: String,
) -> Result<BeginBackupPlan, String> {
    let destination = PathBuf::from(&destination_path);

    fs::create_dir_all(&destination).map_err(|error| {
        format!(
            "Could not create backup folder '{}': {error}",
            destination.display()
        )
    })?;

    // Clear leftovers from a previous crash / failed attempt first.
    sweep_partials(&destination);

    let now = chrono::Local::now();
    let today_prefix = format!(
        "{BACKUP_PREFIX}{}_",
        now.format("%Y-%m-%d")
    );

    let already_today = fs::read_dir(&destination)
        .map_err(|error| {
            format!("Could not read backup folder: {error}")
        })?
        .filter_map(Result::ok)
        .any(|entry| {
            let name =
                entry.file_name().to_string_lossy().to_string();

            name.starts_with(&today_prefix)
                && is_automatic_backup_dir_name(&name)
                && entry
                    .file_type()
                    .map(|t| t.is_dir())
                    .unwrap_or(false)
        });

    let folder = format!(
        "{BACKUP_PREFIX}{}",
        now.format("%Y-%m-%d_%H%M")
    );
    let final_dir = destination.join(&folder);
    let staging_dir =
        destination.join(format!("{folder}{PARTIAL_SUFFIX}"));

    if !already_today {
        if staging_dir.exists() {
            let _ = fs::remove_dir_all(&staging_dir);
        }

        fs::create_dir_all(&staging_dir).map_err(|error| {
            format!("Could not create staging folder: {error}")
        })?;
    }

    let fslash =
        |path: &Path| path.to_string_lossy().replace('\\', "/");

    Ok(BeginBackupPlan {
        should_run: !already_today,
        staging_dir: fslash(&staging_dir),
        final_dir: fslash(&final_dir),
        database_target: fslash(&staging_dir.join(DATABASE_FILE)),
    })
}

/// Step 3 of the automatic daily backup.
///
/// `staging_dir` and `final_dir` are the values returned by
/// `begin_daily_backup` (siblings; `staging_dir` ends with `.partial`).
///
///  - `succeeded == false`: the database snapshot failed - remove the
///    `.partial` staging folder and return. Today's backup is NOT
///    marked done, so the next launch retries.
///  - `succeeded == true`: verify the snapshot, copy the document
///    storage into it, write `RESTORE.txt`, atomically rename
///    `<name>.partial` -> `<name>`, then prune to the newest `keep`
///    automatic backups.
///
/// Everything happens inside `final_dir.parent()` (the backup
/// destination); this command never touches anything outside it.
#[tauri::command]
pub fn finalize_daily_backup(
    app: tauri::AppHandle,
    staging_dir: String,
    final_dir: String,
    succeeded: bool,
    keep: usize,
) -> Result<(), String> {
    let staging = PathBuf::from(&staging_dir);
    let final_dir = PathBuf::from(&final_dir);

    let destination = final_dir
        .parent()
        .ok_or_else(|| "Invalid backup path.".to_string())?
        .to_path_buf();

    // Safety: staging must be a sibling `.partial` of the final folder.
    let staging_is_valid = staging.parent() == Some(destination.as_path())
        && staging
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| {
                name.starts_with(BACKUP_PREFIX)
                    && name.ends_with(PARTIAL_SUFFIX)
            })
            .unwrap_or(false);

    if !staging_is_valid {
        return Err(
            "Refusing to finalize: unexpected staging path.".to_string()
        );
    }

    if !succeeded {
        if staging.exists() {
            let _ = fs::remove_dir_all(&staging);
        }
        return Ok(());
    }

    // The database snapshot the frontend says it wrote.
    let db_file = staging.join(DATABASE_FILE);
    let db_ok = fs::metadata(&db_file)
        .map(|meta| meta.len() > 0)
        .unwrap_or(false);

    if !db_ok {
        let _ = fs::remove_dir_all(&staging);
        return Err(
            "Database snapshot is missing or empty.".to_string()
        );
    }

    // Complete document copy (missing source is fine).
    let docs_source = documents_source(&app)?;

    if let Err(error) =
        copy_tree(&docs_source, &staging.join(DOCUMENTS_DIR))
    {
        let _ = fs::remove_dir_all(&staging);
        return Err(format!(
            "Could not copy document storage: {error}"
        ));
    }

    let _ =
        fs::write(staging.join(RESTORE_NOTE_FILE), restore_note());

    // Publish atomically.
    if final_dir.exists() {
        // Should not happen (dedup covers it) - do not clobber.
        let _ = fs::remove_dir_all(&staging);
        return Ok(());
    }

    fs::rename(&staging, &final_dir).map_err(|error| {
        let _ = fs::remove_dir_all(&staging);
        format!("Could not publish backup folder: {error}")
    })?;

    prune_retention(&destination, keep);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();

        let dir = std::env::temp_dir()
            .join(format!("finwea_backup_test_{tag}_{nanos}"));

        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn recognises_only_completed_automatic_backup_folders() {
        assert!(is_automatic_backup_dir_name("FinWea_2026-09-10_2100"));
        assert!(is_automatic_backup_dir_name("FinWea_2026-01-01_0000"));

        assert!(!is_automatic_backup_dir_name(
            "FinWea_2026-09-10_2100.partial"
        ));
        assert!(!is_automatic_backup_dir_name("FinWea_2026-09-10"));
        assert!(!is_automatic_backup_dir_name("FinWea_2026-9-10_2100"));
        assert!(!is_automatic_backup_dir_name(
            "FinWea_2026-09-10_2100x"
        ));
        assert!(!is_automatic_backup_dir_name(
            "FinanceOS_Backup_20260910_210000"
        ));
        assert!(!is_automatic_backup_dir_name("anything-else"));
    }

    #[test]
    fn retention_selects_oldest_and_ignores_foreign_entries() {
        let names = vec![
            "FinWea_2026-09-01_1000".to_string(),
            "FinWea_2026-09-02_1000".to_string(),
            "FinWea_2026-09-03_1000".to_string(),
            "FinWea_2026-09-04_1000".to_string(),
            "FinanceOS_Backup_20260905_100000".to_string(),
            "notes.txt".to_string(),
            "FinWea_2026-09-05_1000.partial".to_string(),
        ];

        assert_eq!(
            retention_victims(&names, 2),
            vec![
                "FinWea_2026-09-01_1000".to_string(),
                "FinWea_2026-09-02_1000".to_string(),
            ]
        );
    }

    #[test]
    fn retention_keeps_everything_within_the_limit() {
        let names = vec![
            "FinWea_2026-09-01_1000".to_string(),
            "FinWea_2026-09-02_1000".to_string(),
        ];

        assert!(retention_victims(&names, 30).is_empty());
    }

    #[test]
    fn prune_retention_removes_only_old_automatic_backups_in_destination() {
        let dest = scratch("prune");

        for name in [
            "FinWea_2026-09-01_1000",
            "FinWea_2026-09-02_1000",
            "FinWea_2026-09-03_1000",
            "FinanceOS_Backup_20260904_120000",
        ] {
            fs::create_dir_all(dest.join(name)).unwrap();
        }
        fs::write(dest.join("keep-me.txt"), b"x").unwrap();

        prune_retention(&dest, 1);

        assert!(!dest.join("FinWea_2026-09-01_1000").exists());
        assert!(!dest.join("FinWea_2026-09-02_1000").exists());
        assert!(dest.join("FinWea_2026-09-03_1000").exists());
        assert!(dest
            .join("FinanceOS_Backup_20260904_120000")
            .exists());
        assert!(dest.join("keep-me.txt").exists());

        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn copy_tree_preserves_directory_structure() {
        let root = scratch("copy");
        let src = root.join("src");
        let dst = root.join("dst");

        fs::create_dir_all(src.join("a/b")).unwrap();
        fs::write(src.join("top.txt"), b"1").unwrap();
        fs::write(src.join("a/mid.txt"), b"2").unwrap();
        fs::write(src.join("a/b/deep.txt"), b"3").unwrap();

        copy_tree(&src, &dst).unwrap();

        assert_eq!(fs::read(dst.join("top.txt")).unwrap(), b"1");
        assert_eq!(fs::read(dst.join("a/mid.txt")).unwrap(), b"2");
        assert_eq!(
            fs::read(dst.join("a/b/deep.txt")).unwrap(),
            b"3"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn copy_tree_missing_source_succeeds_and_creates_nothing() {
        let root = scratch("copy_missing");
        let dst = root.join("dst");

        copy_tree(&root.join("does-not-exist"), &dst).unwrap();

        assert!(!dst.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn sweep_partials_removes_only_finwea_partial_directories() {
        let dest = scratch("sweep");

        fs::create_dir_all(
            dest.join("FinWea_2026-09-10_2100.partial"),
        )
        .unwrap();
        fs::create_dir_all(dest.join("FinWea_2026-09-10_2100"))
            .unwrap();
        fs::create_dir_all(dest.join("Other_x.partial")).unwrap();
        fs::write(dest.join("a-file.partial"), b"x").unwrap();

        sweep_partials(&dest);

        assert!(!dest
            .join("FinWea_2026-09-10_2100.partial")
            .exists());
        assert!(dest.join("FinWea_2026-09-10_2100").exists());
        assert!(dest.join("Other_x.partial").exists());
        assert!(dest.join("a-file.partial").exists());

        let _ = fs::remove_dir_all(&dest);
    }
}
