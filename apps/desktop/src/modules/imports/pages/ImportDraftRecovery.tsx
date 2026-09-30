import { useEffect, useState } from "react";
import { AlertTriangle, Check, History, Loader2 } from "lucide-react";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import type { ImportDraftSummary } from "../types";
import type { ImportDraftSaveStatus } from "./importDraft";

// "You have an unfinished import with 1,407 rows."
export function describeUnfinishedImport(rowCount: number): string {
    return `You have an unfinished import with ${rowCount.toLocaleString(
        "en-US"
    )} row${rowCount === 1 ? "" : "s"}.`;
}

export function formatDraftSavedAt(iso: string): string {
    const date = new Date(iso);

    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function formatDraftSavedTime(iso: string): string {
    const date = new Date(iso);

    return Number.isNaN(date.getTime())
        ? iso
        : date.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
          });
}

// Small status next to the Import Preview title, so the user can see
// their work is protected.
export function ImportDraftSaveIndicator({
    status,
}: {
    status: ImportDraftSaveStatus;
}) {
    if (status.kind === "idle") {
        return null;
    }

    if (status.kind === "saving") {
        return (
            <span
                data-testid="import-draft-status"
                className="inline-flex items-center gap-1 text-xs text-slate-400"
            >
                <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                Saving...
            </span>
        );
    }

    if (status.kind === "error") {
        return (
            <span
                data-testid="import-draft-status"
                title={status.message}
                className="inline-flex items-center gap-1 text-xs font-medium text-amber-600"
            >
                <AlertTriangle size={12} aria-hidden="true" />
                Draft not saved - retrying
            </span>
        );
    }

    return (
        <span
            data-testid="import-draft-status"
            title={`Your progress is saved automatically. Last saved: ${formatDraftSavedAt(status.at)}`}
            className="inline-flex items-center gap-1 text-xs text-emerald-600"
        >
            <Check size={12} aria-hidden="true" />
            Saved {formatDraftSavedTime(status.at)}
        </span>
    );
}

function DraftDetails({
    draft,
    accountName,
}: {
    draft: ImportDraftSummary;
    accountName: string | null;
}) {
    return (
        <span className="mt-3 block rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
            <span className="block">
                File:{" "}
                <span className="font-medium text-slate-800">
                    {draft.fileName}
                </span>
            </span>
            {accountName && (
                <span className="block">
                    Account:{" "}
                    <span className="font-medium text-slate-800">
                        {accountName}
                    </span>
                </span>
            )}
            <span className="block">
                Last saved: {formatDraftSavedAt(draft.updatedAt)}
            </span>
        </span>
    );
}

