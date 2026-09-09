import {
    signedTransactionAmount,
    useDateFormatter,
} from "@/core/formatting";
import { useEffect, useMemo, useRef, useState } from "react";
import {
    FileUp,
    RefreshCw,
    Eye,
    X,
    CheckCircle2,
    AlertTriangle,
    XCircle,
    Pencil,
    Check,
} from "lucide-react";

import { EmptyState, PageHeader } from "@/components/common";
import { useAccounts } from "@/modules/accounts/hooks";
import type { Account } from "@/modules/accounts/types";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

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

import { ImportService } from "../services";
import type {
    CsvPreviewResultWithLearning,
    ExcelPreviewResult,
} from "../services/ImportService";
import type {
    ImportBatch,
    ImportRow,
} from "../types";

import {
    extractTransactionPattern,
    type CsvColumnMapping,
    type CsvImportType,
    type NormalizedTransactionCandidate,
    type TransactionChannel,
} from "@financeos/import-engine";

import type { ImportMapping } from "../types";

type MappingField = keyof CsvColumnMapping;

export const MAPPING_FIELD_OPTIONS: Array<{
    value: MappingField | "ignore";
    label: string;
}> = [
    { value: "ignore", label: "Ignore" },
    { value: "date", label: "Date" },
    { value: "description", label: "Payee / Description" },
    { value: "amount", label: "Amount" },
    { value: "debit", label: "Debit" },
    { value: "credit", label: "Credit" },
    { value: "type", label: "Type" },
    { value: "referenceNumber", label: "Reference" },
    { value: "externalTransactionId", label: "Transaction ID" },
    { value: "balance", label: "Balance" },
    { value: "branch", label: "Branch" },
    { value: "transactionType", label: "Transaction Type" },
];

// Transaction *channel* (UPI/IMPS/NEFT/RTGS/Cash/Cheque) - separate from
// DR/CR direction. Optional; "" clears it back to blank/undetected.
const TRANSACTION_CHANNEL_OPTIONS: Array<{
    value: TransactionChannel | "";
    label: string;
}> = [
    { value: "", label: "—" },
    { value: "UPI", label: "UPI" },
    { value: "IMPS", label: "IMPS" },
    { value: "NEFT", label: "NEFT" },
    { value: "RTGS", label: "RTGS" },
    { value: "CASH", label: "Cash" },
    { value: "CHEQUE", label: "Cheque" },
    { value: "EMANDATE", label: "E-Mandate" },
    { value: "NET_BANKING", label: "Net Banking" },
    { value: "MOBILE_APP", label: "Mobile App" },
    { value: "CREDIT_CARD", label: "Credit Card" },
];

export interface PreviewOverrides {
    transactionType: Map<number, TransactionChannel | "">;
    payee: Map<number, string>;
    notes: Map<number, string>;
}

export function createEmptyPreviewOverrides(): PreviewOverrides {
    return {
        transactionType: new Map(),
        payee: new Map(),
        notes: new Map(),
    };
}

// Applies per-row Transaction Type / Payee / Notes overrides on top of
// the preview's auto-detected candidates. A row with an override - even
// "" - always wins over whatever was detected; fields with no override
// for a row are left exactly as they were.
export function applyPreviewOverrides(
    candidates: NormalizedTransactionCandidate[],
    overrides: PreviewOverrides
): NormalizedTransactionCandidate[] {
    return candidates.map(candidate => {
        const transactionTypeOverride =
            overrides.transactionType.get(
                candidate.rowNumber
            );

        const payeeOverride =
            overrides.payee.get(
                candidate.rowNumber
            );

        const notesOverride =
            overrides.notes.get(
                candidate.rowNumber
            );

        if (
            transactionTypeOverride === undefined &&
            payeeOverride === undefined &&
            notesOverride === undefined
        ) {
            return candidate;
        }

        return {
            ...candidate,
            transactionType:
                transactionTypeOverride === undefined
                    ? candidate.transactionType
                    : transactionTypeOverride || null,
            payee:
                payeeOverride === undefined
                    ? candidate.payee
                    : payeeOverride,
            notes:
                notesOverride === undefined
                    ? candidate.notes
                    : notesOverride || null,
        };
    });
}

// A row's learning key: the same "shape" of narration text used by the
// persistent account-scoped Payee/Type/Notes learning (see
// extractTransactionPattern in @financeos/import-engine). Deliberately
// derived from Description alone, never Payee - Payee is user-editable
// (and gets overwritten by a learned rule during enrichment), so basing
// the pattern on it would make the learning key itself shift out from
// under an edit/enrichment instead of staying a stable identity for the
// transaction. A row with no Description at all simply has no learning
// pattern (null) rather than falling back to the unstable field.
function learningPatternForCandidate(
    candidate: NormalizedTransactionCandidate
): string | null {
    return extractTransactionPattern(
        candidate.description
    );
}

// When the user manually edits Payee, Type, or Notes for one row, this
// applies that same value to every *other* row in the current import
// preview whose detected Payee/Description matches the same learning
// pattern - so a single correction fills in the whole statement, not
// just the edited row. Never overwrites a row that already has its own
// override for this field (a prior manual edit, or an earlier auto-fill
// from this same function) - only rows still showing their original,
// unconfirmed value are touched. Clearing a field back to blank ("")
// never propagates. Shared by applyPayeeToMatchingRows /
// applyTransactionTypeToMatchingRows / applyNotesToMatchingRows below -
// purely an in-preview convenience, independent of (and in addition to)
// the persistent account-scoped learning (see ImportService's
// enrichCandidatesWithLearnedRules / learnRuleFromCandidate), which is
// applied on the next import into the same account.
//
// `baselineValue` (optional) is this row's pre-session value for this
// field - i.e. exactly what it would show with zero overrides applied
// (see ImportsPage's preview.candidates, never previewCandidates, which
// already has overrides layered in). When the user's final edit exactly
// matches it, that's treated as an UNDO rather than a new correction:
// this row's own override is removed entirely (falling back to its true
// original state - GREEN or blank, whichever it was before any edit),
// and so is every matching row's override that is still exactly the
// value THIS row had a moment ago (`existing.get(rowNumber)`) - i.e.
// every row that was only following this edit's propagation and was
// never independently re-edited since. A row with its own distinct
// value (a separate, independent edit) is left untouched either way.
// Omitting `baselineValue` (e.g. the Self-Learning toggle's boolean
// on/off, which has no notion of an "original" value to revert to)
// preserves the exact prior set-and-propagate-only behavior.
function applyOverrideToMatchingRows<Value>(
    candidates: NormalizedTransactionCandidate[],
    existing: Map<number, Value>,
    rowNumber: number,
    value: Value,
    baselineValue?: Value
): Map<number, Value> {
    // Known limitation: undo is detected purely by value equality, with
    // no per-entry "which row's edit originally set this" provenance.
    // Undoing via the row that was actually, directly edited (the
    // common case this exists for) correctly reverts every row that
    // only followed it. Undoing via a FOLLOWER row instead - typing
    // that row's own original value back in, even though it's currently
    // just mirroring a sibling's edit - can't distinguish "diverge this
    // row from the group" from "undo the group's edit", and currently
    // does the latter (removing the true originating row's edit too).
    // Acceptable for now: not a case the current UX asks for.
    const editedCandidate = candidates.find(
        candidate => candidate.rowNumber === rowNumber
    );

    if (
        editedCandidate &&
        baselineValue !== undefined &&
        value === baselineValue
    ) {
        const oldValue = existing.get(
            rowNumber
        );

        const next = new Map(existing);

        next.delete(rowNumber);

        const pattern =
            learningPatternForCandidate(
                editedCandidate
            );

        if (
            pattern &&
            oldValue !== undefined
        ) {
            for (const candidate of candidates) {
                if (
                    candidate.rowNumber ===
                    rowNumber
                ) {
                    continue;
                }

                if (
                    existing.get(
                        candidate.rowNumber
                    ) !== oldValue
                ) {
                    continue;
                }

                if (
                    learningPatternForCandidate(
                        candidate
                    ) !== pattern
                ) {
                    continue;
                }

                next.delete(
                    candidate.rowNumber
                );
            }
        }

        return next;
    }

    const next = new Map(
        existing
    ).set(rowNumber, value);

    const pattern = value
        ? editedCandidate &&
          learningPatternForCandidate(editedCandidate)
        : null;

    if (pattern) {
        for (const candidate of candidates) {
            if (candidate.rowNumber === rowNumber) {
                continue;
            }

            if (
                next.has(
                    candidate.rowNumber
                )
            ) {
                continue;
            }

            if (
                learningPatternForCandidate(
                    candidate
                ) === pattern
            ) {
                next.set(
                    candidate.rowNumber,
                    value
                );
            }
        }
    }

    return next;
}

