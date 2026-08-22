import { useEffect, useMemo, useRef, useState } from "react";
import {
    FileUp,
    RefreshCw,
    Eye,
    X,
    CheckCircle2,
    AlertTriangle,
    XCircle,
} from "lucide-react";

import { EmptyState, PageHeader } from "@/components/common";
import { useAccounts } from "@/modules/accounts/hooks";

import { ImportService } from "../services";
import type {
    ImportBatch,
    ImportRow,
} from "../types";

import type {
    CsvImportType,
    CsvPreviewResult,
} from "@financeos/import-engine";

export default function ImportsPage() {
    const { accounts, loading: accountsLoading } =
        useAccounts();

    const service = useMemo(
        () => new ImportService(),
        []
    );

    const fileInputRef =
        useRef<HTMLInputElement | null>(null);

    const [selectedAccountId, setSelectedAccountId] =
        useState("");

    const [importType, setImportType] =
        useState<CsvImportType>("BANK_CSV");

    const [selectedFile, setSelectedFile] =
        useState<File | null>(null);

    const [preview, setPreview] =
        useState<CsvPreviewResult | null>(null);

    const [batches, setBatches] =
        useState<ImportBatch[]>([]);

    const [selectedBatch, setSelectedBatch] =
        useState<ImportBatch | null>(null);

    const [selectedRows, setSelectedRows] =
        useState<ImportRow[]>([]);

    const [detailsLoading, setDetailsLoading] =
        useState(false);

    const [loading, setLoading] =
        useState(true);

    const [previewing, setPreviewing] =
        useState(false);

    const [importing, setImporting] =
        useState(false);

    const [error, setError] =
        useState<string | null>(null);

    const [message, setMessage] =
        useState<string | null>(null);

    const loadBatches = async () => {
        try {
            setLoading(true);
            setError(null);

            const data =
                await service.getBatches();

            setBatches(data);
        } catch (err) {
            console.error(
                "IMPORT BATCH LOAD ERROR:",
                err
            );

            setError(
                err instanceof Error
                    ? err.message
                    : String(err)
            );
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadBatches();
    }, []);

    const handleFileChange = (
        event: React.ChangeEvent<HTMLInputElement>
    ) => {
        const file =
            event.target.files?.[0] ?? null;

        setSelectedFile(file);
        setPreview(null);
        setMessage(null);
        setError(null);
    };

    const handlePreview = async () => {
        if (!selectedAccountId) {
            setError(
                "Please select an account."
            );
            return;
        }

        if (!selectedFile) {
            setError(
                "Please select a CSV file."
            );
            return;
        }

        try {
            setPreviewing(true);
            setError(null);
            setMessage(null);

            const content =
                await selectedFile.text();

            const result =
                await service.previewCsv(
                    selectedAccountId,
                    content,
                    importType
                );

            setPreview(result);
        } catch (err) {
            console.error(
                "CSV PREVIEW ERROR:",
                err
            );

            setPreview(null);

            setError(
                err instanceof Error
                    ? err.message
                    : String(err)
            );
        } finally {
            setPreviewing(false);
        }
    };

    const handleImport = async () => {
        if (!selectedAccountId) {
            setError(
                "Please select an account."
            );
            return;
        }

        if (!selectedFile) {
            setError(
                "Please select a CSV file."
            );
            return;
        }

        if (!preview) {
            setError(
                "Please preview the CSV before importing."
            );
            return;
        }

        if (previewErrorRows > 0) {
            setError(
                "The CSV contains validation errors. Correct the file before importing."
            );
            return;
        }

        if (previewReadyRows === 0) {
            setError(
                "There are no new transactions to import."
            );
            return;
        }

        try {
            setImporting(true);
            setError(null);
            setMessage(null);

            const content =
                await selectedFile.text();

            const batch =
                await service.processCsv(
                    selectedAccountId,
                    selectedFile.name,
                    content,
                    importType
                );

            if (
                batch.status ===
                "COMPLETED"
            ) {
                setMessage(
                    `Import completed successfully. ${batch.importedRows} transaction${
                        batch.importedRows === 1
                            ? ""
                            : "s"
                    } imported.`
                );
            } else if (
                batch.status ===
                "COMPLETED_WITH_ERRORS"
            ) {
                setMessage(
                    `Import completed with ${batch.duplicateRows} duplicate${
                        batch.duplicateRows === 1
                            ? ""
                            : "s"
                    } and ${batch.failedRows} failed row${
                        batch.failedRows === 1
                            ? ""
                            : "s"
                    }.`
                );
            } else {
                setError(
                    `Import finished with status: ${batch.status}`
                );
            }

            setSelectedFile(null);
            setPreview(null);

            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }

            await loadBatches();
        } catch (err) {
            console.error(
                "CSV IMPORT ERROR:",
                err
            );

            setError(
                err instanceof Error
                    ? err.message
                    : String(err)
            );
        } finally {
            setImporting(false);
        }
    };

    const handleViewDetails = async (
        batch: ImportBatch
    ) => {
        try {
            setDetailsLoading(true);
            setError(null);

            const rows =
                await service.getRows(batch.id);

            setSelectedBatch(batch);
            setSelectedRows(rows);
        } catch (err) {
            console.error(
                "IMPORT DETAILS ERROR:",
                err
            );

            setError(
                err instanceof Error
                    ? err.message
                    : String(err)
            );
        } finally {
            setDetailsLoading(false);
        }
    };

    const closeDetails = () => {
        setSelectedBatch(null);
        setSelectedRows([]);
    };

    const closePreview = () => {
        setPreview(null);
    };

    const accountMap = useMemo(
        () =>
            new Map(
                accounts.map(account => [
                    account.id,
                    account.name,
                ])
            ),
        [accounts]
    );

    const formatDate = (
        value: string
    ) => {
        const date =
            new Date(value);

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {
            return value;
        }

        return new Intl.DateTimeFormat(
            "en-IN",
            {
                dateStyle: "medium",
                timeStyle: "short",
            }
        ).format(date);
    };

    const statusClass = (
        status: ImportBatch["status"]
    ) => {
        switch (status) {
            case "COMPLETED":
                return "bg-emerald-50 text-emerald-700";

            case "COMPLETED_WITH_ERRORS":
                return "bg-amber-50 text-amber-700";

            case "FAILED":
                return "bg-red-50 text-red-700";

            case "PROCESSING":
                return "bg-blue-50 text-blue-700";

            default:
                return "bg-slate-100 text-slate-600";
        }
    };

    const rowStatusClass = (
        status: ImportRow["status"]
    ) => {
        switch (status) {
            case "IMPORTED":
                return "bg-emerald-50 text-emerald-700";

            case "DUPLICATE":
                return "bg-amber-50 text-amber-700";

            case "FAILED":
                return "bg-red-50 text-red-700";

            case "VALID":
                return "bg-blue-50 text-blue-700";

            default:
                return "bg-slate-100 text-slate-600";
        }
    };

    const getNormalizedValue = (
        row: ImportRow,
        field: string
    ) => {
        const value =
            row.normalizedData?.[field];

        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {
            return "—";
        }

        return String(value);
    };

    const previewErrors =
        preview?.validation.errors ?? [];

    const previewTotalRows =
        preview?.candidates.length ?? 0;

    const previewErrorRows =
        preview
            ? new Set(
                  preview.validation.errors.map(
                      error => error.rowNumber
                  )
              ).size
            : 0;

    const previewDuplicateRows =
        preview?.duplicates.size ?? 0;

    const previewReadyRows =
        Math.max(
            0,
            previewTotalRows -
                previewErrorRows -
                previewDuplicateRows
        );

    const previewHasErrors =
        previewErrorRows > 0;

    const previewHasDuplicates =
        previewDuplicateRows > 0;

    const previewHasReadyRows =
        previewReadyRows > 0;

    const previewValid =
        preview !== null &&
        !previewHasErrors &&
        previewHasReadyRows;

    const previewStatusLabel =
        previewHasErrors
            ? "Requires correction"
            : !previewHasReadyRows
                ? "No new transactions"
                : previewHasDuplicates
                    ? "Ready with duplicates"
                    : "Ready to import";

    return (
        <div className="min-h-full bg-slate-50">
            <div className="w-full space-y-6">

                <PageHeader
                    title="Import Transactions"
                    subtitle="Import bank or credit card transactions from a CSV file."
                />

                <section className="rounded-[28px] border border-slate-100 bg-white p-7 shadow-sm">

                    <div>
                        <h2 className="text-[22px] font-bold text-slate-900">
                            New Import
                        </h2>

                        <p className="mt-1 text-[15px] text-slate-500">
                            Select the account and CSV file you want to import.
                        </p>
                    </div>

                    <div className="mt-7 grid grid-cols-1 gap-5 md:grid-cols-3">

                        <div>
                            <label className="mb-2 block text-sm font-medium text-slate-700">
                                Import Type
                            </label>

                            <select
                                value={importType}
                                onChange={event => {
                                    const nextType =
                                        event.target.value as CsvImportType;

                                    setImportType(nextType);
                                    setPreview(null);
                                    setError(null);
                                    setMessage(null);
                                }}
                                disabled={
                                    importing ||
                                    previewing
                                }
                                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100 disabled:bg-slate-50"
                            >
                                <option value="BANK_CSV">
                                    Bank CSV
                                </option>

                                <option value="CREDIT_CARD_CSV">
                                    Credit Card CSV
                                </option>
                            </select>
                        </div>

                        <div>
                            <label className="mb-2 block text-sm font-medium text-slate-700">
                                Account
                            </label>

                            <select
                                value={selectedAccountId}
                                onChange={event => {
                                    setSelectedAccountId(
                                        event.target.value
                                    );
                                    setPreview(null);
                                    setError(null);
                                    setMessage(null);
                                }}
                                disabled={
                                    accountsLoading ||
                                    importing ||
                                    previewing
                                }
                                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100 disabled:bg-slate-50"
                            >
                                <option value="">
                                    {accountsLoading
                                        ? "Loading accounts..."
                                        : "Select account"}
                                </option>

                                {accounts.map(
                                    account => (
                                        <option
                                            key={
                                                account.id
                                            }
                                            value={
                                                account.id
                                            }
                                        >
                                            {
                                                account.name
                                            }
                                        </option>
                                    )
                                )}
                            </select>
                        </div>

                        <div>
                            <label className="mb-2 block text-sm font-medium text-slate-700">
                                CSV File
                            </label>

                            <input
                                ref={
                                    fileInputRef
                                }
                                type="file"
                                accept=".csv,text/csv"
                                onChange={
                                    handleFileChange
                                }
                                disabled={
                                    importing ||
                                    previewing
                                }
                                className="block h-11 w-full cursor-pointer rounded-xl border border-slate-200 bg-white text-sm text-slate-500 file:mr-4 file:h-full file:border-0 file:bg-slate-50 file:px-4 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-100"
                            />
                        </div>

                    </div>

                    {selectedFile && (
                        <div className="mt-5 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                            Selected file:
                            <span className="ml-1 font-medium text-slate-900">
                                {selectedFile.name}
                            </span>
                        </div>
                    )}

                    {error && (
                        <div className="mt-5 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                            {error}
                        </div>
                    )}

                    {message && (
                        <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                            {message}
                        </div>
                    )}

                    <div className="mt-6 flex justify-end gap-3">

                        {preview && (
                            <button
                                type="button"
                                onClick={
                                    closePreview
                                }
                                disabled={
                                    importing
                                }
                                className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                            >
                                <X size={16} />
                                Clear Preview
                            </button>
                        )}

                        {!preview && (
                            <button
                                type="button"
                                onClick={
                                    handlePreview
                                }
                                disabled={
                                    previewing ||
                                    importing ||
                                    !selectedAccountId ||
                                    !selectedFile
                                }
                                className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-900 px-5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <Eye size={16} />

                                {previewing
                                    ? "Analyzing..."
                                    : "Preview CSV"}
                            </button>
                        )}

                        {preview && (
                            <button
                                type="button"
                                onClick={
                                    handleImport
                                }
                                disabled={
                                    importing ||
                                    !previewValid
                                }
                                className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <FileUp size={16} />

                                {importing
                                    ? "Importing..."
                                    : "Confirm & Import"}
                            </button>
                        )}

                    </div>

                </section>

                {preview && (
                    <section className="rounded-[28px] border border-slate-100 bg-white p-7 shadow-sm">

                        <div className="flex items-start justify-between">

                            <div>
                                <h2 className="text-[22px] font-bold text-slate-900">
                                    Import Preview
                                </h2>

                                <p className="mt-1 text-[15px] text-slate-500">
                                    Review the detected columns and normalized transactions before importing.
                                </p>
                            </div>

                            {previewValid ? (
                                <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                                    <CheckCircle2 size={15} />
                                    {previewStatusLabel}
                                </div>
                            ) : previewHasDuplicates && !previewHasErrors ? (
                                <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">
                                    <AlertTriangle size={15} />
                                    {previewStatusLabel}
                                </div>
                            ) : (
                                <div className="inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700">
                                    <XCircle size={15} />
                                    {previewStatusLabel}
                                </div>
                            )}

                        </div>

                        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-5">

                            <div className="rounded-2xl bg-slate-50 p-4">
                                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                                    Rows
                                </div>
                                <div className="mt-2 text-2xl font-bold text-slate-900">
                                    {previewTotalRows}
                                </div>
                            </div>

                            <div className="rounded-2xl bg-emerald-50 p-4">
                                <div className="text-xs font-medium uppercase tracking-wide text-emerald-600">
                                    Ready
                                </div>
                                <div className="mt-2 text-2xl font-bold text-emerald-700">
                                    {previewReadyRows}
                                </div>
                            </div>

                            <div className="rounded-2xl bg-amber-50 p-4">
                                <div className="text-xs font-medium uppercase tracking-wide text-amber-600">
                                    Duplicates
                                </div>
                                <div className="mt-2 text-2xl font-bold text-amber-700">
                                    {previewDuplicateRows}
                                </div>
                            </div>

                            <div className="rounded-2xl bg-red-50 p-4">
                                <div className="text-xs font-medium uppercase tracking-wide text-red-600">
                                    Errors
                                </div>
                                <div className="mt-2 text-2xl font-bold text-red-700">
                                    {previewErrorRows}
                                </div>
                            </div>

                            <div className="rounded-2xl bg-blue-50 p-4">
                                <div className="text-xs font-medium uppercase tracking-wide text-blue-600">
                                    Columns
                                </div>
                                <div className="mt-2 text-2xl font-bold text-blue-700">
                                    {
                                        preview.document.headers.length
                                    }
                                </div>
                            </div>

                        </div>

                        <div className="mt-6 rounded-2xl border border-slate-100">

                            <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Detected Mapping
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-x-6 gap-y-3 p-4 md:grid-cols-4">

                                {Object.entries(
                                    preview.mapping
                                ).map(
                                    ([field, column]) => (
                                        <div
                                            key={field}
                                            className="text-sm"
                                        >
                                            <div className="text-xs text-slate-400">
                                                {field}
                                            </div>

                                            <div className="mt-1 font-medium text-slate-800">
                                                {column ??
                                                    "Not detected"}
                                            </div>
                                        </div>
                                    )
                                )}

                            </div>

                        </div>

                        {previewErrors.length > 0 && (
                            <div className="mt-6 rounded-2xl border border-red-100 bg-red-50 p-4">

                                <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
                                    <AlertTriangle size={16} />
                                    Validation errors
                                </div>

                                <div className="mt-3 space-y-2">

                                    {previewErrors.map(
                                        (validationError, index) => (
                                            <div
                                                key={`${validationError.rowNumber}-${validationError.field}-${index}`}
                                                className="text-sm text-red-600"
                                            >
                                                Row{" "}
                                                {
                                                    validationError.rowNumber
                                                }
                                                {validationError.field
                                                    ? ` · ${validationError.field}`
                                                    : ""}
                                                {" — "}
                                                {
                                                    validationError.message
                                                }
                                            </div>
                                        )
                                    )}

                                </div>

                            </div>
                        )}

                        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-100">

                            <div className="overflow-x-auto">

                                <table className="w-full min-w-[900px] text-left">

                                    <thead className="border-b border-slate-100 bg-slate-50">

                                        <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">

                                            <th className="px-4 py-3">
                                                Row
                                            </th>

                                            <th className="px-4 py-3">
                                                Date
                                            </th>

                                            <th className="px-4 py-3">
                                                Payee
                                            </th>

                                            <th className="px-4 py-3">
                                                Description
                                            </th>

                                            <th className="px-4 py-3 text-right">
                                                Amount
                                            </th>

                                            <th className="px-4 py-3">
                                                Type
                                            </th>

                                            <th className="px-4 py-3">
                                                Reference
                                            </th>

                                        </tr>

                                    </thead>

                                    <tbody className="divide-y divide-slate-100">

                                        {preview.candidates.map(
                                            candidate => {
                                                const rowErrors =
                                                    previewErrors.filter(
                                                        validationError =>
                                                            validationError.rowNumber ===
                                                            candidate.rowNumber
                                                    );

                                            
    return (
                                                    <tr
                                                        key={
                                                            candidate.rowNumber
                                                        }
                                                        className={
                                                            rowErrors.length > 0
                                                                ? "bg-red-50/50"
                                                                : "hover:bg-slate-50"
                                                        }
                                                    >

                                                        <td className="px-4 py-4 text-sm font-medium text-slate-700">
                                                            {
                                                                candidate.rowNumber
                                                            }
                                                        </td>

                                                        <td className="px-4 py-4 text-sm text-slate-600">
                                                            {candidate.transactionDate ??
                                                                "—"}
                                                        </td>

                                                        <td className="px-4 py-4 text-sm font-medium text-slate-800">
                                                            {candidate.payee ||
                                                                "—"}
                                                        </td>

                                                        <td className="px-4 py-4 text-sm text-slate-600">
                                                            {candidate.description ||
                                                                "—"}
                                                        </td>

                                                        <td className="px-4 py-4 text-right text-sm font-medium text-slate-800">
                                                            {candidate.amount ??
                                                                "—"}
                                                        </td>

                                                        <td className="px-4 py-4 text-sm text-slate-600">
                                                            {candidate.type ??
                                                                "—"}
                                                        </td>

                                                        <td className="px-4 py-4 text-sm text-slate-500">
                                                            {candidate.referenceNumber ??
                                                                "—"}
                                                        </td>

                                                    </tr>
                                                );
                                            }
                                        )}

                                    </tbody>

                                </table>

                            </div>

                        </div>

                    </section>
                )}

                <section className="rounded-[28px] border border-slate-100 bg-white p-7 shadow-sm">

                    <div className="mb-6 flex items-start justify-between">

                        <div>
                            <h2 className="text-[22px] font-bold text-slate-900">
                                Import History
                            </h2>

                            <p className="mt-1 text-[15px] text-slate-500">
                                Previous transaction imports.
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={() =>
                                void loadBatches()
                            }
                            disabled={loading}
                            className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                        >
                            <RefreshCw
                                size={15}
                            />
                            Refresh
                        </button>

                    </div>

                    {loading && (
                        <div className="flex min-h-[180px] items-center justify-center">
                            <p className="text-sm text-slate-400">
                                Loading import history...
                            </p>
                        </div>
                    )}

                    {!loading &&
                        batches.length === 0 && (
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-12">
                                <EmptyState
                                    title="No imports yet"
                                    description="Your completed CSV imports will appear here."
                                />
                            </div>
                        )}

                    {!loading &&
                        batches.length > 0 && (
                            <div className="overflow-hidden rounded-2xl border border-slate-100">

                                <div className="overflow-x-auto">

                                    <table className="w-full text-left">

                                        <thead className="border-b border-slate-100 bg-slate-50">

                                            <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">

                                                <th className="px-4 py-3">
                                                    File
                                                </th>

                                                <th className="px-4 py-3">
                                                    Account
                                                </th>

                                                <th className="px-4 py-3">
                                                    Status
                                                </th>

                                                <th className="px-4 py-3 text-right">
                                                    Total
                                                </th>

                                                <th className="px-4 py-3 text-right">
                                                    Imported
                                                </th>

                                                <th className="px-4 py-3 text-right">
                                                    Duplicates
                                                </th>

                                                <th className="px-4 py-3 text-right">
                                                    Failed
                                                </th>

                                                <th className="px-4 py-3">
                                                    Date
                                                </th>

                                                <th className="px-4 py-3 text-right">
                                                    Details
                                                </th>

                                            </tr>

                                        </thead>

                                        <tbody className="divide-y divide-slate-100">

                                            {batches.map(
                                                batch => (
                                                    <tr
                                                        key={
                                                            batch.id
                                                        }
                                                        className="transition-colors hover:bg-slate-50"
                                                    >

                                                        <td className="px-4 py-4 text-sm font-medium text-slate-900">
                                                            {
                                                                batch.sourceFileName
                                                            }
                                                        </td>

                                                        <td className="px-4 py-4 text-sm text-slate-600">
                                                            {
                                                                batch.accountId
                                                                    ? accountMap.get(
                                                                          batch.accountId
                                                                      ) ??
                                                                      "Unknown account"
                                                                    : "No account"
                                                            }
                                                        </td>

                                                        <td className="px-4 py-4">

                                                            <span
                                                                className={[
                                                                    "inline-flex rounded-full px-2.5 py-1 text-xs font-medium",
                                                                    statusClass(
                                                                        batch.status
                                                                    ),
                                                                ].join(
                                                                    " "
                                                                )}
                                                            >
                                                                {
                                                                    batch.status
                                                                }
                                                            </span>

                                                        </td>

                                                        <td className="px-4 py-4 text-right text-sm text-slate-600">
                                                            {
                                                                batch.totalRows
                                                            }
                                                        </td>

                                                        <td className="px-4 py-4 text-right text-sm font-medium text-emerald-600">
                                                            {
                                                                batch.importedRows
                                                            }
                                                        </td>

                                                        <td className="px-4 py-4 text-right text-sm text-amber-600">
                                                            {
                                                                batch.duplicateRows
                                                            }
                                                        </td>

                                                        <td className="px-4 py-4 text-right text-sm text-red-600">
                                                            {
                                                                batch.failedRows
                                                            }
                                                        </td>

                                                        <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-500">
                                                            {formatDate(
                                                                batch.createdAt
                                                            )}
                                                        </td>

                                                        <td className="px-4 py-4 text-right">

                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    void handleViewDetails(
                                                                        batch
                                                                    )
                                                                }
                                                                disabled={
                                                                    detailsLoading
                                                                }
                                                                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                                                            >
                                                                <Eye
                                                                    size={
                                                                        14
                                                                    }
                                                                />

                                                                View
                                                            </button>

                                                        </td>

                                                    </tr>
                                                )
                                            )}

                                        </tbody>

                                    </table>

                                </div>

                            </div>
                        )}

                </section>

                {selectedBatch && (
                    <div className="rounded-[28px] border border-slate-100 bg-white p-7 shadow-sm">

                        <div className="mb-6 flex items-start justify-between">

                            <div>
                                <h2 className="text-[22px] font-bold text-slate-900">
                                    Import Details
                                </h2>

                                <p className="mt-1 text-[15px] text-slate-500">
                                    {selectedBatch.sourceFileName}
                                    {" · "}
                                    {
                                        selectedRows.length
                                    }{" "}
                                    rows
                                </p>
                            </div>

                            <button
                                type="button"
                                onClick={
                                    closeDetails
                                }
                                className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                            >
                                <X size={15} />
                                Close
                            </button>

                        </div>

                        {detailsLoading ? (
                            <div className="flex min-h-[180px] items-center justify-center">
                                <p className="text-sm text-slate-400">
                                    Loading import details...
                                </p>
                            </div>
                        ) : selectedRows.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center">
                                <p className="text-sm text-slate-500">
                                    No import rows were recorded.
                                </p>
                            </div>
                        ) : (
                            <div className="overflow-hidden rounded-2xl border border-slate-100">

                                <div className="overflow-x-auto">

                                    <table className="w-full min-w-[950px] text-left">

                                        <thead className="border-b border-slate-100 bg-slate-50">

                                            <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">

                                                <th className="px-4 py-3">
                                                    Row
                                                </th>

                                                <th className="px-4 py-3">
                                                    Status
                                                </th>

                                                <th className="px-4 py-3">
                                                    Date
                                                </th>

                                                <th className="px-4 py-3">
                                                    Payee
                                                </th>

                                                <th className="px-4 py-3">
                                                    Amount
                                                </th>

                                                <th className="px-4 py-3">
                                                    Type
                                                </th>

                                                <th className="px-4 py-3">
                                                    Transaction
                                                </th>

                                                <th className="px-4 py-3">
                                                    Message
                                                </th>

                                            </tr>

                                        </thead>

                                        <tbody className="divide-y divide-slate-100">

                                            {selectedRows.map(
                                                row => (
                                                    <tr
                                                        key={
                                                            row.id
                                                        }
                                                        className="align-top hover:bg-slate-50"
                                                    >

                                                        <td className="px-4 py-4 text-sm font-medium text-slate-700">
                                                            {
                                                                row.rowNumber
                                                            }
                                                        </td>

                                                        <td className="px-4 py-4">

                                                            <span
                                                                className={[
                                                                    "inline-flex rounded-full px-2.5 py-1 text-xs font-medium",
                                                                    rowStatusClass(
                                                                        row.status
                                                                    ),
                                                                ].join(
                                                                    " "
                                                                )}
                                                            >
                                                                {
                                                                    row.status
                                                                }
                                                            </span>

                                                        </td>

                                                        <td className="px-4 py-4 text-sm text-slate-600">
                                                            {getNormalizedValue(
                                                                row,
                                                                "transactionDate"
                                                            )}
                                                        </td>

                                                        <td className="px-4 py-4 text-sm text-slate-700">
                                                            {getNormalizedValue(
                                                                row,
                                                                "payee"
                                                            )}
                                                        </td>

                                                        <td className="px-4 py-4 text-sm text-slate-700">
                                                            {getNormalizedValue(
                                                                row,
                                                                "amount"
                                                            )}
                                                        </td>

                                                        <td className="px-4 py-4 text-sm text-slate-600">
                                                            {getNormalizedValue(
                                                                row,
                                                                "type"
                                                            )}
                                                        </td>

                                                        <td className="px-4 py-4 text-xs text-slate-500">
                                                            {row.transactionId ??
                                                                "—"}
                                                        </td>

                                                        <td className="max-w-[260px] px-4 py-4 text-sm text-red-600">
                                                            {
                                                                row.errorMessage
                                                                    ? row.errorMessage
                                                                    : "—"
                                                            }
                                                        </td>

                                                    </tr>
                                                )
                                            )}

                                        </tbody>

                                    </table>

                                </div>

                            </div>
                        )}

                    </div>
                )}

            </div>
        </div>
    );
}