// "Unfinished Import Found" - shown when the page opens with a saved
// draft. Only Resume or Discard (with a second confirmation) act on it;
// dismissing it keeps the draft, and the banner below stays available.
export function ImportDraftRecoveryDialog({
    open,
    draft,
    accountName,
    resuming,
    discarding,
    error,
    onOpenChange,
    onResume,
    onDiscard,
}: {
    open: boolean;
    draft: ImportDraftSummary | null;
    accountName: string | null;
    resuming: boolean;
    discarding: boolean;
    error: string | null;
    onOpenChange: (open: boolean) => void;
    onResume: () => void;
    onDiscard: () => void;
}) {
    const [confirmDiscard, setConfirmDiscard] = useState(false);
    const busy = resuming || discarding;

    // Always reopen on the first step.
    useEffect(() => {
        if (!open) {
            setConfirmDiscard(false);
        }
    }, [open]);

    return (
        <AlertDialog
            open={open && draft !== null}
            onOpenChange={next => {
                if (!busy) {
                    setConfirmDiscard(false);
                    onOpenChange(next);
                }
            }}
        >
            <AlertDialogContent className="data-[size=default]:sm:max-w-md">
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {confirmDiscard
                            ? "Discard this draft?"
                            : "Unfinished Import Found"}
                    </AlertDialogTitle>

                    <AlertDialogDescription>
                        {draft &&
                            (confirmDiscard
                                ? "Every edit made in this import preview will be lost. This can't be undone. Transactions already in FinWea are not affected."
                                : describeUnfinishedImport(draft.rowCount))}
                        {draft && !confirmDiscard && (
                            <DraftDetails
                                draft={draft}
                                accountName={accountName}
                            />
                        )}
                    </AlertDialogDescription>
                </AlertDialogHeader>

                {error && (
                    <p
                        data-testid="import-draft-error"
                        className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600"
                    >
                        {error}
                    </p>
                )}

                <AlertDialogFooter>
                    {confirmDiscard ? (
                        <>
                            <AlertDialogAction
                                variant="outline"
                                disabled={busy}
                                onClick={() => setConfirmDiscard(false)}
                            >
                                Keep Draft
                            </AlertDialogAction>
                            <AlertDialogAction
                                disabled={busy}
                                onClick={onDiscard}
                                className="bg-red-600 hover:bg-red-700"
                            >
                                {discarding ? "Discarding..." : "Discard Draft"}
                            </AlertDialogAction>
                        </>
                    ) : (
                        <>
                            <AlertDialogAction
                                variant="outline"
                                disabled={busy}
                                onClick={() => setConfirmDiscard(true)}
                                className="h-9 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900"
                            >
                                Discard Draft
                            </AlertDialogAction>
                            <AlertDialogAction
                                disabled={busy || error !== null}
                                onClick={onResume}
                                className="h-9 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
                            >
                                {resuming ? "Restoring..." : "Resume Import"}
                            </AlertDialogAction>
                        </>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

// Inline reminder in the New Import card whenever a saved draft exists
// but isn't open (dialog dismissed, preview cleared, another file
// selected, a failed import...).
export function ImportDraftBanner({
    draft,
    onOpen,
}: {
    draft: ImportDraftSummary;
    onOpen: () => void;
}) {
    return (
        <div
            data-testid="import-draft-banner"
            className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800"
        >
            <History size={16} className="shrink-0" aria-hidden="true" />
            <span className="flex-1">
                {describeUnfinishedImport(draft.rowCount)}{" "}
                <span className="text-blue-600">
                    ({draft.fileName} - last saved{" "}
                    {formatDraftSavedAt(draft.updatedAt)})
                </span>
            </span>
            <button
                type="button"
                onClick={onOpen}
                className="shrink-0 rounded-lg border border-blue-200 bg-white px-3 py-1 text-sm font-semibold text-blue-800 hover:bg-blue-100"
            >
                Resume or Discard...
            </button>
        </div>
    );
}

// Confirmation before a new preview replaces an unfinished draft.
export function ReplaceImportDraftDialog({
    draft,
    open,
    onCancel,
    onConfirm,
}: {
    draft: ImportDraftSummary | null;
    open: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    return (
        <AlertDialog
            open={open}
            onOpenChange={next => {
                if (!next) {
                    onCancel();
                }
            }}
        >
            <AlertDialogContent className="data-[size=default]:sm:max-w-md">
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        Replace your unfinished import?
                    </AlertDialogTitle>

                    <AlertDialogDescription>
                        {draft
                            ? `${describeUnfinishedImport(draft.rowCount)} Previewing a new statement will replace it and its edits can't be recovered.`
                            : "You have an unfinished import. Previewing a new statement will replace it and its edits can't be recovered."}
                        {draft && (
                            <DraftDetails draft={draft} accountName={null} />
                        )}
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <AlertDialogFooter>
                    <AlertDialogAction variant="outline" onClick={onCancel}>
                        Keep Unfinished Import
                    </AlertDialogAction>
                    <AlertDialogAction
                        onClick={onConfirm}
                        className="bg-red-600 hover:bg-red-700"
                    >
                        Replace &amp; Preview
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