export function applyPayeeToMatchingRows(
    candidates: NormalizedTransactionCandidate[],
    overrides: PreviewOverrides,
    rowNumber: number,
    value: string
): PreviewOverrides {
    const baselineCandidate = candidates.find(
        candidate => candidate.rowNumber === rowNumber
    );

    return {
        ...overrides,
        payee: applyOverrideToMatchingRows(
            candidates,
            overrides.payee,
            rowNumber,
            value,
            baselineCandidate?.payee ?? ""
        ),
    };
}

export function applyTransactionTypeToMatchingRows(
    candidates: NormalizedTransactionCandidate[],
    overrides: PreviewOverrides,
    rowNumber: number,
    value: TransactionChannel | ""
): PreviewOverrides {
    const baselineCandidate = candidates.find(
        candidate => candidate.rowNumber === rowNumber
    );

    return {
        ...overrides,
        transactionType: applyOverrideToMatchingRows(
            candidates,
            overrides.transactionType,
            rowNumber,
            value,
            baselineCandidate?.transactionType ?? ""
        ),
    };
}

export function applyNotesToMatchingRows(
    candidates: NormalizedTransactionCandidate[],
    overrides: PreviewOverrides,
    rowNumber: number,
    value: string
): PreviewOverrides {
    const baselineCandidate = candidates.find(
        candidate => candidate.rowNumber === rowNumber
    );

    return {
        ...overrides,
        notes: applyOverrideToMatchingRows(
            candidates,
            overrides.notes,
            rowNumber,
            value,
            baselineCandidate?.notes ?? ""
        ),
    };
}

// Per-row Self-Learning opt-out, keyed by candidate.rowNumber - `true`
// means self-learning is OFF for that row on THIS import only; absence
// (the default/empty map) means self-learning is ON, preserving the
// pre-existing behavior. This never touches whether a previously-learned
// rule is still *applied* to enrich the row (see
// enrichCandidatesWithLearnedRules) - it only controls whether *this*
// import's final values get written back via learnRuleFromCandidate, and
// never deletes/disables an already-learned rule either way.
//
// Turning Self-Learning OFF for one row also turns it off for every other
// row in the current preview sharing the same learning pattern (see
// applyOverrideToMatchingRows, shared with the Payee/Type/Notes
// overrides) - so a single opt-out consistently excludes the whole
// recurring narration from this import's learning, rather than leaving a
// sibling row to silently write the same rule back anyway. Turning it
// back ON only affects the toggled row, and never overwrites a row that
// already has its own explicit choice recorded.
export function applySelfLearningToMatchingRows(
    candidates: NormalizedTransactionCandidate[],
    disabledRows: Map<number, boolean>,
    rowNumber: number,
    disabled: boolean
): Map<number, boolean> {
    return applyOverrideToMatchingRows(
        candidates,
        disabledRows,
        rowNumber,
        disabled
    );
}

// Rows that count as "newly learned during this preview/import session" -
// the Self-Learning indicator's BLUE state. A row qualifies when:
//   1. no *existing* learned rule already matched it (see
//      matchedLearnedRuleRowNumbers - those rows are GREEN, never blue,
//      even if also edited this session), and
//   2. its learning pattern exists (see learningPatternForCandidate) and
//      its final Payee (after overrides) is non-blank - the same guard
//      learnRuleFromCandidate itself uses, since there'd be nothing to
//      learn otherwise, and
//   3. it has a Payee/Type/Notes override recorded for this row - either
//      from being directly edited, or from matching-row propagation (see
//      applyPayeeToMatchingRows / applyTransactionTypeToMatchingRows /
//      applyNotesToMatchingRows above) - which is what makes an edit to
//      one row "spread" blue to every other row sharing its pattern,
//      using the exact same propagation the override values themselves
//      already go through, rather than a second, parallel mechanism.
//
// `candidates` must be the *final* (post-override) candidates - see
// ImportsPage's previewCandidates - so the blank-Payee guard reflects
// what would actually be learned, not the original detected value.
// Purely a preview-time computation; it never writes anything anywhere -
// the only thing that persists a rule is learnRuleFromCandidate, called
// exclusively from ImportService.executeCandidates during Import.
export function deriveSessionLearnedRowNumbers(
    candidates: NormalizedTransactionCandidate[],
    overrides: PreviewOverrides,
    matchedLearnedRuleRowNumbers: ReadonlySet<number>
): Set<number> {
    const rowNumbers = new Set<number>();

    for (const candidate of candidates) {
        if (
            matchedLearnedRuleRowNumbers.has(
                candidate.rowNumber
            )
        ) {
            continue;
        }

        if (!candidate.payee) {
            continue;
        }

        if (
            !learningPatternForCandidate(
                candidate
            )
        ) {
            continue;
        }

        const hasOverrideThisSession =
            overrides.payee.has(
                candidate.rowNumber
            ) ||
            overrides.transactionType.has(
                candidate.rowNumber
            ) ||
            overrides.notes.has(
                candidate.rowNumber
            );

        if (hasOverrideThisSession) {
            rowNumbers.add(
                candidate.rowNumber
            );
        }
    }

    return rowNumbers;
}

export type SelfLearningIndicatorState =
    | "green"
    | "blue"
    | "blank";

export interface SelfLearningIndicator {
    // An existing (pre-session) learned rule matched this row - see
    // matchedLearnedRuleRowNumbers.
    hasMatchedLearnedRule: boolean;
    // No existing rule matched, but this row was newly learned from an
    // edit made during this session - see
    // deriveSessionLearnedRowNumbers.
    isSessionLearnedRule: boolean;
    // Whether the Self-Learning toggle button does anything for this
    // row at all - true for both GREEN and BLUE rows, false for a truly
    // blank row (never creates a rule by itself - see
    // handleToggleSelfLearning's call site, which is gated on this).
    clickable: boolean;
    // The rendered color: GREEN (existing rule), BLUE (newly learned
    // this session), or BLANK (either nothing to learn, or the user
    // already clicked the check to unlearn it for this session - both
    // render identically blank, per the Self-Learning UX spec).
    state: SelfLearningIndicatorState;
}

