import { useCallback, useEffect, useState } from "react";

import { SettingsService } from "@/modules/settings/services";
import {
    DEFAULT_SETTINGS,
    SETTING_KEYS,
} from "@/modules/settings/constants";

const settingsService = new SettingsService();

export function useDisplaySettings() {
    const [defaultCurrency, setDefaultCurrency] = useState(
        String(DEFAULT_SETTINGS[SETTING_KEYS.DEFAULT_CURRENCY]),
    );

    const [showDecimals, setShowDecimals] = useState(
        String(DEFAULT_SETTINGS[SETTING_KEYS.SHOW_DECIMALS]) !== "false",
    );

    const [dateFormat, setDateFormat] = useState(
        String(DEFAULT_SETTINGS[SETTING_KEYS.DATE_FORMAT]),
    );

    const load = useCallback(async () => {
        try {
            const rows = await settingsService.getAll();

            const currencyValue = rows.find(
                (setting) =>
                    setting.key === SETTING_KEYS.DEFAULT_CURRENCY,
            )?.value;

            const decimalsValue = rows.find(
                (setting) =>
                    setting.key === SETTING_KEYS.SHOW_DECIMALS,
            )?.value;

            const dateFormatValue = rows.find(
                (setting) =>
                    setting.key === SETTING_KEYS.DATE_FORMAT,
            )?.value;

            setDefaultCurrency(
                currencyValue ||
                    String(DEFAULT_SETTINGS[SETTING_KEYS.DEFAULT_CURRENCY]),
            );

            setShowDecimals(decimalsValue !== "false");

            setDateFormat(
                dateFormatValue ||
                    String(DEFAULT_SETTINGS[SETTING_KEYS.DATE_FORMAT]),
            );
        } catch {
            setDefaultCurrency(
                String(DEFAULT_SETTINGS[SETTING_KEYS.DEFAULT_CURRENCY]),
            );

            setShowDecimals(true);

            setDateFormat(
                String(DEFAULT_SETTINGS[SETTING_KEYS.DATE_FORMAT]),
            );
        }
    }, []);

    useEffect(() => {
        void load();

        const handleSettingsChanged = () => {
            void load();
        };

        window.addEventListener(
            "financeos-settings-changed",
            handleSettingsChanged,
        );

        return () => {
            window.removeEventListener(
                "financeos-settings-changed",
                handleSettingsChanged,
            );
        };
    }, [load]);

    return {
        showDecimals,
        defaultCurrency,
        dateFormat,
    };
}
