import { useReducer, useRef, useState } from "react";
import {
    IconCheck,
    IconLoader2,
    IconDeviceFloppy,
    IconRefresh,
    IconFolderOpen,
    IconAlertTriangle,
    IconTrash,
} from "@tabler/icons-react";

import { open } from "@tauri-apps/plugin-dialog";
import PageHeader from "@/components/common/PageHeader";
import SectionCard from "@/components/common/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { useSettings } from "../hooks";
import { BackupService } from "@/modules/backup";
import { Link } from "react-router-dom";
import { SQLiteProvider } from "@/core/database/engine/SQLiteProvider";
import { getErrorMessage } from "@/core/errors";
import {
    DEV_TOOLS_ENABLED,
    resetImportAndReconciliationData,
} from "@/core/database/devTools/importReconciliationReset";
import {
    canConfirmImportReset,
    createImportResetRunner,
    IMPORT_RESET_DELETES,
    IMPORT_RESET_KEEPS,
    importResetDialogReducer,
    INITIAL_IMPORT_RESET_DIALOG_STATE,
    RESET_CONFIRMATION_PHRASE,
} from "@/core/database/devTools/importReconciliationResetFlow";

/**
 * Exact phrase the user must type before the destructive action below
 * becomes clickable - the "strong confirmation" required for a
 * permanent, unrecoverable delete.
 */
