import { Repository } from "@/core/database/engine/Repository";

import { AppSetting } from "../types";

export class SettingsRepository extends Repository {
    async getAll(): Promise<AppSetting[]> {
        return await this.select<AppSetting>(
            `
            SELECT
                key,
                value,
                value_type AS valueType,
                updated_at AS updatedAt
            FROM app_settings
            ORDER BY key
            `,
        );
    }

    async getByKey(key: string): Promise<AppSetting | null> {
        const rows = await this.select<AppSetting>(
            `
            SELECT
                key,
                value,
                value_type AS valueType,
                updated_at AS updatedAt
            FROM app_settings
            WHERE key = ?
            `,
            [key],
        );

        return rows[0] ?? null;
    }

    async set(
        key: string,
        value: string | null,
        valueType: AppSetting["valueType"],
    ): Promise<void> {
        await this.execute(
            `
            INSERT INTO app_settings
            (
                key,
                value,
                value_type,
                updated_at
            )
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key)
            DO UPDATE SET
                value = excluded.value,
                value_type = excluded.value_type,
                updated_at = CURRENT_TIMESTAMP
            `,
            [key, value, valueType],
        );
    }

    async delete(key: string): Promise<void> {
        await this.execute(
            `
            DELETE FROM app_settings
            WHERE key = ?
            `,
            [key],
        );
    }
}
