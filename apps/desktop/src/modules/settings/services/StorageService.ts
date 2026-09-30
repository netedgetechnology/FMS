import { invoke } from "@tauri-apps/api/core";

import { StorageInfo } from "../types";

export type StorageFolder = "appData" | "documents" | "database";

export class StorageService {
    async getInfo(): Promise<StorageInfo> {
        return await invoke<StorageInfo>("get_storage_info");
    }

    async openFolder(folder: StorageFolder): Promise<void> {
        await invoke("open_storage_folder", { folder });
    }
}
