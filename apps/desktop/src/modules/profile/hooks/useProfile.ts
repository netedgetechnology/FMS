import { useCallback, useEffect, useState } from "react";

import { SettingsService } from "@/modules/settings/services";
import { DEFAULT_SETTINGS, SETTING_KEYS } from "@/modules/settings/constants";

export type ProfileFormState = {
    avatar: string;
    fullName: string;
    displayName: string;
    email: string;
    phone: string;
    dateOfBirth: string;
    address: string;
    city: string;
    country: string;
};

export type ProfileAccountInfo = {
    createdAt: string | null;
    lastUpdated: string | null;
    status: "Active";
};

const settingsService = new SettingsService();

const PROFILE_TRACKED_KEYS: string[] = [
    SETTING_KEYS.PROFILE_AVATAR,
    SETTING_KEYS.PROFILE_FULL_NAME,
    SETTING_KEYS.WORKSPACE_NAME,
    SETTING_KEYS.PROFILE_EMAIL,
    SETTING_KEYS.PROFILE_PHONE,
    SETTING_KEYS.PROFILE_DATE_OF_BIRTH,
    SETTING_KEYS.PROFILE_ADDRESS,
    SETTING_KEYS.PROFILE_CITY,
    SETTING_KEYS.PROFILE_COUNTRY,
];

const initialState: ProfileFormState = {
    avatar: DEFAULT_SETTINGS[SETTING_KEYS.PROFILE_AVATAR],
    fullName: DEFAULT_SETTINGS[SETTING_KEYS.PROFILE_FULL_NAME],
    displayName: DEFAULT_SETTINGS[SETTING_KEYS.WORKSPACE_NAME],
    email: DEFAULT_SETTINGS[SETTING_KEYS.PROFILE_EMAIL],
    phone: DEFAULT_SETTINGS[SETTING_KEYS.PROFILE_PHONE],
    dateOfBirth: DEFAULT_SETTINGS[SETTING_KEYS.PROFILE_DATE_OF_BIRTH],
    address: DEFAULT_SETTINGS[SETTING_KEYS.PROFILE_ADDRESS],
    city: DEFAULT_SETTINGS[SETTING_KEYS.PROFILE_CITY],
    country: DEFAULT_SETTINGS[SETTING_KEYS.PROFILE_COUNTRY],
};

export function useProfile() {
    const [profile, setProfile] = useState<ProfileFormState>(initialState);

    const [account, setAccount] = useState<ProfileAccountInfo>({
        createdAt: null,
        lastUpdated: null,
        status: "Active",
    });

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);

            const rows = await settingsService.getAll();
            const values = new Map(
                rows.map((setting) => [setting.key, setting.value]),
            );

            setProfile({
                avatar:
                    values.get(SETTING_KEYS.PROFILE_AVATAR) ??
                    initialState.avatar,

                fullName:
                    values.get(SETTING_KEYS.PROFILE_FULL_NAME) ??
                    initialState.fullName,

                displayName:
                    values.get(SETTING_KEYS.WORKSPACE_NAME) ??
                    initialState.displayName,

                email:
                    values.get(SETTING_KEYS.PROFILE_EMAIL) ??
                    initialState.email,

                phone:
                    values.get(SETTING_KEYS.PROFILE_PHONE) ??
                    initialState.phone,

                dateOfBirth:
                    values.get(SETTING_KEYS.PROFILE_DATE_OF_BIRTH) ??
                    initialState.dateOfBirth,

                address:
                    values.get(SETTING_KEYS.PROFILE_ADDRESS) ??
                    initialState.address,

                city:
                    values.get(SETTING_KEYS.PROFILE_CITY) ??
                    initialState.city,

                country:
                    values.get(SETTING_KEYS.PROFILE_COUNTRY) ??
                    initialState.country,
            });

            let createdAt = values.get(SETTING_KEYS.PROFILE_CREATED_AT) || null;

            if (!createdAt) {
                createdAt = new Date().toISOString();

                await settingsService.set(
                    SETTING_KEYS.PROFILE_CREATED_AT,
                    createdAt,
                    "STRING",
                );
            }

            const lastUpdated = rows.reduce<string | null>(
                (latest, row) => {
                    if (!PROFILE_TRACKED_KEYS.includes(row.key)) {
                        return latest;
                    }

                    if (!latest || row.updatedAt > latest) {
                        return row.updatedAt;
                    }

                    return latest;
                },
                null,
            );

            setAccount({
                createdAt,
                lastUpdated,
                status: "Active",
            });

            setSaved(true);
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Unable to load profile.",
            );
        } finally {
            setLoading(false);
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

    const updateField = (
        field: keyof ProfileFormState,
        value: string,
    ) => {
        setProfile((current) => ({
            ...current,
            [field]: value,
        }));

        setSaved(false);
        setError(null);
    };

    const saveProfile = async (): Promise<boolean> => {
        try {
            setSaving(true);
            setError(null);

            await settingsService.set(
                SETTING_KEYS.PROFILE_AVATAR,
                profile.avatar,
                "STRING",
            );

            await settingsService.set(
                SETTING_KEYS.PROFILE_FULL_NAME,
                profile.fullName,
                "STRING",
            );

            await settingsService.set(
                SETTING_KEYS.WORKSPACE_NAME,
                profile.displayName,
                "STRING",
            );

            await settingsService.set(
                SETTING_KEYS.PROFILE_EMAIL,
                profile.email,
                "STRING",
            );

            await settingsService.set(
                SETTING_KEYS.PROFILE_PHONE,
                profile.phone,
                "STRING",
            );

            await settingsService.set(
                SETTING_KEYS.PROFILE_DATE_OF_BIRTH,
                profile.dateOfBirth,
                "STRING",
            );

            await settingsService.set(
                SETTING_KEYS.PROFILE_ADDRESS,
                profile.address,
                "STRING",
            );

            await settingsService.set(
                SETTING_KEYS.PROFILE_CITY,
                profile.city,
                "STRING",
            );

            await settingsService.set(
                SETTING_KEYS.PROFILE_COUNTRY,
                profile.country,
                "STRING",
            );

            window.dispatchEvent(
                new Event("financeos-settings-changed"),
            );

            await load();

            return true;
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Unable to save profile.",
            );

            return false;
        } finally {
            setSaving(false);
        }
    };

    return {
        profile,
        account,
        loading,
        saving,
        saved,
        error,
        updateField,
        saveProfile,
        reload: load,
    };
}
