import { useCallback, useEffect, useState } from "react";

import { SettingsService } from "../services";
import {
    DEFAULT_SETTINGS,
    SETTING_KEYS,
} from "../constants";

export type SettingsFormState = {
    workspaceName: string;
    defaultCurrency: string;
    dateFormat: string;
    firstDayOfWeek: string;
    theme: string;
    compactMode: boolean;
    showDecimals: boolean;
};

const settingsService = new SettingsService();

const initialState: SettingsFormState = {
    workspaceName: DEFAULT_SETTINGS[SETTING_KEYS.WORKSPACE_NAME],
    defaultCurrency: DEFAULT_SETTINGS[SETTING_KEYS.DEFAULT_CURRENCY],
    dateFormat: DEFAULT_SETTINGS[SETTING_KEYS.DATE_FORMAT],
    firstDayOfWeek: DEFAULT_SETTINGS[SETTING_KEYS.FIRST_DAY_OF_WEEK],
    theme: DEFAULT_SETTINGS[SETTING_KEYS.THEME],
    compactMode: false,
    showDecimals: true,
};

export function useSettings() {
    const [settings, setSettings] =
        useState<SettingsFormState>(initialState);
    const [loading, setLoading] = useState(true);
    const [savingKey, setSavingKey] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const loadSettings = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);

            const rows = await settingsService.getAll();
            const values = new Map(
                rows.map((setting) => [setting.key, setting.value]),
            );

            setSettings({
                workspaceName:
                    values.get(SETTING_KEYS.WORKSPACE_NAME) ??
                    initialState.workspaceName,

                defaultCurrency:
                    values.get(SETTING_KEYS.DEFAULT_CURRENCY) ??
                    initialState.defaultCurrency,

                dateFormat:
                    values.get(SETTING_KEYS.DATE_FORMAT) ??
                    initialState.dateFormat,

                firstDayOfWeek:
                    values.get(SETTING_KEYS.FIRST_DAY_OF_WEEK) ??
                    initialState.firstDayOfWeek,

                theme:
                    values.get(SETTING_KEYS.THEME) ??
                    initialState.theme,

                compactMode:
                    values.get(SETTING_KEYS.COMPACT_MODE) === "true",

                showDecimals:
                    values.get(SETTING_KEYS.SHOW_DECIMALS) !== "false",
            });
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Unable to load settings.",
            );
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadSettings();
    }, [loadSettings]);

    const save = async (
        key: string,
        value: string,
        valueType: "STRING" | "BOOLEAN" = "STRING",
    ) => {
        try {
            setSavingKey(key);
            setError(null);

            await settingsService.set(
                key,
                value,
                valueType,
            );
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Unable to save setting.",
            );

            throw err;
        } finally {
            setSavingKey(null);
        }
    };

    const updateText = async (
        key: string,
        value: string,
        field: keyof SettingsFormState,
    ) => {
        setSettings((current) => ({
            ...current,
            [field]: value,
        }));

        await save(key, value);
    };

    const updateBoolean = async (
        key: string,
        value: boolean,
        field: keyof SettingsFormState,
    ) => {
        setSettings((current) => ({
            ...current,
            [field]: value,
        }));

        await save(
            key,
            String(value),
            "BOOLEAN",
        );
    };

    return {
        settings,
        loading,
        savingKey,
        error,
        updateText,
        updateBoolean,
        reload: loadSettings,
    };
}