// The single source of truth for the Self-Learning indicator's
// green/blue/blank rendering AND whether its toggle button is
// clickable - combines the existing-rule state (matchedLearnedRuleRowNumbers),
// this session's newly-learned state (sessionLearnedRowNumbers, see
// deriveSessionLearnedRowNumbers), and the per-row "unlearned for this
// session" opt-out (selfLearningDisabledRows, see
// applySelfLearningToMatchingRows) into one place, so the render loop
// below never computes these independently.
export function resolveSelfLearningIndicator(
    rowNumber: number,
    matchedLearnedRuleRowNumbers: ReadonlySet<number>,
    sessionLearnedRowNumbers: ReadonlySet<number>,
    selfLearningDisabledRows: ReadonlyMap<number, boolean>
): SelfLearningIndicator {
    const hasMatchedLearnedRule =
        matchedLearnedRuleRowNumbers.has(
            rowNumber
        );

    const isSessionLearnedRule =
        !hasMatchedLearnedRule &&
        sessionLearnedRowNumbers.has(
            rowNumber
        );

    const clickable =
        hasMatchedLearnedRule ||
        isSessionLearnedRule;

    // Clicking the check unlearns it for this session -> blank. A row
    // that was never clickable in the first place is also blank, but
    // never counts as "disabled" (there was nothing to disable).
    const disabled =
        clickable &&
        (selfLearningDisabledRows.get(
            rowNumber
        ) ??
            false);

    const state: SelfLearningIndicatorState =
        disabled
            ? "blank"
            : hasMatchedLearnedRule
                ? "green"
                : isSessionLearnedRule
                    ? "blue"
                    : "blank";

    return {
        hasMatchedLearnedRule,
        isSessionLearnedRule,
        clickable,
        state,
    };
}

// Whether a file name has an Excel extension - the single source of
// truth for "is this file Excel", reused by both the auto "Bank Excel"
// Import Type selection (handleFileChange) and the actual preview
// routing (handlePreview, which always routes .xlsx/.xls to
// service.previewExcel regardless of the selected Import Type - that
// routing is untouched here).
export function isExcelFileName(fileName: string): boolean {
    return /\.xlsx?$/i.test(fileName);
}

// Which FinanceOS field (if any) a given source column is currently
// mapped to.
function fieldForHeader(
    mapping: CsvColumnMapping,
    header: string
): MappingField | "ignore" {
    const entry = (
        Object.entries(mapping) as Array<
            [MappingField, string | undefined]
        >
    ).find(([, value]) => value === header);

    return entry ? entry[0] : "ignore";
}

// Masked last 4 digits of the account number, e.g. "****1234". Omitted
// entirely when there is no account number. Never exposes the full number.
function maskedAccountTail(account: Account): string {
    const tail = (account.accountNumber ?? "")
        .replace(/\D/g, "")
        .slice(-4);

    return tail ? `****${tail}` : "";
}

function accountOptionLabel(account: Account): string {
    return [
        account.name,
        maskedAccountTail(account),
        account.institutionName,
    ]
        .filter(Boolean)
        .join(" — ");
}

// Same currency formatting as the Transactions list (TransactionTable) -
// debit/expense amounts show with a leading "-", credit/income with a
// leading "+" (via signedTransactionAmount + signDisplay), everything else
// unchanged.
function formatAmount(amount: number): string {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2,
        signDisplay: "exceptZero",
    }).format(Number(amount ?? 0));
}

