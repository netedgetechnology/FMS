import { SettingsRepository } from "../repositories";
import { AppSetting, AppSettingValueType } from "../types";

export class SettingsService {
    private readonly repository = new SettingsRepository();

    async getAll(): Promise<AppSetting[]> {
        return await this.repository.getAll();
    }

    async getByKey(key: string): Promise<AppSetting | null> {
        return await this.repository.getByKey(key);
    }

    async getString(
        key: string,
        defaultValue: string,
    ): Promise<string> {
        const setting = await this.repository.getByKey(key);

        return setting?.value ?? defaultValue;
    }

    async set(
        key: string,
        value: string | null,
        valueType: AppSettingValueType = "STRING",
    ): Promise<void> {
        await this.repository.set(
            key,
            value,
            valueType,
        );
    }

    async setString(
        key: string,
        value: string,
    ): Promise<void> {
        await this.repository.set(
            key,
            value,
            "STRING",
        );
    }

    async delete(key: string): Promise<void> {
        await this.repository.delete(key);
    }
}
