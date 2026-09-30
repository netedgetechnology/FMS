import { invoke } from "@tauri-apps/api/core";

export interface BackupResult {
    backupPath: string;
    fileSize: number;
    checksum: string;
}

export class BackupService {
    async createBackup(destinationPath: string): Promise<BackupResult> {
        return invoke<BackupResult>("create_backup", {
            destinationPath,
        });
    }

    async restoreBackup(backupPath: string): Promise<void> {
        await invoke("restore_backup", {
            backupPath,
        });
    }
}