function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }

    if (bytes < 1024 * 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function SettingsPage() {
    const backupService = new BackupService();

    const [backupLoading, setBackupLoading] = useState(false);
    const [restoreLoading, setRestoreLoading] = useState(false);
    const [backupMessage, setBackupMessage] = useState<string | null>(null);
    const [backupError, setBackupError] = useState<string | null>(null);

    async function handleCreateBackup() {
        setBackupMessage(null);
        setBackupError(null);

        try {
            const destination = await open({
                directory: true,
                multiple: false,
                title: "Select Backup Destination",
            });

            if (!destination || Array.isArray(destination)) {
                return;
            }

            setBackupLoading(true);

            const result = await backupService.createBackup(destination);

            setBackupMessage(
                `Backup created successfully: ${result.backupPath}`,
            );

            await refreshStorageInfo();
        } catch (error) {
            setBackupError(
                error instanceof Error
                    ? error.message
                    : String(error),
            );
        } finally {
            setBackupLoading(false);
        }
    }

    async function handleRestoreBackup() {
        setBackupMessage(null);
        setBackupError(null);

        try {
            const backupPath = await open({
                directory: true,
                multiple: false,
                title: "Select FinanceOS Backup",
            });

            if (!backupPath || Array.isArray(backupPath)) {
                return;
            }

            const confirmed = window.confirm(
                "Restoring this backup will replace the current FinanceOS database and documents. Continue?",
            );

            if (!confirmed) {
                return;
            }

            setRestoreLoading(true);

            await SQLiteProvider.getInstance().disconnect();
            await backupService.restoreBackup(backupPath);

            setBackupMessage(
                "Backup restored successfully. Restart FinanceOS to reload the restored data.",
            );

            await refreshStorageInfo();
        } catch (error) {
            setBackupError(
                error instanceof Error
                    ? error.message
                    : String(error),
            );
        } finally {
            setRestoreLoading(false);
        }
    }

    const {
        settings,
        loading,
        saving,
        saved,
        error,
        updateText,
        updateBoolean,
        saveSettings,
        resetToDefaults,
        storageInfo,
        refreshStorageInfo,
        openStorageFolder,
    } = useSettings();

    // Development-only Import/Reconciliation cleanup - see
    // core/database/devTools/importReconciliationReset.ts. Deletes
    // exactly import_rows, import_batches, import_mappings,
    // counterparty_rules, and reconciliations; never transactions,
    // accounts, or any other module.
    // The dialog's safety rules (open never deletes, close is ignored
    // mid-reset, one reset at a time, success only on a resolved call)
    // live in importReconciliationResetFlow.ts, where they are tested.
    const [resetState, dispatchReset] = useReducer(
        importResetDialogReducer,
        INITIAL_IMPORT_RESET_DIALOG_STATE,
    );
    const resetRunner = useRef(
        createImportResetRunner(resetImportAndReconciliationData),
    );

    const {
        open: resetDialogOpen,
        confirmationText: resetConfirmationText,
        resetting,
        result: resetResult,
        error: resetError,
    } = resetState;

    function openResetDialog() {
        dispatchReset({ type: "open" });
    }

    function closeResetDialog() {
        dispatchReset({ type: "requestClose" });
    }

    async function handleConfirmReset() {
        if (!canConfirmImportReset(resetState)) {
            return;
        }

        dispatchReset({ type: "start" });

        const outcome = await resetRunner.current.run();

        if (outcome.status === "succeeded") {
            dispatchReset({
                type: "succeeded",
                result: outcome.result,
            });
        } else if (outcome.status === "failed") {
            console.error(
                "IMPORT/RECONCILIATION RESET ERROR:",
                outcome.error,
            );

            dispatchReset({
                type: "failed",
                message: getErrorMessage(
                    outcome.error,
                    "Unable to reset Import/Reconciliation data. Please try again.",
                ),
            });
        }
    }

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
                actions={
                    <>
                        <button
                            type="button"
                            onClick={() => void resetToDefaults()}
                            disabled={saving}
                            className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                            Reset to Defaults
                        </button>

                        <button
                        onClick={() => void saveSettings()}
                        disabled={saving || saved}
                        className="h-10 rounded-xl bg-slate-900 px-5 text-white hover:bg-slate-800 disabled:bg-slate-400 disabled:text-white disabled:opacity-100"
                    >
                        {saving ? (
                            <IconLoader2
                                size={17}
                                className="mr-2 animate-spin"
                            />
                        ) : (
                            <IconDeviceFloppy
                                size={17}
                                className="mr-2"
                            />
                        )}

                        {saving
                            ? "Saving..."
                            : saved
                                ? "Saved"
                                : "Save Settings"}
                    </button>
                    </>
                }
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
                                        updateText(
                                            "workspaceName",
                                            event.target.value,
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
                                    updateText(
                                        "defaultCurrency",
                                        event.target.value,
                                    );
                                }}
                                className="h-10 w-[280px] rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400"
                            >
                                <option value="INR">
                                    INR - Indian Rupee
                                </option>
                                <option value="USD">
                                    USD - US Dollar
                                </option>
                                <option value="EUR">
                                    EUR - Euro
                                </option>
                                <option value="GBP">
                                    GBP - British Pound
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
                                    updateText(
                                        "dateFormat",
                                        event.target.value,
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
                                    updateText(
                                        "firstDayOfWeek",
                                        event.target.value,
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
                                    updateText(
                                        "theme",
                                        event.target.value,
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
                                    updateBoolean(
                                        "compactMode",
                                        checked,
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
                                    updateBoolean(
                                        "showDecimals",
                                        checked,
                                    );
                                }}
                            />
                        </SettingRow>

                    </div>
                </SectionCard>

                <SectionCard title="Payment Types">
                    <SettingRow
                        title="Payment Types"
                        description="Add, rename, activate or deactivate the payment types used throughout FinWea. They are managed on their own page."
                    >
                        <Link
                            to="/payment-types"
                            className="inline-flex h-10 items-center rounded-xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:border-slate-400 hover:bg-slate-50"
                        >
                            Open Payment Types
                        </Link>
                    </SettingRow>
                </SectionCard>

                <SectionCard title="Backup & Restore">
                    <div className="divide-y divide-slate-200">
                        <SettingRow
                            title="Backup"
                            description="Create a complete FinanceOS backup containing your database and Document Vault files."
                        >
                            <Button
                                type="button"
                                variant="outline"
                                disabled={backupLoading || restoreLoading}
                                onClick={() => void handleCreateBackup()}
                                className="h-10 rounded-lg px-4"
                            >
                                {backupLoading ? (
                                    <>
                                        <IconLoader2
                                            size={17}
                                            className="mr-2 animate-spin"
                                        />
                                        Creating Backup...
                                    </>
                                ) : (
                                    <>
                                        <IconDeviceFloppy
                                            size={17}
                                            className="mr-2"
                                        />
                                        Backup Now
                                    </>
                                )}
                            </Button>
                        </SettingRow>

                        <SettingRow
                            title="Restore"
                            description="Restore your database and Document Vault from an existing FinanceOS backup."
                        >
                            <Button
                                type="button"
                                variant="outline"
                                disabled={backupLoading || restoreLoading}
                                onClick={() => void handleRestoreBackup()}
                                className="h-10 rounded-lg px-4"
                            >
                                {restoreLoading ? (
                                    <>
                                        <IconLoader2
                                            size={17}
                                            className="mr-2 animate-spin"
                                        />
                                        Restoring...
                                    </>
                                ) : (
                                    <>
                                        <IconRefresh
                                            size={17}
                                            className="mr-2"
                                        />
                                        Restore Backup
                                    </>
                                )}
                            </Button>
                        </SettingRow>

                        {(backupMessage || backupError) && (
                            <div className="px-5 py-4">
                                {backupMessage && (
                                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                                        {backupMessage}
                                    </div>
                                )}

                                {backupError && (
                                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                                        {backupError}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </SectionCard>
                <SectionCard title="Data & Storage">
                    <div className="divide-y divide-slate-200">
                        <SettingRow
                            title="Application Data"
                            description="Location used by FinanceOS for application data."
                        >
                            <div className="flex items-center gap-3">
    <div className="max-w-[440px] truncate text-right text-sm text-slate-600">
        {storageInfo?.appDataPath ?? "Unavailable"}
    </div>
                    <Button
        type="button"
        variant="outline"
        title="Open Application Data"
        aria-label="Open Application Data"
        className="h-9 w-9 shrink-0 rounded-lg p-0"
        onClick={() => void openStorageFolder("appData")}
    >
        <IconFolderOpen size={18} />
    </Button>
</div>
                        </SettingRow>

                        <SettingRow
                            title="Database"
                            description="Location of the FinanceOS SQLite database."
                        >
                            <div className="flex items-center gap-3">
    <div className="max-w-[440px] truncate text-right text-sm text-slate-600">
        {storageInfo?.databasePath ?? "Unavailable"}
    </div>
                    <Button
        type="button"
        variant="outline"
        title="Open Database Folder"
        aria-label="Open Database Folder"
        className="h-9 w-9 shrink-0 rounded-lg p-0"
        onClick={() => void openStorageFolder("database")}
    >
        <IconFolderOpen size={18} />
    </Button>
</div>
                        </SettingRow>

                        <SettingRow
                            title="Database Size"
                            description="Current size of the FinanceOS database."
                        >
                            <div className="text-right text-sm font-medium text-slate-700">
                                {formatBytes(storageInfo?.databaseSize ?? 0)}
                            </div>
                        </SettingRow>

                        <SettingRow
                            title="Documents"
                            description="Location used for stored FinanceOS documents."
                        >
                            <div className="flex items-center gap-3">
    <div className="max-w-[440px] truncate text-right text-sm text-slate-600">
        {storageInfo?.documentsPath ?? "Unavailable"}
    </div>
                    <Button
        type="button"
        variant="outline"
        title="Open Documents"
        aria-label="Open Documents"
        className="h-9 w-9 shrink-0 rounded-lg p-0"
        onClick={() => void openStorageFolder("documents")}
    >
        <IconFolderOpen size={18} />
    </Button>
</div>
                        </SettingRow>

                        <SettingRow
                            title="Documents Storage"
                            description="Total size of files currently stored in Document Vault."
                        >
                            <div className="text-right text-sm font-medium text-slate-700">
                                {formatBytes(storageInfo?.documentsSize ?? 0)}
                            </div>
                        </SettingRow>

                        <SettingRow
                            title="Storage Information"
                            description="Refresh the current database and document storage information."
                        >
                            <Button
    type="button"
    variant="outline"
    title="Refresh"
    aria-label="Refresh storage information"
    className="h-14 w-14 rounded-xl border-2 border-blue-200 bg-white p-0 text-slate-900 shadow-sm hover:bg-blue-50 hover:text-blue-700"
    onClick={() => void refreshStorageInfo()}
>
    <IconRefresh size={24} stroke={2} />
</Button>
                        </SettingRow>
                    </div>
                </SectionCard>

                <SectionCard title="Settings Status">
                    <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-emerald-600 shadow-sm">
                            {saving ? (
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
                                {saving
                                    ? "Saving changes..."
                                    : saved
                                        ? "All changes saved"
                                        : "Unsaved changes"}
                            </div>

                            <div className="text-xs text-slate-500">
                                Settings are stored locally in FinanceOS.
                            </div>
                        </div>
                    </div>
                </SectionCard>

                {DEV_TOOLS_ENABLED && (
                    <SectionCard title="⚠️ Development Only">
                        <div className="space-y-4">
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                This section only exists in development
                                builds (<code className="font-mono">import.meta.env.DEV</code>)
                                and is compiled out of the production
                                build entirely - it is never visible or
                                reachable in the packaged application.
                            </div>

                            <SettingRow
                                title="Reset Import &amp; Reconciliation Data"
                                description="Permanently deletes every import batch, staged import row, saved import mapping, learned counterparty rule, and reconciliation session. Transactions, accounts, and every other module are never touched."
                            >
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={openResetDialog}
                                    className="h-10 rounded-lg border-red-200 px-4 text-red-700 hover:bg-red-50 hover:text-red-700"
                                >
                                    <IconTrash
                                        size={17}
                                        className="mr-2"
                                    />
                                    Reset Import Data
                                </Button>
                            </SettingRow>
                        </div>
                    </SectionCard>
                )}

            </div>

            {DEV_TOOLS_ENABLED && (
                <AlertDialog
                    open={resetDialogOpen}
                    onOpenChange={(open) => {
                        if (!open) {
                            closeResetDialog();
                        }
                    }}
                >
                    <AlertDialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-2xl">
                        {resetResult ? (
                            <div className="flex flex-col gap-4 overflow-y-auto p-6">
                                <AlertDialogHeader>
                                    <AlertDialogTitle className="flex items-center gap-2 text-emerald-700">
                                        <IconCheck size={20} />
                                        Reset complete
                                    </AlertDialogTitle>

                                    <AlertDialogDescription
                                        render={
                                            <div className="space-y-3 text-sm text-slate-600" />
                                        }
                                    >
                                        <p>
                                            Every Import and
                                            Reconciliation record has
                                            been permanently deleted.
                                            Transactions and every
                                            other module were not
                                            touched.
                                        </p>

                                            <ul className="space-y-1 rounded-lg bg-slate-50 px-4 py-3 font-mono text-xs text-slate-700">
                                                <li>
                                                    import_rows deleted:{" "}
                                                    <strong>
                                                        {resetResult.importRows}
                                                    </strong>
                                                </li>
                                                <li>
                                                    import_batches deleted:{" "}
                                                    <strong>
                                                        {resetResult.importBatches}
                                                    </strong>
                                                </li>
                                                <li>
                                                    import_mappings deleted:{" "}
                                                    <strong>
                                                        {resetResult.importMappings}
                                                    </strong>
                                                </li>
                                                <li>
                                                    counterparty_rules
                                                    deleted:{" "}
                                                    <strong>
                                                        {resetResult.counterpartyRules}
                                                    </strong>
                                                </li>
                                                <li>
                                                    reconciliations
                                                    deleted:{" "}
                                                    <strong>
                                                        {resetResult.reconciliations}
                                                    </strong>
                                                </li>
                                        </ul>
                                    </AlertDialogDescription>
                                </AlertDialogHeader>

                                <AlertDialogFooter>
                                    <AlertDialogAction
                                        onClick={() =>
                                            dispatchReset({
                                                type: "dismissResult",
                                            })
                                        }
                                        className="bg-slate-900 text-white hover:bg-slate-800"
                                    >
                                        Done
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </div>
                        ) : (
                            <>
                                <AlertDialogHeader className="gap-1 border-b border-slate-100 px-6 pb-4 pt-6">
                                    <AlertDialogTitle className="flex items-center gap-2">
                                        <IconAlertTriangle
                                            size={20}
                                            className="text-red-600"
                                        />
                                        Reset Import &amp; Reconciliation
                                        Data
                                    </AlertDialogTitle>

                                    <AlertDialogDescription>
                                        This action permanently deletes
                                        import and reconciliation data.
                                        This cannot be undone.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>

                                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
                                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                                            Important
                                        </p>

                                        <p className="mt-1 text-sm text-amber-800">
                                            Before continuing, make sure
                                            you have a backup if you may
                                            need this import history
                                            later.
                                        </p>
                                    </div>

                                    <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                                        <section
                                            aria-labelledby="reset-will-delete"
                                            className="rounded-xl border border-red-100 bg-red-50/50 px-4 py-3"
                                        >
                                            <h3
                                                id="reset-will-delete"
                                                className="text-xs font-semibold uppercase tracking-wide text-red-700"
                                            >
                                                Will be deleted
                                            </h3>

                                            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700 marker:text-red-300">
                                                {IMPORT_RESET_DELETES.map(
                                                    (item) => (
                                                        <li key={item.table}>
                                                            {item.label}
                                                        </li>
                                                    ),
                                                )}
                                            </ul>
                                        </section>

                                        <section
                                            aria-labelledby="reset-will-not-delete"
                                            className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
                                        >
                                            <h3
                                                id="reset-will-not-delete"
                                                className="text-xs font-semibold uppercase tracking-wide text-slate-600"
                                            >
                                                Will NOT be deleted
                                            </h3>

                                            <ul className="mt-2 list-disc gap-x-6 pl-5 text-sm text-slate-700 marker:text-slate-300 sm:columns-2">
                                                {IMPORT_RESET_KEEPS.map(
                                                    (item) => (
                                                        <li
                                                            key={item}
                                                            className="mb-1 break-inside-avoid"
                                                        >
                                                            {item}
                                                        </li>
                                                    ),
                                                )}
                                            </ul>
                                        </section>
                                    </div>
                                </div>

                                <div className="space-y-3 border-t border-slate-100 px-6 pb-6 pt-4">
                                    <label
                                        htmlFor="reset-confirmation-phrase"
                                        className="block text-sm text-slate-600"
                                    >
                                        To confirm, type{" "}
                                        <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-900">
                                            {RESET_CONFIRMATION_PHRASE}
                                        </code>{" "}
                                        exactly:
                                    </label>

                                    <Input
                                        id="reset-confirmation-phrase"
                                        value={resetConfirmationText}
                                        onChange={(event) =>
                                            dispatchReset({
                                                type: "typeConfirmation",
                                                text: event.target.value,
                                            })
                                        }
                                        placeholder={RESET_CONFIRMATION_PHRASE}
                                        disabled={resetting}
                                        autoFocus
                                        autoComplete="off"
                                        spellCheck={false}
                                        className="font-mono"
                                    />

                                    {resetError && (
                                        <div
                                            role="alert"
                                            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                                        >
                                            {resetError}
                                        </div>
                                    )}

                                    <AlertDialogFooter className="mt-0 pt-1 sm:justify-between">
                                        <AlertDialogCancel
                                            disabled={resetting}
                                            onClick={closeResetDialog}
                                            className="h-9 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-none hover:bg-slate-50 hover:text-slate-900"
                                        >
                                            Cancel
                                        </AlertDialogCancel>

                                        <AlertDialogAction
                                            disabled={
                                                !canConfirmImportReset(
                                                    resetState,
                                                )
                                            }
                                            onClick={() =>
                                                void handleConfirmReset()
                                            }
                                            className="h-9 rounded-lg px-4 bg-red-600 text-white hover:bg-red-700"
                                        >
                                            {resetting ? (
                                                <>
                                                    <IconLoader2
                                                        size={16}
                                                        className="mr-2 animate-spin"
                                                    />
                                                    Resetting...
                                                </>
                                            ) : (
                                                "Permanently Delete"
                                            )}
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </div>
                            </>
                        )}
                    </AlertDialogContent>
                </AlertDialog>
            )}
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






























