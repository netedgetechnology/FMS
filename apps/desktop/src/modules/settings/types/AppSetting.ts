export type AppSettingValueType =
    | "STRING"
    | "NUMBER"
    | "BOOLEAN"
    | "JSON";

export interface AppSetting {
    key: string;
    value: string | null;
    valueType: AppSettingValueType;
    updatedAt: string;
}
