import { useReducer, useRef, useState } from "react";
import { Download, FileUp } from "lucide-react";
import { toast } from "sonner";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import {
    CategoryService,
    type CategoryCsvRow,
    type CategoryCsvRowStatus,
} from "../services";
import { Category } from "../types";
import { financeScopeLabel } from "../utils";

import {
    CATEGORY_CSV_ACCEPT,
    canImportCategoryCsv,
    categoryCsvImportReducer,
    downloadCategoryCsvTemplate,
    initialCategoryCsvImportState,
    readCategoryCsvFile,
    runCategoryCsvImport,
} from "./categoryCsvImportFlow";

interface ImportCategoriesCsvDialogProps {
    /** The page's current (non-deleted) categories - for the duplicate check. */
    categories: Category[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => Promise<void> | void;
}

const STATUS_LABEL: Record<CategoryCsvRowStatus, string> = {
    valid: "Valid",
    duplicate: "Duplicate",
    invalid: "Invalid",
};

const STATUS_CLASS: Record<CategoryCsvRowStatus, string> = {
    valid: "bg-emerald-50 text-emerald-700",
    duplicate: "bg-amber-50 text-amber-700",
    invalid: "bg-red-50 text-red-600",
};

function formatType(value: string): string {
    return value
        ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
        : "";
}

function categoriesWord(count: number): string {
    return count === 1 ? "category" : "categories";
}

const secondaryButtonClass =
    "h-9 rounded-lg border border-slate-300 bg-white px-5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50";

const primaryButtonClass =
    "h-9 cursor-pointer rounded-lg bg-slate-900 px-5 text-sm font-medium text-white shadow-sm transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50";

function CountTile({
    label,
    value,
    className = "text-slate-900",
}: {
    label: string;
    value: number;
    className?: string;
}) {
    return (
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                {label}
            </div>
            <div className={`mt-1 text-lg font-semibold ${className}`}>
                {value}
            </div>
        </div>
    );
}

function PreviewTable({ rows }: { rows: CategoryCsvRow[] }) {
    const headClass =
        "px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500";

    return (
        <div className="max-h-[360px] overflow-auto rounded-xl border border-slate-100">
            <table className="w-full text-left">
                <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-slate-100">
                        <th className={headClass}>Line</th>
                        <th className={headClass}>Name</th>
                        <th className={headClass}>Type</th>
                        <th className={headClass}>Scope</th>
                        <th className={headClass}>Description</th>
                        <th className={headClass}>Status</th>
                    </tr>
                </thead>

                <tbody>
                    {rows.map(row => (
                        <tr
                            key={row.lineNumber}
                            className="border-b border-slate-50 align-top last:border-0"
                        >
                            <td className="px-4 py-2.5 text-sm text-slate-400">
                                {row.lineNumber}
                            </td>
                            <td className="px-4 py-2.5 text-sm font-medium text-slate-900">
                                {row.name || (
                                    <span className="italic text-slate-400">
                                        (blank)
                                    </span>
                                )}
                            </td>
                            <td className="px-4 py-2.5 text-sm text-slate-600">
                                {formatType(row.type)}
                            </td>
                            <td className="px-4 py-2.5 text-sm text-slate-600">
                                {financeScopeLabel(row.scope)}
                            </td>
                            <td className="px-4 py-2.5 text-sm text-slate-600">
                                {row.description ?? ""}
                            </td>
                            <td className="px-4 py-2.5 text-sm">
                                <span
                                    className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASS[row.status]}`}
                                >
                                    {STATUS_LABEL[row.status]}
                                </span>
                                {row.messages.map(message => (
                                    <div
                                        key={message}
                                        className="mt-1 text-xs text-slate-500"
                                    >
                                        {message}
                                    </div>
                                ))}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function ImportCategoriesCsvDialog({
    categories,
    open,
    onOpenChange,
    onSuccess,
}: ImportCategoriesCsvDialogProps) {
    const [state, dispatch] = useReducer(
        categoryCsvImportReducer,
        initialCategoryCsvImportState
    );
    const [reading, setReading] = useState(false);
    const [savingTemplate, setSavingTemplate] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    async function handleDownloadTemplate() {
        setSavingTemplate(true);
        await downloadCategoryCsvTemplate(toast);
        setSavingTemplate(false);
    }

    const importing = state.step === "preview" && state.importing;

    // Cancel / close: discards the preview. Nothing has been written
    // unless the import was confirmed; closing mid-import is blocked.
    function handleOpenChange(nextOpen: boolean) {
        if (!nextOpen && importing) {
            return;
        }

        if (!nextOpen) {
            dispatch({ type: "reset" });
        }

        onOpenChange(nextOpen);
    }

    async function handleFileChange(
        event: React.ChangeEvent<HTMLInputElement>
    ) {
        const file = event.target.files?.[0];

        // Allow re-choosing the same file after a change on disk.
        event.target.value = "";

        if (!file) {
            return;
        }

        setReading(true);
        dispatch(await readCategoryCsvFile(file, categories));
        setReading(false);
    }

    async function handleConfirmImport() {
        if (state.step !== "preview" || !state.confirming || importing) {
            return;
        }

        dispatch({ type: "importStarted" });

        const action = await runCategoryCsvImport(
            new CategoryService(),
            state.preview
        );

        dispatch(action);

        if (action.type === "importSucceeded") {
            toast.success(
                `Imported ${action.result.imported} ${categoriesWord(
                    action.result.imported
                )}.`
            );
            await onSuccess?.();
        } else if (action.type === "importFailed") {
            toast.error(action.error);
        }
    }

    const fileInput = (
        <input
            ref={fileInputRef}
            type="file"
            accept={CATEGORY_CSV_ACCEPT}
            onChange={handleFileChange}
            disabled={reading || importing}
            className="hidden"
        />
    );

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent
                showCloseButton={!importing}
                className="
                    flex
                    w-[960px]
                    max-w-[calc(100vw-48px)]
                    max-h-[calc(100vh-48px)]
                    flex-col
                    gap-0
                    overflow-hidden
                    rounded-[28px]
                    border border-slate-100
                    bg-white
                    p-0
                    shadow-lg
                "
            >
                <DialogHeader className="shrink-0 px-7 pb-4 pt-5">
                    <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">
                        Import Categories from CSV
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        Columns: name, type (Income / Expense / Transfer),
                        scope (Personal, Business or Personal+Business -
                        Personal if left out), description. New categories
                        are created as Active. Existing categories are
                        never changed.
                    </DialogDescription>
                </DialogHeader>

                {fileInput}

                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto border-t border-slate-100 px-7 py-5">
                    {state.step === "select" && (
                        <>
                            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center">
                                <FileUp
                                    size={28}
                                    className="text-slate-400"
                                />
                                <div className="text-sm text-slate-600">
                                    Choose a .csv file to preview. Nothing
                                    is imported until you confirm.
                                </div>
                                <div className="flex gap-3">
                                    <button
                                        type="button"
                                        onClick={() =>
                                            fileInputRef.current?.click()
                                        }
                                        disabled={reading}
                                        className={primaryButtonClass}
                                    >
                                        {reading
                                            ? "Reading..."
                                            : "Choose CSV File"}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleDownloadTemplate}
                                        disabled={savingTemplate}
                                        className={`${secondaryButtonClass} inline-flex items-center gap-2`}
                                    >
                                        <Download size={14} />
                                        Download Template
                                    </button>
                                </div>
                            </div>

                            {state.error && (
                                <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                                    {state.error}
                                </div>
                            )}
                        </>
                    )}

                    {state.step === "preview" && (
                        <>
                            <div className="flex items-center justify-between gap-3 text-sm text-slate-600">
                                <div>
                                    File:
                                    <span className="ml-1 font-medium text-slate-900">
                                        {state.fileName}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() =>
                                        fileInputRef.current?.click()
                                    }
                                    disabled={
                                        reading ||
                                        importing ||
                                        state.confirming
                                    }
                                    className="text-sm font-medium text-slate-700 underline-offset-4 hover:underline disabled:opacity-50"
                                >
                                    Choose a different file
                                </button>
                            </div>

                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                <CountTile
                                    label="Total"
                                    value={state.preview.totalRows}
                                />
                                <CountTile
                                    label="Valid"
                                    value={state.preview.validRows}
                                    className="text-emerald-700"
                                />
                                <CountTile
                                    label="Duplicate"
                                    value={state.preview.duplicateRows}
                                    className="text-amber-700"
                                />
                                <CountTile
                                    label="Invalid"
                                    value={state.preview.invalidRows}
                                    className="text-red-600"
                                />
                            </div>

                            {state.preview.fileError && (
                                <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                                    {state.preview.fileError}
                                </div>
                            )}

                            {state.error && (
                                <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                                    {state.error}
                                </div>
                            )}

                            {state.preview.rows.length > 0 && (
                                <PreviewTable rows={state.preview.rows} />
                            )}
                        </>
                    )}

                    {state.step === "done" && (
                        <>
                            <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                                Import complete for{" "}
                                <span className="font-medium">
                                    {state.fileName}
                                </span>
                                .
                            </div>

                            <div className="grid grid-cols-3 gap-3">
                                <CountTile
                                    label="Imported"
                                    value={state.result.imported}
                                    className="text-emerald-700"
                                />
                                <CountTile
                                    label="Skipped duplicates"
                                    value={state.result.skippedDuplicates}
                                    className="text-amber-700"
                                />
                                <CountTile
                                    label="Skipped invalid"
                                    value={state.result.invalid}
                                    className="text-red-600"
                                />
                            </div>
                        </>
                    )}
                </div>

                <div className="shrink-0 border-t border-slate-100 px-7 py-4">
                    {state.step === "preview" && state.confirming ? (
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="text-sm text-slate-700">
                                Create{" "}
                                <span className="font-semibold text-slate-900">
                                    {state.preview.validRows} new{" "}
                                    {categoriesWord(state.preview.validRows)}
                                </span>
                                ?{" "}
                                {state.preview.duplicateRows +
                                    state.preview.invalidRows >
                                    0 &&
                                    "Duplicate and invalid rows will be skipped."}
                            </div>
                            <div className="flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() =>
                                        dispatch({ type: "cancelConfirm" })
                                    }
                                    disabled={importing}
                                    className={secondaryButtonClass}
                                >
                                    Back
                                </button>
                                <button
                                    type="button"
                                    onClick={handleConfirmImport}
                                    disabled={importing}
                                    className={primaryButtonClass}
                                >
                                    {importing
                                        ? "Importing..."
                                        : "Confirm Import"}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex justify-end gap-3">
                            {state.step === "done" ? (
                                <button
                                    type="button"
                                    onClick={() => handleOpenChange(false)}
                                    className={primaryButtonClass}
                                >
                                    Done
                                </button>
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            handleOpenChange(false)
                                        }
                                        disabled={reading}
                                        className={secondaryButtonClass}
                                    >
                                        Cancel
                                    </button>
                                    {state.step === "preview" && (
                                        <button
                                            type="button"
                                            onClick={() =>
                                                dispatch({
                                                    type: "requestConfirm",
                                                })
                                            }
                                            disabled={
                                                reading ||
                                                !canImportCategoryCsv(
                                                    state.preview
                                                )
                                            }
                                            className={primaryButtonClass}
                                        >
                                            Import {state.preview.validRows}{" "}
                                            {state.preview.validRows === 1
                                                ? "Category"
                                                : "Categories"}
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
