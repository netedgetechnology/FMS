import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";

import { SettingsService, StorageService } from "../services";
import {
    DEFAULT_SETTINGS,
    SETTING_KEYS,
} from "../constants";
import type { StorageInfo } from "../types";

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
const storageService = new StorageService();

function applyCompactMode(enabled: boolean) {
    document.documentElement.classList.toggle("compact-mode", enabled);
}

const initialState: SettingsFormState = {
    workspaceName: DEFAULT_SETTINGS[SETTING_KEYS.WORKSPACE_NAME],
    defaultCurrency: DEFAULT_SETTINGS[SETTING_KEYS.DEFAULT_CURRENCY],
    dateFormat: DEFAULT_SETTINGS[SETTING_KEYS.DATE_FORMAT],
    firstDayOfWeek: DEFAULT_SETTINGS[SETTING_KEYS.FIRST_DAY_OF_WEEK],
    theme: DEFAULT_SETTINGS[SETTING_KEYS.THEME],
    compactMode: false,
    showDecimals: true,
};

function toNextTheme(theme: string): "light" | "dark" | "system" {
    if (theme === "Dark") {
        return "dark";
    }

    if (theme === "Light") {
        return "light";
    }

    return "system";
}

export function useSettings() {
    const { setTheme } = useTheme();

    const [settings, setSettings] =
        useState<SettingsFormState>(initialState);

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);

    const openStorageFolder = useCallback(
        async (folder: "appData" | "documents" | "database") => {
            try {
                setError(null);
                await storageService.openFolder(folder);
            } catch (err) {
                setError(
                    err instanceof Error
                        ? err.message
                        : "Unable to open storage folder.",
                );
            }
        },
        [],
    );

    const loadSettings = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);

            const [rows, storage] = await Promise.all([
                settingsService.getAll(),
                storageService.getInfo(),
            ]);

            setStorageInfo(storage);

            const values = new Map(
                rows.map((setting) => [setting.key, setting.value]),
            );

            const loadedSettings: SettingsFormState = {
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
            };

            setSettings(loadedSettings);

            // The persisted theme is applied by the theme synchronization effect.

            setSaved(true);

            window.dispatchEvent(
                new Event("financeos-settings-changed"),
            );
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

    useEffect(() => {
        if (!loading) {
            setTheme(toNextTheme(settings.theme));
        }
    }, [loading, settings.theme, setTheme]);

    const refreshStorageInfo = useCallback(async () => {
        try {
            const storage = await storageService.getInfo();
            setStorageInfo(storage);
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Unable to load storage information.",
            );
        }
    }, []);

    const updateText = (
        field: keyof SettingsFormState,
        value: string,
    ) => {
        setSettings((current) => ({
            ...current,
            [field]: value,
        }));

        if (field === "theme") {
            setTheme(toNextTheme(value));
        }

        setSaved(false);
        setError(null);
    };

    const updateBoolean = (
        field: keyof SettingsFormState,
        value: boolean,
    ) => {
        setSettings((current) => ({
            ...current,
            [field]: value,
        }));

        if (field === "compactMode") {
            applyCompactMode(value);
        }

        setSaved(false);
        setError(null);
    };

    const resetToDefaults = async () => {
        const defaults: SettingsFormState = {
            workspaceName: String(DEFAULT_SETTINGS[SETTING_KEYS.WORKSPACE_NAME]),
            defaultCurrency: String(DEFAULT_SETTINGS[SETTING_KEYS.DEFAULT_CURRENCY]),
            dateFormat: String(DEFAULT_SETTINGS[SETTING_KEYS.DATE_FORMAT]),
            firstDayOfWeek: String(DEFAULT_SETTINGS[SETTING_KEYS.FIRST_DAY_OF_WEEK]),
            theme: String(DEFAULT_SETTINGS[SETTING_KEYS.THEME]),
            compactMode: String(DEFAULT_SETTINGS[SETTING_KEYS.COMPACT_MODE]) === "true",
            showDecimals: String(DEFAULT_SETTINGS[SETTING_KEYS.SHOW_DECIMALS]) !== "false",
        };

        setSettings(defaults);
        setTheme(toNextTheme(defaults.theme));
        applyCompactMode(defaults.compactMode);
        setSaved(false);
        setError(null);

        try {
            setSaving(true);

            await settingsService.set(SETTING_KEYS.WORKSPACE_NAME, defaults.workspaceName, "STRING");
            await settingsService.set(SETTING_KEYS.DEFAULT_CURRENCY, defaults.defaultCurrency, "STRING");
            await settingsService.set(SETTING_KEYS.DATE_FORMAT, defaults.dateFormat, "STRING");
            await settingsService.set(SETTING_KEYS.FIRST_DAY_OF_WEEK, defaults.firstDayOfWeek, "STRING");
            await settingsService.set(SETTING_KEYS.THEME, defaults.theme, "STRING");
            await settingsService.set(SETTING_KEYS.COMPACT_MODE, String(defaults.compactMode), "BOOLEAN");
            await settingsService.set(SETTING_KEYS.SHOW_DECIMALS, String(defaults.showDecimals), "BOOLEAN");

            setSaved(true);

            window.dispatchEvent(
                new Event("financeos-settings-changed"),
            );
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Unable to reset settings.",
            );
        } finally {
            setSaving(false);
        }
    };
    const saveSettings = async () => {
        try {
            setSaving(true);
            setError(null);

            await settingsService.set(
                SETTING_KEYS.WORKSPACE_NAME,
                settings.workspaceName,
                "STRING",
            );

            await settingsService.set(
                SETTING_KEYS.DEFAULT_CURRENCY,
                settings.defaultCurrency,
                "STRING",
            );

            await settingsService.set(
                SETTING_KEYS.DATE_FORMAT,
                settings.dateFormat,
                "STRING",
            );

            await settingsService.set(
                SETTING_KEYS.FIRST_DAY_OF_WEEK,
                settings.firstDayOfWeek,
                "STRING",
            );

            await settingsService.set(
                SETTING_KEYS.THEME,
                settings.theme,
                "STRING",
            );

            await settingsService.set(
                SETTING_KEYS.COMPACT_MODE,
                String(settings.compactMode),
                "BOOLEAN",
            );

            await settingsService.set(
                SETTING_KEYS.SHOW_DECIMALS,
                String(settings.showDecimals),
                "BOOLEAN",
            );

            setTheme(toNextTheme(settings.theme));

            setSaved(true);

            window.dispatchEvent(
                new Event("financeos-settings-changed"),
            );
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Unable to save settings.",
            );
        } finally {
            setSaving(false);
        }
    };

    return {
        settings,
        loading,
        saving,
        saved,
        error,
        updateText,
        updateBoolean,
        saveSettings,
        resetToDefaults,
        reload: loadSettings,
        storageInfo,
        refreshStorageInfo,
        openStorageFolder,
    };
}









