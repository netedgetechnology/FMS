import { invoke } from "@tauri-apps/api/core";

import { SQLiteProvider } from "./engine/SQLiteProvider";

/**
 * Fixed local backup destination. Local disk only - no cloud, GitHub or
 * any external service is ever contacted.
 */
export const AUTOMATIC_BACKUP_DIRECTORY = "D:\\FinWea_Backup";

/** Number of daily automatic backup folders to retain (older ones are pruned). */
export const AUTOMATIC_BACKUP_RETENTION = 30;

interface BeginBackupPlan {
    shouldRun: boolean;
    stagingDir: string;
    finalDir: string;
    databaseTarget: string;
}

/** SQL for a consistent SQLite snapshot into `targetPath`. */
export function buildVacuumIntoStatement(targetPath: string): string {
    // `VACUUM INTO` takes a string literal; escape any single quote so a
    // path can never break out of it (Windows paths won't contain one,
    // but this keeps the statement injection-proof regardless).
    const escaped = targetPath.replace(/'/g, "''");

    return `VACUUM INTO '${escaped}'`;
}

/**
 * Automatic, once-per-calendar-day, COMPLETE local backup of FinWea to a
 * timestamped folder under D:\FinWea_Backup, e.g.
 *
 *   D:\FinWea_Backup\FinWea_2026-09-10_2100\
 *       financeos.db    consistent SQLite snapshot - schema, indexes,
 *                       every committed row (VACUUM INTO on the live
 *                       connection; committed WAL data included).
 *       documents\      complete copy of the document attachment
 *                       storage, directory structure preserved.
 *       RESTORE.txt     restore mapping for a future restore flow.
 *
 * Flow:
 *   1. `begin_daily_backup` (Rust): create the destination, sweep stale
 *      "*.partial" folders, decide whether today's backup is still
 *      needed (disk-based, restart-safe), and create a fresh
 *      "<name>.partial" staging folder.
 *   2. `VACUUM INTO <staging>/financeos.db` here, on the live connection.
 *   3. `finalize_daily_backup` (Rust): verify the snapshot, copy the
 *      document storage into the staging folder, write RESTORE.txt,
 *      atomically rename "<name>.partial" -> "<name>", then prune to the
 *      newest AUTOMATIC_BACKUP_RETENTION automatic backups (automatic
 *      backups only, nothing outside D:\FinWea_Backup).
 *
 * A backup only "counts" for the day once step 3 has published the final
 * folder. Any failure removes the ".partial" staging folder (and the day
 * is NOT marked done, so the next launch retries). This function never
 * throws and must not be awaited on the startup path.
 *
 * Restore mapping (documented for a future restore flow - NOT implemented):
 *   backup financeos.db  ->  FinWea live database:    <app config dir>/financeos.db
 *   backup documents/*   ->  FinWea document storage: <app data dir>/storage/documents/*
 */
export async function runDailyDatabaseBackup(): Promise<void> {
    try {
        const plan = await invoke<BeginBackupPlan>(
            "begin_daily_backup",
            { destinationPath: AUTOMATIC_BACKUP_DIRECTORY }
        );

        if (!plan.shouldRun) {
            console.info(
                "[backup] Automatic backup already exists for today - skipping."
            );

            return;
        }

        try {
            await SQLiteProvider.getInstance().execute(
                buildVacuumIntoStatement(plan.databaseTarget)
            );

            await invoke("finalize_daily_backup", {
                stagingDir: plan.stagingDir,
                finalDir: plan.finalDir,
                succeeded: true,
                keep: AUTOMATIC_BACKUP_RETENTION,
            });

            console.info(
                `[backup] Automatic daily backup written: ${plan.finalDir}`
            );
        } catch (error) {
            // Discard the incomplete staging folder. Today's backup is
            // NOT marked done - the next launch retries.
            await invoke("finalize_daily_backup", {
                stagingDir: plan.stagingDir,
                finalDir: plan.finalDir,
                succeeded: false,
                keep: AUTOMATIC_BACKUP_RETENTION,
            }).catch(() => {
                // Best effort. begin_daily_backup also sweeps stale
                // "*.partial" folders on the next run.
            });

            throw error;
        }
    } catch (error) {
        console.error(
            "[backup] Automatic daily backup failed:",
            error
        );
    }
}
