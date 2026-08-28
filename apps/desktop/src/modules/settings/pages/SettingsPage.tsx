import {
    IconCheck,
    IconLoader2,
} from "@tabler/icons-react";

import PageHeader from "@/components/common/PageHeader";
import SectionCard from "@/components/common/SectionCard";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import { useSettings } from "../hooks";
import { SETTING_KEYS } from "../constants";

export default function SettingsPage() {
    const {
        settings,
        loading,
        savingKey,
        error,
        updateText,
        updateBoolean,
    } = useSettings();

    if (loading) {
        return (
            <div>
                <PageHeader
                    title="Settings"
                    subtitle="Manage your FinanceOS preferences and application configuration."
                />

                <div className="flex min-h-[360px] items-center justify-center">
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                        <IconLoader2
                            size={18}
                            className="animate-spin"
                        />
                        Loading settings...
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div>
            <PageHeader
                title="Settings"
                subtitle="Manage your FinanceOS preferences and application configuration."
            />

            {error && (
                <div className="mb-5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                </div>
            )}

            <div className="space-y-5">

                <SectionCard title="General">
                    <div className="space-y-6">

                        <SettingRow
                            title="Workspace name"
                            description="The name used for your personal FinanceOS workspace."
                        >
                            <div className="w-[280px]">
                                <Input
                                    value={settings.workspaceName}
                                    onChange={(event) => {
                                        void updateText(
                                            SETTING_KEYS.WORKSPACE_NAME,
                                            event.target.value,
                                            "workspaceName",
                                        );
                                    }}
                                    className="h-10 rounded-xl"
                                />
                            </div>
                        </SettingRow>

                        <SettingRow
                            title="Default currency"
                            description="Currency used when creating new financial records."
                        >
                            <select
                                value={settings.defaultCurrency}
                                onChange={(event) => {
                                    void updateText(
                                        SETTING_KEYS.DEFAULT_CURRENCY,
                                        event.target.value,
                                        "defaultCurrency",
                                    );
                                }}
                                className="h-10 w-[280px] rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400"
                            >
                                <option value="INR">
                                    INR — Indian Rupee
                                </option>
                                <option value="USD">
                                    USD — US Dollar
                                </option>
                                <option value="EUR">
                                    EUR — Euro
                                </option>
                                <option value="GBP">
                                    GBP — British Pound
                                </option>
                            </select>
                        </SettingRow>

                        <SettingRow
                            title="Date format"
                            description="How dates are displayed throughout FinanceOS."
                        >
                            <select
                                value={settings.dateFormat}
                                onChange={(event) => {
                                    void updateText(
                                        SETTING_KEYS.DATE_FORMAT,
                                        event.target.value,
                                        "dateFormat",
                                    );
                                }}
                                className="h-10 w-[280px] rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400"
                            >
                                <option value="DD/MM/YYYY">
                                    DD/MM/YYYY
                                </option>
                                <option value="MM/DD/YYYY">
                                    MM/DD/YYYY
                                </option>
                                <option value="YYYY-MM-DD">
                                    YYYY-MM-DD
                                </option>
                            </select>
                        </SettingRow>

                        <SettingRow
                            title="First day of week"
                            description="Used by calendars and date-based planning views."
                        >
                            <select
                                value={settings.firstDayOfWeek}
                                onChange={(event) => {
                                    void updateText(
                                        SETTING_KEYS.FIRST_DAY_OF_WEEK,
                                        event.target.value,
                                        "firstDayOfWeek",
                                    );
                                }}
                                className="h-10 w-[280px] rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400"
                            >
                                <option value="Monday">
                                    Monday
                                </option>
                                <option value="Sunday">
                                    Sunday
                                </option>
                            </select>
                        </SettingRow>

                    </div>
                </SectionCard>

                <SectionCard title="Display">
                    <div className="space-y-6">

                        <SettingRow
                            title="Theme"
                            description="Choose how FinanceOS should appear."
                        >
                            <select
                                value={settings.theme}
                                onChange={(event) => {
                                    void updateText(
                                        SETTING_KEYS.THEME,
                                        event.target.value,
                                        "theme",
                                    );
                                }}
                                className="h-10 w-[280px] rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400"
                            >
                                <option value="System">
                                    System default
                                </option>
                                <option value="Light">
                                    Light
                                </option>
                                <option value="Dark">
                                    Dark
                                </option>
                            </select>
                        </SettingRow>

                        <SettingRow
                            title="Compact mode"
                            description="Use tighter spacing in tables and financial lists."
                        >
                            <Switch
                                checked={settings.compactMode}
                                onCheckedChange={(checked) => {
                                    void updateBoolean(
                                        SETTING_KEYS.COMPACT_MODE,
                                        checked,
                                        "compactMode",
                                    );
                                }}
                            />
                        </SettingRow>

                        <SettingRow
                            title="Show decimal places"
                            description="Display cents or paise in monetary amounts."
                        >
                            <Switch
                                checked={settings.showDecimals}
                                onCheckedChange={(checked) => {
                                    void updateBoolean(
                                        SETTING_KEYS.SHOW_DECIMALS,
                                        checked,
                                        "showDecimals",
                                    );
                                }}
                            />
                        </SettingRow>

                    </div>
                </SectionCard>

                <SectionCard title="Settings Status">
                    <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-emerald-600 shadow-sm">
                            {savingKey ? (
                                <IconLoader2
                                    size={17}
                                    className="animate-spin"
                                />
                            ) : (
                                <IconCheck size={17} />
                            )}
                        </div>

                        <div>
                            <div className="text-sm font-semibold text-slate-900">
                                {savingKey
                                    ? "Saving changes..."
                                    : "All changes saved"}
                            </div>

                            <div className="text-xs text-slate-500">
                                Settings are stored locally in FinanceOS.
                            </div>
                        </div>
                    </div>
                </SectionCard>

            </div>
        </div>
    );
}

type SettingRowProps = {
    title: string;
    description: string;
    children: React.ReactNode;
};

function SettingRow({
    title,
    description,
    children,
}: SettingRowProps) {
    return (
        <div className="flex items-center justify-between gap-8">
            <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">
                    {title}
                </div>

                <div className="mt-1 max-w-[560px] text-sm leading-5 text-slate-500">
                    {description}
                </div>
            </div>

            <div className="flex shrink-0 items-center">
                {children}
            </div>
        </div>
    );
}