export default function ImportsPage() {
    const formatDate = useDateFormatter();
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
        useState<(CsvPreviewResultWithLearning | ExcelPreviewResult) | null>(null);

    // Editable "Detected Mapping of: [ ... ]" name. Pre-filled from a
    // matching saved mapping when one is found, otherwise from the
    // auto-detected institution - always user-editable either way.
    const [mappingName, setMappingName] =
        useState("");

    const [matchedMapping, setMatchedMapping] =
        useState<ImportMapping | null>(null);

    // Per-row Transaction Type / Payee / Notes overrides, each keyed by
    // candidate.rowNumber. A manual entry here always wins over the
    // auto-detected/suggested value; "" means "explicitly cleared back
    // to blank" (distinct from "no override yet", which falls back to
    // the detected/suggested value).
    const [previewOverrides, setPreviewOverrides] =
        useState<PreviewOverrides>(
            createEmptyPreviewOverrides()
        );

    // Live, per-keystroke Payee/Notes text - kept OUT of
    // previewOverrides entirely while the user is still typing (see
    // handlePayeeOverride/handleNotesOverride below), so previewOverrides
    // always reflects only the last *committed* (on-blur) value for a
    // row. That matters for undo-detection in
    // applyPayeeToMatchingRows/applyNotesToMatchingRows: if live typing
    // wrote into previewOverrides on every keystroke, by the time a
    // revert-to-original edit was committed, the row's own prior
    // (propagated) value would already have been overwritten character by
    // character, and there'd be nothing left to compare matching rows
    // against to know which of them were only following this edit.
    // Cleared for a row the moment its edit is committed (blur) - see
    // handlePayeeOverrideCommit/handleNotesOverrideCommit.
    const [payeeDrafts, setPayeeDrafts] =
        useState<Map<number, string>>(
            new Map()
        );

    const [notesDrafts, setNotesDrafts] =
        useState<Map<number, string>>(
            new Map()
        );

    // Rows with an explicit Self-Learning choice for this import, keyed by
    // candidate.rowNumber (true = toggled OFF). Empty by default -
    // preserves existing self-learning behavior for every eligible row
    // until a user explicitly opts one out. Reset alongside
    // previewOverrides whenever a new file is selected, a new preview
    // loads, or an import completes.
    const [selfLearningDisabledRows, setSelfLearningDisabledRows] =
        useState<Map<number, boolean>>(new Map());

    const handleToggleSelfLearning = (
        rowNumber: number
    ) => {
        setSelfLearningDisabledRows(previous => {
            const currentlyDisabled =
                previous.get(rowNumber) ?? false;

            return applySelfLearningToMatchingRows(
                previewCandidates,
                previous,
                rowNumber,
                !currentlyDisabled
            );
        });
    };

    // Whether the "clear all self-learned rules" confirmation dialog is
    // open - see the header tick above the "Row" column in the Import
    // Preview table.
    const [clearRulesDialogOpen, setClearRulesDialogOpen] =
        useState(false);

    const [clearingRules, setClearingRules] =
        useState(false);

    // The value being viewed in the full-text popover (Description
    // click-to-view), or null when closed.
    const [fullTextView, setFullTextView] =
        useState<{
            label: string;
            value: string;
        } | null>(null);

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

    const [mappingUpdating, setMappingUpdating] =
        useState(false);

    const [importing, setImporting] =
        useState(false);

    const [error, setError] =
        useState<string | null>(null);

    const [message, setMessage] =
        useState<string | null>(null);

    // Saved Mappings management list (see the "Saved Mappings" section
    // below) - every persisted mapping, independent of the currently
    // uploaded file's header structure (unlike matchedMapping above,
    // which only ever surfaces a mapping matching the current file).
    const [mappings, setMappings] =
        useState<ImportMapping[]>([]);

    const [mappingsLoading, setMappingsLoading] =
        useState(true);

    // The mapping currently being renamed (id + in-progress edited
    // name), or null when no row is in edit mode.
    const [editingMapping, setEditingMapping] =
        useState<{
            id: string;
            name: string;
        } | null>(null);

    const [renamingMapping, setRenamingMapping] =
        useState(false);

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

    const loadMappings = async () => {
        try {
            setMappingsLoading(true);
            setError(null);

            const data =
                await service.listMappings();

            setMappings(data);
        } catch (err) {
            console.error(
                "SAVED MAPPINGS LOAD ERROR:",
                err
            );

            setError(
                err instanceof Error
                    ? err.message
                    : String(err)
            );
        } finally {
            setMappingsLoading(false);
        }
    };

    useEffect(() => {
        void loadMappings();
    }, []);

    const handleStartRenameMapping = (
        mapping: ImportMapping
    ) => {
        setError(null);
        setEditingMapping({
            id: mapping.id,
            name: mapping.name,
        });
    };

    const handleCancelRenameMapping = () => {
        setEditingMapping(null);
    };

    // Renames a Saved Mapping's name only - its column mapping/rules are
    // never touched (see ImportService.renameMapping/
    // ImportMappingRepository.rename). Existing canonical transactions
    // created from this mapping are kept in sync (source_statement,
    // i.e. Transactions -> Mapping Name) by the same call.
    const handleSaveRenameMapping = async () => {
        if (!editingMapping) {
            return;
        }

        const trimmedName = editingMapping.name.trim();

        if (!trimmedName) {
            setError("Mapping name cannot be empty.");
            return;
        }

        try {
            setRenamingMapping(true);
            setError(null);

            const renamed =
                await service.renameMapping(
                    editingMapping.id,
                    trimmedName
                );

            setMappings(previous =>
                previous
                    .map(mapping =>
                        mapping.id === renamed.id
                            ? renamed
                            : mapping
                    )
                    .sort((a, b) =>
                        a.name.localeCompare(b.name)
                    )
            );

            // The "Detected Mapping" panel above may currently be
            // showing this exact mapping (matchedMapping) - keep its
            // displayed name in sync too, without touching anything
            // else about the active preview/mapping.
            setMatchedMapping(previous =>
                previous?.id === renamed.id
                    ? renamed
                    : previous
            );

            setMappingName(previous =>
                matchedMapping?.id === renamed.id
                    ? renamed.name
                    : previous
            );

            setMessage(
                `Mapping renamed to "${renamed.name}".`
            );

            setEditingMapping(null);
        } catch (err) {
            console.error(
                "SAVED MAPPING RENAME ERROR:",
                err
            );

            setError(
                err instanceof Error
                    ? err.message
                    : String(err)
            );
        } finally {
            setRenamingMapping(false);
        }
    };

    const handleFileChange = (
        event: React.ChangeEvent<HTMLInputElement>
    ) => {
        const file =
            event.target.files?.[0] ?? null;

        setSelectedFile(file);

        // An Excel file's format is unambiguous from its extension, so
        // Import Type defaults to "Bank Excel" without requiring the
        // user to pick it manually - matching the same detection
        // handlePreview already uses to route to previewExcel. Any
        // other file (CSV/PDF) leaves Import Type exactly as it was -
        // unchanged CSV/PDF behavior.
        if (
            file &&
            isExcelFileName(file.name)
        ) {
            setImportType("BANK_EXCEL");
        }

        setPreview(null);
        setMappingName("");
        setMatchedMapping(null);
        setPreviewOverrides(
            createEmptyPreviewOverrides()
        );
        setPayeeDrafts(new Map());
        setNotesDrafts(new Map());
        setSelfLearningDisabledRows(new Map());
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
                "Please select a Statement File."
            );
            return;
        }

        try {
            setPreviewing(true);
            setError(null);
            setMessage(null);

            const isPdf =
                /\.pdf$/i.test(
                    selectedFile.name
                );

            const isExcel =
                isExcelFileName(
                    selectedFile.name
                );

            let result;

            if (isPdf) {
                const content =
                    await selectedFile.arrayBuffer();

                result =
                    await service.previewPdf(
                        selectedAccountId,
                        content,
                        importType
                    );
            } else if (isExcel) {
                const content =
                    await selectedFile.arrayBuffer();

                result =
                    await service.previewExcel(
                        selectedAccountId,
                        content,
                        undefined,
                        importType
                    );
            } else {
                const content =
                    await selectedFile.text();

                result =
                    await service.previewCsv(
                        selectedAccountId,
                        content,
                        importType
                    );
            }

            // Analyze the file first (already done above), then look for
            // a previously confirmed mapping whose source column
            // structure matches this file exactly - not just its
            // detected institution - and reuse it automatically when
            // found.
            const saved =
                await service.findMatchingMapping(
                    result.document.headers,
                    importType
                );

            if (saved) {
                const remapped =
                    await service.previewWithMapping(
                        selectedAccountId,
                        result.document,
                        saved.mapping,
                        importType
                    );

                setPreview({
                    ...remapped,
                    institutionName:
                        result.institutionName,
                });

                setMappingName(saved.name);
                setMatchedMapping(saved);
            } else {
                setPreview(result);
                setMappingName(
                    result.institutionName ?? ""
                );
                setMatchedMapping(null);
            }

            setPreviewOverrides(
                createEmptyPreviewOverrides()
            );
            setPayeeDrafts(new Map());
            setNotesDrafts(new Map());
            setSelfLearningDisabledRows(new Map());
        } catch (err) {
            console.error(
                "STATEMENT PREVIEW ERROR:",
                err
            );

            setPreview(null);
            setMappingName("");
            setMatchedMapping(null);
            setPreviewOverrides(
                createEmptyPreviewOverrides()
            );
            setPayeeDrafts(new Map());
            setNotesDrafts(new Map());
            setSelfLearningDisabledRows(new Map());

            setError(
                err instanceof Error
                    ? err.message
                    : String(err)
            );
        } finally {
            setPreviewing(false);
        }
    };

    const handleMappingChange = async (
        header: string,
        field: MappingField | "ignore"
    ) => {
        if (!preview || !selectedAccountId) {
            return;
        }

        const nextMapping: CsvColumnMapping = {
            ...preview.mapping,
        };

        for (const key of Object.keys(
            nextMapping
        ) as MappingField[]) {
            if (nextMapping[key] === header) {
                delete nextMapping[key];
            }
        }

        if (field !== "ignore") {
            nextMapping[field] = header;
        }

        try {
            setMappingUpdating(true);
            setError(null);

            const result =
                await service.previewWithMapping(
                    selectedAccountId,
                    preview.document,
                    nextMapping,
                    importType
                );

            setPreview({
                ...result,
                institutionName:
                    preview.institutionName,
            });
        } catch (err) {
            console.error(
                "IMPORT MAPPING UPDATE ERROR:",
                err
            );

            setError(
                err instanceof Error
                    ? err.message
                    : String(err)
            );
        } finally {
            setMappingUpdating(false);
        }
    };

    // Permanently deletes every persisted self-learned rule (see
    // ImportService.clearAllLearnedRules / CounterpartyRuleRepository.
    // deleteAll - existing, unmodified account-scoped learning store),
    // then re-runs the SAME preview enrichment (previewWithMapping, exactly
    // as handleMappingChange above already does) against the unchanged
    // document/mapping - the only way matchedLearnedRuleRowNumbers and the
    // GREEN indicator/candidate data ever get computed, left entirely
    // untouched here. Deliberately leaves previewOverrides/payeeDrafts/
    // notesDrafts/selfLearningDisabledRows exactly as they are: this
    // clears *persisted* rules, not anything about the current session's
    // edits - a row that was GREEN (matched) and also edited this session
    // correctly falls back to BLUE afterward, purely as a side effect of
    // matchedLearnedRuleRowNumbers no longer including it (see
    // deriveSessionLearnedRowNumbers/resolveSelfLearningIndicator, neither
    // of which is touched by this).
    const handleClearAllLearnedRules = async () => {
        if (!preview || !selectedAccountId) {
            setClearRulesDialogOpen(false);
            return;
        }

        try {
            setClearingRules(true);
            setError(null);

            await service.clearAllLearnedRules();

            const result =
                await service.previewWithMapping(
                    selectedAccountId,
                    preview.document,
                    preview.mapping,
                    importType
                );

            setPreview({
                ...result,
                institutionName:
                    preview.institutionName,
            });

            setMessage(
                "All self-learned rules have been cleared."
            );
        } catch (err) {
            console.error(
                "CLEAR LEARNED RULES ERROR:",
                err
            );

            setError(
                err instanceof Error
                    ? err.message
                    : String(err)
            );
        } finally {
            setClearingRules(false);
            setClearRulesDialogOpen(false);
        }
    };

    // A manual per-row Transaction Type selection always overrides
    // whatever was auto-detected (or explicitly mapped) for that row,
    // and is learned in-preview: it's also applied to every other row
    // whose detected Payee/Description matches the same pattern (see
    // applyTransactionTypeToMatchingRows) - never overwriting a row
    // that already has its own override. A <select> fires once per
    // choice (never per-keystroke like a text field), so it's safe to
    // propagate directly on change - no separate commit step needed.
    // Uses the BASELINE (pre-override) candidates - see
    // preview.candidates - so undo-detection compares against this
    // row's true pre-session value, not whatever another field's
    // override may currently show.
    const handleTransactionTypeOverride = (
        rowNumber: number,
        value: TransactionChannel | ""
    ) => {
        setPreviewOverrides(previous =>
            applyTransactionTypeToMatchingRows(
                preview?.candidates ?? [],
                previous,
                rowNumber,
                value
            )
        );
    };

    // Live per-keystroke Payee edits: updates only this row's on-screen
    // draft text, exactly as typed so far - see payeeDrafts above.
    // Deliberately never touches previewOverrides (the committed
    // session-learning state) per keystroke - see
    // handlePayeeOverrideCommit, which commits once the edit is
    // finished, using the field's final value.
    const handlePayeeOverride = (
        rowNumber: number,
        value: string
    ) => {
        setPayeeDrafts(previous =>
            new Map(previous).set(
                rowNumber,
                value
            )
        );
    };

    // Fires once an edit to the Payee field is finished (on blur), with
    // its final value - never on every keystroke, which would otherwise
    // propagate each intermediate partial value in turn and leave
    // matching rows stuck on a stale fragment instead of the final text
    // (see applyPayeeToMatchingRows's "own override" guard). Applies
    // that final value to every other row in the current import whose
    // detected Payee/Description matches the same pattern - never
    // overwriting a row that already has its own override. If the final
    // value exactly matches this row's original (pre-session) Payee,
    // this is instead treated as an undo - see
    // applyPayeeToMatchingRows/applyOverrideToMatchingRows - clearing
    // this row's session-learned status and that of any matching row
    // that only received it from this same edit. Clears the live draft
    // either way, since previewOverrides now reflects the committed
    // outcome.
    const handlePayeeOverrideCommit = (
        rowNumber: number,
        value: string
    ) => {
        setPreviewOverrides(previous =>
            applyPayeeToMatchingRows(
                preview?.candidates ?? [],
                previous,
                rowNumber,
                value
            )
        );

        setPayeeDrafts(previous => {
            if (!previous.has(rowNumber)) {
                return previous;
            }

            const next = new Map(previous);

            next.delete(rowNumber);

            return next;
        });
    };

    // Live per-keystroke Notes edits - see handlePayeeOverride, same
    // reasoning: updates only the on-screen draft, never
    // previewOverrides, per keystroke.
    const handleNotesOverride = (
        rowNumber: number,
        value: string
    ) => {
        setNotesDrafts(previous =>
            new Map(previous).set(
                rowNumber,
                value
            )
        );
    };

    // Fires once an edit to the Notes field is finished (on blur) - see
    // handlePayeeOverrideCommit, same reasoning, including undo
    // detection and clearing the live draft.
    const handleNotesOverrideCommit = (
        rowNumber: number,
        value: string
    ) => {
        setPreviewOverrides(previous =>
            applyNotesToMatchingRows(
                preview?.candidates ?? [],
                previous,
                rowNumber,
                value
            )
        );

        setNotesDrafts(previous => {
            if (!previous.has(rowNumber)) {
                return previous;
            }

            const next = new Map(previous);

            next.delete(rowNumber);

            return next;
        });
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
                "Please select a Statement File."
            );
            return;
        }

        if (!preview) {
            setError(
                "Please preview the statement before importing."
            );
            return;
        }

        if (previewErrorRows > 0) {
            setError(
                "The statement contains validation errors. Correct the file before importing."
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

            // The same Mapping Name shown/edited in the "Detected Mapping"
            // panel and saved below via saveMapping - computed once and
            // reused for both, so every transaction created from this
            // import is stamped with the exact Mapping Name it'll later be
            // filterable by on the Transactions page.
            const savedName =
                mappingName.trim() ||
                preview.institutionName ||
                "Custom Mapping";

            // Which rows had Self-Learning explicitly toggled off for this
            // import (see applySelfLearningToMatchingRows) - the service
            // layer only needs the row numbers, not how the UI tracks
            // them.
            const selfLearningDisabledRowNumbers = new Set(
                Array.from(
                    selfLearningDisabledRows.entries()
                )
                    .filter(([, disabled]) => disabled)
                    .map(([rowNumber]) => rowNumber)
            );

            // Import exactly what was previewed and approved - the same
            // candidates shown in the table, including any per-row
            // Transaction Type overrides - rather than re-parsing the
            // file and re-running auto-detection from scratch.
            const batch =
                await service.importCandidates(
                    selectedAccountId,
                    selectedFile.name,
                    importType,
                    previewCandidates,
                    savedName,
                    selfLearningDisabledRowNumbers
                );

            try {
                await service.saveMapping({
                    name: savedName,
                    institutionName:
                        preview.institutionName,
                    headers:
                        preview.document.headers,
                    mapping: preview.mapping,
                    importType,
                });

                void loadMappings();
            } catch (mappingSaveError) {
                // Saving the mapping for reuse is a convenience, not a
                // requirement for the import itself to succeed.
                console.error(
                    "IMPORT MAPPING SAVE ERROR:",
                    mappingSaveError
                );
            }

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
            setMappingName("");
            setMatchedMapping(null);
            setPreviewOverrides(
                createEmptyPreviewOverrides()
            );
            setPayeeDrafts(new Map());
            setNotesDrafts(new Map());
            setSelfLearningDisabledRows(new Map());

            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }

            await loadBatches();
        } catch (err) {
            console.error(
                "STATEMENT IMPORT ERROR:",
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

    // The preview's auto-detected/suggested candidates with any per-row
    // Transaction Type / Payee / Notes overrides applied on top - this
    // is what's shown in the table and what actually gets imported.
    const previewCandidates: NormalizedTransactionCandidate[] =
        applyPreviewOverrides(
            preview?.candidates ?? [],
            previewOverrides
        );

    // Which rows an existing self-learned rule actually matched during
    // preview enrichment (see ImportService's
    // enrichCandidatesWithLearnedRulesDetailed) - the single source of
    // truth for the Self-Learning indicator below, never recomputed here.
    const matchedLearnedRuleRowNumbers: ReadonlySet<number> =
        preview?.matchedLearnedRuleRowNumbers ?? new Set();

    // Rows newly learned from an edit made during this preview/import
    // session (the Self-Learning indicator's BLUE state) - see
    // deriveSessionLearnedRowNumbers. Recomputed from previewCandidates
    // (post-override) and previewOverrides on every render, so an edit
    // (and its matching-row propagation, already applied above via
    // applyPreviewOverrides) is reflected immediately - before Import.
    const sessionLearnedRowNumbers: ReadonlySet<number> =
        useMemo(
            () =>
                deriveSessionLearnedRowNumbers(
                    previewCandidates,
                    previewOverrides,
                    matchedLearnedRuleRowNumbers
                ),
            [
                previewCandidates,
                previewOverrides,
                matchedLearnedRuleRowNumbers,
            ]
        );

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
                    subtitle="Import bank or credit card transactions from a Statement File."
                />

                <section className="rounded-[28px] border border-slate-100 bg-white p-7 shadow-sm">

                    <div>
                        <h2 className="text-[22px] font-bold text-slate-900">
                            New Import
                        </h2>

                        <p className="mt-1 text-[15px] text-slate-500">
                            Select the account and Statement File you want to import.
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

                                <option value="BANK_EXCEL">
                                    Bank Excel
                                </option>

                                <option value="BANK_PDF">
                                    Bank PDF
                                </option>

                                <option value="CREDIT_CARD_CSV">
                                    Credit Card CSV
                                </option>

                                <option value="CREDIT_CARD_PDF">
                                    Credit Card PDF
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
                                                accountOptionLabel(
                                                    account
                                                )
                                            }
                                        </option>
                                    )
                                )}
                            </select>
                        </div>

                        <div>
                            <label className="mb-2 block text-sm font-medium text-slate-700">
                                Statement File
                            </label>

                            <input
                                ref={
                                    fileInputRef
                                }
                                type="file"
                                accept=".csv,.xlsx,.xls,.pdf,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
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
                                    : "Preview"}
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
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                            Detected Mapping
                                        </div>

                                        <p className="mt-0.5 text-xs text-slate-400">
                                            Source column → FinanceOS field. Change any mapping the detection got wrong.
                                        </p>
                                    </div>

                                    <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                                        Mapping Name:

                                        <input
                                            type="text"
                                            value={mappingName}
                                            onChange={event =>
                                                setMappingName(
                                                    event.target.value
                                                )
                                            }
                                            placeholder="e.g. Axis Bank"
                                            disabled={
                                                mappingUpdating ||
                                                importing
                                            }
                                            className="h-8 w-56 rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium text-slate-800 outline-none transition focus:border-slate-400 disabled:bg-slate-50"
                                        />
                                    </label>
                                </div>

                                {matchedMapping && (
                                    <p className="mt-2 text-xs text-emerald-600">
                                        Loaded from a saved mapping for this statement format — edit the name or any field above and it will be updated when you import.
                                    </p>
                                )}
                            </div>

                            <div className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 sm:grid-cols-2 lg:grid-cols-3">

                                {preview.document.headers.map(
                                    header => (
                                        <div
                                            key={header}
                                            className="text-sm"
                                        >
                                            <div
                                                className="truncate text-xs text-slate-400"
                                                title={header}
                                            >
                                                {header}
                                            </div>

                                            <select
                                                value={fieldForHeader(
                                                    preview.mapping,
                                                    header
                                                )}
                                                onChange={event =>
                                                    void handleMappingChange(
                                                        header,
                                                        event.target
                                                            .value as
                                                            | MappingField
                                                            | "ignore"
                                                    )
                                                }
                                                disabled={
                                                    mappingUpdating ||
                                                    importing
                                                }
                                                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium text-slate-800 outline-none transition focus:border-slate-400 disabled:bg-slate-50"
                                            >
                                                {MAPPING_FIELD_OPTIONS.map(
                                                    option => (
                                                        <option
                                                            key={
                                                                option.value
                                                            }
                                                            value={
                                                                option.value
                                                            }
                                                        >
                                                            {
                                                                option.label
                                                            }
                                                        </option>
                                                    )
                                                )}
                                            </select>
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

                            {/* overflow-y-hidden, not overflow-y-visible: per the
                                CSS Overflow spec, when one axis is a non-"visible"
                                value (overflow-x: auto here), a "visible" value on
                                the OTHER axis is computed as "auto" regardless of
                                whether it was left implicit or set explicitly - so
                                overflow-y-visible does NOT cancel that promotion,
                                it's a no-op, and this div still silently gains its
                                own vertical scrollbar nested inside the page's own
                                scroll area whenever the table's rows overflow this
                                box's height. overflow-y-hidden is a genuinely
                                non-"visible" value on both axes, so the promotion
                                rule never triggers. Horizontal scrolling (for wide
                                rows) still works; vertical overflow always flows up
                                to the single page-level scrollbar. */}
                            <div className="overflow-x-auto overflow-y-hidden">

                                <table className="w-full min-w-[900px] text-left">

                                    <thead className="border-b border-slate-100 bg-slate-50">

                                        <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">

                                            <th className="px-2 py-3 text-center">
                                                <span className="sr-only">
                                                    Self-Learning
                                                </span>

                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setClearRulesDialogOpen(
                                                            true
                                                        )
                                                    }
                                                    disabled={
                                                        importing ||
                                                        clearingRules
                                                    }
                                                    aria-label="Clear all self-learned rules"
                                                    title="Clear all self-learned rules"
                                                    className="inline-flex items-center justify-center rounded-full p-0.5 text-slate-400 transition-colors hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    <CheckCircle2
                                                        size={14}
                                                    />
                                                </button>
                                            </th>

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
                                                Type
                                            </th>

                                            <th className="px-4 py-3 text-right">
                                                Amount
                                            </th>

                                            <th className="px-4 py-3">
                                                Notes
                                            </th>

                                        </tr>

                                    </thead>

                                    <tbody className="divide-y divide-slate-100">

                                        {previewCandidates.map(
                                            (candidate, candidateIndex) => {
                                                const rowErrors =
                                                    previewErrors.filter(
                                                        validationError =>
                                                            validationError.rowNumber ===
                                                            candidate.rowNumber
                                                    );

                                                const isDuplicateRow =
                                                    preview?.duplicates.has(
                                                        candidate.rowNumber
                                                    ) ?? false;

                                                const amountColorClass =
                                                    candidate.amount ==
                                                        null
                                                        ? "text-slate-800"
                                                        : candidate.type ===
                                                            "income"
                                                            ? "text-emerald-600"
                                                            : candidate.type ===
                                                                "expense"
                                                                ? "text-red-600"
                                                                : "text-slate-800";

                                                // Single source of truth for this row's Self-Learning
                                                // indicator - see resolveSelfLearningIndicator.
                                                const selfLearningIndicator =
                                                    resolveSelfLearningIndicator(
                                                        candidate.rowNumber,
                                                        matchedLearnedRuleRowNumbers,
                                                        sessionLearnedRowNumbers,
                                                        selfLearningDisabledRows
                                                    );


    return (
                                                    <tr
                                                        key={
                                                            candidate.rowNumber
                                                        }
                                                        className={
                                                            rowErrors.length > 0
                                                                ? "bg-red-50/50"
                                                                : isDuplicateRow
                                                                    ? "bg-amber-50/50"
                                                                    : "hover:bg-slate-50"
                                                        }
                                                    >

                                                        <td className="px-2 py-4 text-center">
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    selfLearningIndicator.clickable &&
                                                                    handleToggleSelfLearning(
                                                                        candidate.rowNumber
                                                                    )
                                                                }
                                                                disabled={
                                                                    importing ||
                                                                    !selfLearningIndicator.clickable
                                                                }
                                                                aria-pressed={
                                                                    selfLearningIndicator.clickable
                                                                        ? selfLearningIndicator.state !==
                                                                          "blank"
                                                                        : undefined
                                                                }
                                                                aria-label={
                                                                    !selfLearningIndicator.clickable
                                                                        ? "No learned rule for this transaction"
                                                                        : selfLearningIndicator.state ===
                                                                          "blank"
                                                                            ? "Learning disabled for this transaction on this import"
                                                                            : selfLearningIndicator.hasMatchedLearnedRule
                                                                                ? "Existing learned rule applied to this transaction"
                                                                                : "New rule learned from your edits this import"
                                                                }
                                                                title={
                                                                    !selfLearningIndicator.clickable
                                                                        ? "No learned rule for this transaction"
                                                                        : selfLearningIndicator.state ===
                                                                          "blank"
                                                                            ? "Learning disabled for this transaction on this import — click to re-enable"
                                                                            : selfLearningIndicator.hasMatchedLearnedRule
                                                                                ? "Existing learned rule applied to this transaction — click to disable for this import"
                                                                                : "New rule learned from your edits this import — will be saved when you import. Click to disable."
                                                                }
                                                                className="inline-flex items-center justify-center rounded-full p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                                                            >
                                                                {selfLearningIndicator.state ===
                                                                "green" ? (
                                                                    <CheckCircle2
                                                                        size={16}
                                                                        className="text-emerald-600"
                                                                    />
                                                                ) : selfLearningIndicator.state ===
                                                                  "blue" ? (
                                                                    <CheckCircle2
                                                                        size={16}
                                                                        className="text-blue-600"
                                                                    />
                                                                ) : (
                                                                    <span className="block h-4 w-4" />
                                                                )}
                                                            </button>
                                                        </td>

                                                        <td className="px-4 py-4 text-sm font-medium text-slate-700">
                                                            {
                                                                // Sequential display position (1, 2, 3, ...) in
                                                                // the preview - independent of
                                                                // candidate.rowNumber, which stays the original
                                                                // CSV physical row and continues to back errors,
                                                                // overrides, and duplicate/import tracking.
                                                                candidateIndex + 1
                                                            }
                                                        </td>

                                                        <td className="px-4 py-4 text-sm text-slate-600">
                                                            {candidate.transactionDate ??
                                                                "—"}
                                                        </td>

                                                        <td className="px-4 py-4 text-sm">
                                                            <input
                                                                type="text"
                                                                value={
                                                                    payeeDrafts.get(
                                                                        candidate.rowNumber
                                                                    ) ??
                                                                    candidate.payee ??
                                                                    ""
                                                                }
                                                                onChange={event =>
                                                                    handlePayeeOverride(
                                                                        candidate.rowNumber,
                                                                        event
                                                                            .target
                                                                            .value
                                                                    )
                                                                }
                                                                onBlur={event =>
                                                                    handlePayeeOverrideCommit(
                                                                        candidate.rowNumber,
                                                                        event
                                                                            .target
                                                                            .value
                                                                    )
                                                                }
                                                                placeholder="—"
                                                                disabled={
                                                                    importing
                                                                }
                                                                title={
                                                                    candidate.payee ||
                                                                    undefined
                                                                }
                                                                className="block w-full max-w-[220px] rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-sm font-medium text-slate-800 outline-none transition hover:border-slate-200 focus:border-slate-400 focus:bg-white disabled:bg-slate-50"
                                                            />

                                                            {candidate.description && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        candidate.description &&
                                                                        setFullTextView(
                                                                            {
                                                                                label: "Description",
                                                                                value: candidate.description,
                                                                            }
                                                                        )
                                                                    }
                                                                    className="mt-0.5 block max-w-[220px] truncate px-1.5 text-left text-[11px] text-slate-400 underline-offset-2 hover:underline"
                                                                    title="Click to view full text"
                                                                >
                                                                    {candidate.description}
                                                                </button>
                                                            )}
                                                        </td>

                                                        <td className="px-4 py-4 text-sm">
                                                            <select
                                                                value={
                                                                    candidate.transactionType ??
                                                                    ""
                                                                }
                                                                onChange={event =>
                                                                    handleTransactionTypeOverride(
                                                                        candidate.rowNumber,
                                                                        event
                                                                            .target
                                                                            .value as
                                                                            | TransactionChannel
                                                                            | ""
                                                                    )
                                                                }
                                                                disabled={
                                                                    importing
                                                                }
                                                                className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none transition focus:border-slate-400 disabled:bg-slate-50"
                                                            >
                                                                {TRANSACTION_CHANNEL_OPTIONS.map(
                                                                    option => (
                                                                        <option
                                                                            key={
                                                                                option.value
                                                                            }
                                                                            value={
                                                                                option.value
                                                                            }
                                                                        >
                                                                            {
                                                                                option.label
                                                                            }
                                                                        </option>
                                                                    )
                                                                )}
                                                            </select>
                                                        </td>

                                                        <td
                                                            className={`px-4 py-4 text-right text-sm font-semibold ${amountColorClass}`}
                                                        >
                                                            {candidate.amount ==
                                                            null
                                                                ? "—"
                                                                : formatAmount(
                                                                      signedTransactionAmount(
                                                                          candidate.amount,
                                                                          candidate.type
                                                                      )
                                                                  )}
                                                        </td>

                                                        <td className="px-4 py-4 text-sm">
                                                            <input
                                                                type="text"
                                                                value={
                                                                    notesDrafts.get(
                                                                        candidate.rowNumber
                                                                    ) ??
                                                                    candidate.notes ??
                                                                    ""
                                                                }
                                                                onChange={event =>
                                                                    handleNotesOverride(
                                                                        candidate.rowNumber,
                                                                        event
                                                                            .target
                                                                            .value
                                                                    )
                                                                }
                                                                onBlur={event =>
                                                                    handleNotesOverrideCommit(
                                                                        candidate.rowNumber,
                                                                        event
                                                                            .target
                                                                            .value
                                                                    )
                                                                }
                                                                placeholder="—"
                                                                disabled={
                                                                    importing
                                                                }
                                                                className="h-8 w-36 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none transition focus:border-slate-400 disabled:bg-slate-50"
                                                            />
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
                                Saved Mappings
                            </h2>

                            <p className="mt-1 text-[15px] text-slate-500">
                                Column mappings confirmed from past imports. Rename one without changing its column rules.
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={() =>
                                void loadMappings()
                            }
                            disabled={mappingsLoading}
                            className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                        >
                            <RefreshCw
                                size={15}
                            />
                            Refresh
                        </button>

                    </div>

                    {mappingsLoading && (
                        <div className="flex min-h-[120px] items-center justify-center">
                            <p className="text-sm text-slate-400">
                                Loading saved mappings...
                            </p>
                        </div>
                    )}

                    {!mappingsLoading &&
                        mappings.length === 0 && (
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-12">
                                <EmptyState
                                    title="No saved mappings yet"
                                    description="Confirmed column mappings from your imports will appear here."
                                />
                            </div>
                        )}

                    {!mappingsLoading &&
                        mappings.length > 0 && (
                            <div className="overflow-hidden rounded-2xl border border-slate-100">

                                <div className="overflow-x-auto">

                                    <table className="w-full text-left">

                                        <thead className="border-b border-slate-100 bg-slate-50">

                                            <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">

                                                <th className="px-4 py-3">
                                                    Mapping Name
                                                </th>

                                                <th className="px-4 py-3">
                                                    Institution
                                                </th>

                                                <th className="px-4 py-3">
                                                    Import Type
                                                </th>

                                                <th className="px-4 py-3">
                                                    Updated
                                                </th>

                                                <th className="px-4 py-3 text-right">
                                                    Actions
                                                </th>

                                            </tr>

                                        </thead>

                                        <tbody className="divide-y divide-slate-100">

                                            {mappings.map(
                                                mapping => {
                                                    const isEditing =
                                                        editingMapping?.id ===
                                                        mapping.id;

                                                    return (
                                                        <tr
                                                            key={
                                                                mapping.id
                                                            }
                                                            className="transition-colors hover:bg-slate-50"
                                                        >

                                                            <td className="px-4 py-4 text-sm font-medium text-slate-900">
                                                                {isEditing ? (
                                                                    <input
                                                                        type="text"
                                                                        autoFocus
                                                                        value={
                                                                            editingMapping.name
                                                                        }
                                                                        onChange={event =>
                                                                            setEditingMapping({
                                                                                id: mapping.id,
                                                                                name: event.target.value,
                                                                            })
                                                                        }
                                                                        onKeyDown={event => {
                                                                            if (event.key === "Enter") {
                                                                                void handleSaveRenameMapping();
                                                                            } else if (event.key === "Escape") {
                                                                                handleCancelRenameMapping();
                                                                            }
                                                                        }}
                                                                        disabled={
                                                                            renamingMapping
                                                                        }
                                                                        className="h-8 w-full max-w-56 rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium text-slate-800 outline-none transition focus:border-slate-400 disabled:bg-slate-50"
                                                                    />
                                                                ) : (
                                                                    mapping.name
                                                                )}
                                                            </td>

                                                            <td className="px-4 py-4 text-sm text-slate-600">
                                                                {
                                                                    mapping.institutionName ??
                                                                    "—"
                                                                }
                                                            </td>

                                                            <td className="px-4 py-4 text-sm text-slate-600">
                                                                {
                                                                    mapping.importType
                                                                }
                                                            </td>

                                                            <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-500">
                                                                {formatDate(
                                                                    mapping.updatedAt
                                                                )}
                                                            </td>

                                                            <td className="px-4 py-4 text-right">
                                                                {isEditing ? (
                                                                    <div className="inline-flex items-center gap-2">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() =>
                                                                                void handleSaveRenameMapping()
                                                                            }
                                                                            disabled={
                                                                                renamingMapping ||
                                                                                !editingMapping.name.trim()
                                                                            }
                                                                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50"
                                                                        >
                                                                            <Check
                                                                                size={
                                                                                    14
                                                                                }
                                                                            />
                                                                            Save
                                                                        </button>

                                                                        <button
                                                                            type="button"
                                                                            onClick={
                                                                                handleCancelRenameMapping
                                                                            }
                                                                            disabled={
                                                                                renamingMapping
                                                                            }
                                                                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                                                                        >
                                                                            <X
                                                                                size={
                                                                                    14
                                                                                }
                                                                            />
                                                                            Cancel
                                                                        </button>
                                                                    </div>
                                                                ) : (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() =>
                                                                            handleStartRenameMapping(
                                                                                mapping
                                                                            )
                                                                        }
                                                                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                                                                    >
                                                                        <Pencil
                                                                            size={
                                                                                14
                                                                            }
                                                                        />
                                                                        Rename
                                                                    </button>
                                                                )}
                                                            </td>

                                                        </tr>
                                                    );
                                                }
                                            )}

                                        </tbody>

                                    </table>

                                </div>

                            </div>
                        )}

                </section>

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

            <Dialog
                open={fullTextView !== null}
                onOpenChange={open => {
                    if (!open) {
                        setFullTextView(null);
                    }
                }}
            >
                <DialogContent className="max-w-lg">
                    <DialogHeader className="px-7 pt-6">
                        <DialogTitle>
                            {fullTextView?.label}
                        </DialogTitle>
                    </DialogHeader>

                    <p className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words px-7 pb-7 text-sm text-slate-700">
                        {fullTextView?.value}
                    </p>
                </DialogContent>
            </Dialog>

            <AlertDialog
                open={clearRulesDialogOpen}
                onOpenChange={open => {
                    if (!clearingRules) {
                        setClearRulesDialogOpen(open);
                    }
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Clear all self-learned rules?
                        </AlertDialogTitle>

                        <AlertDialogDescription>
                            This will permanently delete every
                            self-learned Payee/Type/Notes rule saved
                            across all accounts. Existing transactions
                            are not modified, but future imports will no
                            longer auto-fill from them until you confirm
                            each pattern again.
                        </AlertDialogDescription>
                    </AlertDialogHeader>

                    <AlertDialogFooter>
                        <AlertDialogCancel
                            disabled={clearingRules}
                        >
                            Cancel
                        </AlertDialogCancel>

                        <AlertDialogAction
                            disabled={clearingRules}
                            onClick={
                                handleClearAllLearnedRules
                            }
                            className="bg-red-600 hover:bg-red-700"
                        >
                            {clearingRules
                                ? "Clearing..."
                                : "Clear Rules"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

        </div>
    );
}



















