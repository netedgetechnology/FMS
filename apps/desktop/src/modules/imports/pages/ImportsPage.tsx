import { useDateFormatter } from "@/core/formatting";
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
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
    Trash2,
    Wand2,
} from "lucide-react";

import { EmptyState, PageHeader } from "@/components/common";
import { useAccounts } from "@/modules/accounts/hooks";
import {
    useCategories,
    useCategoryContextMappings,
} from "@/modules/categories/hooks";
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

import {
    ImportService,
    reapplyCustomImportRules,
    reapplyCustomImportRulesIfChanged,
} from "../services";
import { CustomRulesDialog } from "./CustomRulesDialog";
import type {
    CsvPreviewResultWithLearning,
    ExcelPreviewResult,
} from "../services/ImportService";
import type {
    ImportBatch,
    ImportRow,
} from "../types";

import {
    ExcelPasswordError,
    type CsvColumnMapping,
    type CsvImportType,
    type NormalizedTransactionCandidate,
    type TransactionChannel,
} from "@financeos/import-engine";
import { learningKeyForCandidate } from "../services/learningKey";
import {
    affectedRowsToggleLabel,
    isPreviewRowVisible,
    resolveImportCategoryOptions,
    rowsWithCategoryOutsideScope,
} from "./importCategoryOptions";
import type { BaseFinanceScope, Category } from "@/modules/categories/types";
import {
    describeRejectedRuleCategory,
    type CustomRuleApplication,
} from "../services/customImportRules";
import { financeScopeLabel } from "@/modules/categories/utils";
import {
    isTransferClassified,
    transferCategoryIdSet,
} from "@/core/accounting/transferClassification";
import { ImportPreviewRow } from "./ImportPreviewRow";
import { ImportProgressCounters } from "./ImportProgressCounters";
import {
    NO_BALANCE_MISMATCHES,
    applyBalanceAmount,
    applyBalanceDirection,
    combinePreviewErrors,
    countReadyRows,
    detectBalanceMismatches,
    reviewBalanceCorrections,
    toggleBalanceSkip,
    type BalanceReview,
} from "./importBalanceReview";

import type {
    CreateCustomImportRuleInput,
    CustomImportRule,
    ImportDraftSummary,
    ImportMapping,
} from "../types";
import { ImportDraftRepository } from "../repositories/ImportDraftRepository";
import {
    ImportDraftAutoSaver,
    ImportDraftError,
    fingerprintFile,
    parseImportDraft,
    requiresDraftReplacementConfirmation,
    runImportWithDraft,
    type ImportDraftFileInfo,
    type ImportDraftSaveStatus,
} from "./importDraft";
import {
    ImportDraftBanner,
    ImportDraftRecoveryDialog,
    ImportDraftSaveIndicator,
    ReplaceImportDraftDialog,
} from "./ImportDraftRecovery";

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

// A saved mapping's Institution column should reflect the real
// institution of the account this import was confirmed for - not just
// whatever (if anything) could be auto-detected from the file's own
// text. Excel/PDF carry no such text to scan at all (see
// CsvProcessingResult.institutionName's own doc comment: "null ...
// when the source format has no such text to scan (Excel/PDF)"), so a
// BANK_EXCEL mapping's institution was always blank even when the
// account it was created from clearly has one on file in Accounts.
// File-content detection (CSV) is still preferred when it succeeds -
// this only fills in what would otherwise stay null, never overrides a
// real detected value. Returns null (displayed as "—") when neither
// source has an institution, e.g. an account with none on file.
export function resolveMappingInstitutionName(
    detectedInstitutionName: string | null,
    account:
        | Pick<Account, "institutionName">
        | null
        | undefined
): string | null {
    return (
        detectedInstitutionName ||
        account?.institutionName ||
        null
    );
}

export interface PreviewOverrides {
    transactionType: Map<number, TransactionChannel | "">;
    payee: Map<number, string>;
    notes: Map<number, string>;
    // Category id per row; "" = Uncategorized. Preview state only -
    // saved to the transaction solely by the actual Import.
    categoryId: Map<number, string>;
    // Balance-mismatch resolution (PDF running-balance check - see
    // importBalanceReview.ts). Only ever set on a row flagged as a
    // mismatch, and only by an explicit user action: a corrected
    // Income/Expense direction, a corrected amount, or "skip this row".
    direction: Map<number, "income" | "expense">;
    amount: Map<number, number>;
    skipped: ReadonlySet<number>;
}

export function createEmptyPreviewOverrides(): PreviewOverrides {
    return {
        transactionType: new Map(),
        payee: new Map(),
        notes: new Map(),
        categoryId: new Map(),
        direction: new Map(),
        amount: new Map(),
        skipped: new Set(),
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

        const categoryOverride =
            overrides.categoryId.get(
                candidate.rowNumber
            );

        const directionOverride =
            overrides.direction.get(
                candidate.rowNumber
            );

        const amountOverride =
            overrides.amount.get(
                candidate.rowNumber
            );

        if (
            transactionTypeOverride === undefined &&
            payeeOverride === undefined &&
            notesOverride === undefined &&
            categoryOverride === undefined &&
            directionOverride === undefined &&
            amountOverride === undefined
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
            categoryId:
                categoryOverride === undefined
                    ? candidate.categoryId ?? null
                    : categoryOverride || null,
            type: directionOverride ?? candidate.type,
            amount: amountOverride ?? candidate.amount,
        };
    });
}

// Keeps the previous object for every row whose values didn't change, so
// memoized preview rows (see ImportPreviewRow) skip re-rendering: after an
// edit, applyPreviewOverrides rebuilds every overridden row as a new
// object even if only one row actually changed. Returns `previous`
// itself when nothing changed at all. Rows are compared field by field
// (shallow ===); a row that did change is returned exactly as `next` has
// it - values are never altered, only object identity is reused.
export function reuseUnchangedCandidates(
    next: NormalizedTransactionCandidate[],
    previous: readonly NormalizedTransactionCandidate[] | null
): NormalizedTransactionCandidate[] {
    if (!previous) {
        return next;
    }

    let allReused = next.length === previous.length;

    const result = next.map((candidate, index) => {
        const prior = previous[index];

        if (prior && prior !== candidate && shallowEqualCandidate(prior, candidate)) {
            return prior;
        }

        if (prior !== candidate) {
            allReused = false;
        }

        return candidate;
    });

    return allReused ? (previous as NormalizedTransactionCandidate[]) : result;
}

function shallowEqualCandidate(
    a: NormalizedTransactionCandidate,
    b: NormalizedTransactionCandidate
): boolean {
    const keysA = Object.keys(a) as (keyof NormalizedTransactionCandidate)[];

    if (keysA.length !== Object.keys(b).length) {
        return false;
    }

    return keysA.every(key => a[key] === b[key]);
}

// A row's learning key: normalized Description pattern + Credit/Debit
// direction (see learningKeyForCandidate) - the same key the persistent
// account-scoped learning uses, so an edit to a Credit row only ever
// propagates to matching Credit rows, and a Debit edit only to matching
// Debit rows.
const learningPatternForCandidate = learningKeyForCandidate;

// When the user manually edits Payee, Type, or Notes for one row, this
// applies that same value to every *other* row in the current import
// preview whose detected Payee/Description matches the same learning
// pattern and the same Credit/Debit direction - so a single correction
// fills in the whole statement, not just the edited row. The latest
// committed edit wins for the whole matching group, whichever matching
// row it was made on (see `overwriteMatching` below). Clearing a field
// back to blank ("") never propagates. Shared by applyPayeeToMatchingRows /
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
//
// `overwriteMatching`: whether propagation replaces a matching row's
// existing override. true for the edited fields (Payee / Type / Notes /
// Category): ANY matching row can be the learning source - the latest
// committed edit, from whichever row, is applied to every row with the
// same pattern and direction, including rows that received an earlier
// edit's value. (Without this, only the first edited row could ever
// teach the group: every matching row already held that first value as
// an override, so a later edit from another row updated only itself.)
// false (the default) keeps the "never overwrite a row's own recorded
// choice" rule - used by the Self-Learning toggle.
function applyOverrideToMatchingRows<Value>(
    candidates: NormalizedTransactionCandidate[],
    existing: Map<number, Value>,
    rowNumber: number,
    value: Value,
    baselineValue?: Value,
    overwriteMatching = false
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
                !overwriteMatching &&
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
            baselineCandidate?.payee ?? "",
            true
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
            baselineCandidate?.transactionType ?? "",
            true
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
            baselineCandidate?.notes ?? "",
            true
        ),
    };
}

// Category - same shared propagation as Payee/Type/Notes (see
// applyOverrideToMatchingRows): a category chosen for one row fills every
// other row with the same payee pattern AND the same Credit/Debit
// direction, never the opposite direction. "" (Uncategorized) never
// propagates, and choosing the row's original category again is an undo.
export function applyCategoryToMatchingRows(
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
        categoryId: applyOverrideToMatchingRows(
            candidates,
            overrides.categoryId,
            rowNumber,
            value,
            baselineCandidate?.categoryId ?? "",
            true
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
// The only conditions that block the Import: genuine import errors. The
// Category Scope and row categories are deliberately NOT inputs - an
// uncategorised, manually categorised, learned, or out-of-scope row
// never blocks it (see rowsWithCategoryOutsideScope). null = go ahead.
export function resolveImportBlockingError(state: {
    hasAccount: boolean;
    hasFile: boolean;
    hasPreview: boolean;
    errorRows: number;
    readyRows: number;
    // Rows (among errorRows) whose only problem is an unresolved PDF
    // running-balance mismatch - see importBalanceReview.ts.
    balanceMismatchRows?: number;
}): string | null {
    if (!state.hasAccount) {
        return "Please select an account.";
    }

    if (!state.hasFile) {
        return "Please select a Statement File.";
    }

    if (!state.hasPreview) {
        return "Please preview the statement before importing.";
    }

    if (state.errorRows > 0) {
        const mismatchRows = state.balanceMismatchRows ?? 0;

        if (mismatchRows > 0 && mismatchRows === state.errorRows) {
            return `${mismatchRows} row${
                mismatchRows === 1 ? " does" : "s do"
            } not match the statement's running balance. Correct the amount or Income/Expense of each highlighted row, or skip it, before importing.`;
        }

        return "The statement contains validation errors. Correct the file before importing.";
    }

    if (state.readyRows === 0) {
        return "There are no new transactions to import.";
    }

    return null;
}

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
            ) ||
            overrides.categoryId.has(
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

// Whether this row carries any manual decision made in this preview -
// a Payee/Type/Notes/Category override (typed on the row itself or
// received through latest-edit propagation from a matching row), or a
// balance-mismatch correction/skip. Undoing an edit back to the row's
// original value removes its override, so the row stops counting.
export function hasManualPreviewOverride(
    rowNumber: number,
    overrides: PreviewOverrides
): boolean {
    return (
        overrides.payee.has(rowNumber) ||
        overrides.transactionType.has(rowNumber) ||
        overrides.notes.has(rowNumber) ||
        overrides.categoryId.has(rowNumber) ||
        overrides.direction.has(rowNumber) ||
        overrides.amount.has(rowNumber) ||
        overrides.skipped.has(rowNumber)
    );
}

export interface ImportProgressCounts {
    // GREEN: rows an existing self-learned rule was applied to - exactly
    // the Self-Learning indicator's hasMatchedLearnedRule (see
    // resolveSelfLearningIndicator). Turning learning off for this import
    // doesn't remove the applied values, so such a row still counts.
    learned: number;
    // BLUE: rows NOT counted green that the user has manually processed
    // in this preview (see hasManualPreviewOverride). A green row that is
    // also edited stays green - never counted twice.
    manual: number;
    // Rows neither learned nor manually processed yet.
    remaining: number;
    // BLACK: learned + manual. Equals `total` once every row is done.
    processed: number;
    total: number;
}

// One linear pass over the preview's rows - no per-row allocation beyond
// the indicator lookup - so it stays cheap at 10,000 rows and can be
// recomputed on every edit without touching the memoized table rows.
export function countImportProgress(
    candidates: readonly Pick<NormalizedTransactionCandidate, "rowNumber">[],
    matchedLearnedRuleRowNumbers: ReadonlySet<number>,
    sessionLearnedRowNumbers: ReadonlySet<number>,
    selfLearningDisabledRows: ReadonlyMap<number, boolean>,
    overrides: PreviewOverrides
): ImportProgressCounts {
    let learned = 0;
    let manual = 0;

    for (const { rowNumber } of candidates) {
        const indicator = resolveSelfLearningIndicator(
            rowNumber,
            matchedLearnedRuleRowNumbers,
            sessionLearnedRowNumbers,
            selfLearningDisabledRows
        );

        if (indicator.hasMatchedLearnedRule) {
            learned += 1;
        } else if (
            hasManualPreviewOverride(rowNumber, overrides)
        ) {
            manual += 1;
        }
    }

    const total = candidates.length;

    return {
        learned,
        manual,
        remaining: total - learned - manual,
        processed: learned + manual,
        total,
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

export interface ExcelPasswordPromptDecision {
    // Show the password field (with Unlock/Retry) instead of the
    // preview.
    showPasswordPrompt: boolean;
    // Inline message next to the password field - only set for a wrong
    // password (a retry-able failure); null on the first prompt.
    passwordErrorMessage: string | null;
    // The generic error banner message, for anything that isn't a
    // retry-able password prompt: an unsupported protection scheme (see
    // ExcelPasswordError's "unsupported" reason - retrying can never
    // succeed there) or any unrelated error, preserving existing error
    // handling exactly as before this feature.
    genericErrorMessage: string | null;
}

// Decides how a caught preview error should be shown, given the three
// ExcelPasswordError reasons (see excelParser.ts) - kept as a pure,
// directly-testable function rather than inlined in the catch block.
export function classifyExcelPasswordError(
    err: unknown
): ExcelPasswordPromptDecision {
    if (!(err instanceof ExcelPasswordError)) {
        return {
            showPasswordPrompt: false,
            passwordErrorMessage: null,
            genericErrorMessage:
                err instanceof Error
                    ? err.message
                    : String(err),
        };
    }

    if (err.reason === "unsupported") {
        return {
            showPasswordPrompt: false,
            passwordErrorMessage: null,
            genericErrorMessage: err.message,
        };
    }

    return {
        showPasswordPrompt: true,
        passwordErrorMessage:
            err.reason === "incorrect"
                ? err.message
                : null,
        genericErrorMessage: null,
    };
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

// Stable empty values, so memoized derived state doesn't see a "new"
// empty array/set on every render while no preview is loaded.
const NO_CANDIDATES: NormalizedTransactionCandidate[] = [];
const NO_ROW_NUMBERS: ReadonlySet<number> = new Set();
const NO_ERRORS: CsvPreviewResultWithLearning["validation"]["errors"] = [];

export default function ImportsPage() {
    const formatDate = useDateFormatter();
    const { accounts, loading: accountsLoading } =
        useAccounts();

    // Category column - the Categories module is the only source of
    // category options (see importCategoryOptions).
    const { categories, loading: categoriesLoading } =
        useCategories();
    const { mappings: categoryContextMappings } =
        useCategoryContextMappings();

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

    // Password for the currently-selected password-protected Excel
    // file - held in memory only (component state), for this session's
    // Preview/Unlock attempt. Never sent anywhere but the one
    // service.previewExcel call below, never persisted (no DB/localStorage
    // write anywhere in this file), and never logged (existing
    // console.error calls below only ever receive the Error object,
    // whose message text is fixed/constant - see ExcelPasswordError -
    // and never includes the password itself). Reset on every new file
    // selection and cleared immediately once no longer needed (a
    // successful unlock, or an unsupported-protection result for which
    // retrying is pointless).
    const [excelPassword, setExcelPassword] =
        useState("");

    const [excelPasswordRequired, setExcelPasswordRequired] =
        useState(false);

    const [excelPasswordError, setExcelPasswordError] =
        useState<string | null>(null);

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

    // (Live, per-keystroke Payee/Notes text lives in each ImportPreviewRow's
    // own state - never here - so typing re-renders only that row; the
    // value reaches previewOverrides only when the edit is committed on
    // blur. See ImportPreviewRow and handlePayeeOverrideCommit.)

    // Rows with an explicit Self-Learning choice for this import, keyed by
    // candidate.rowNumber (true = toggled OFF). Empty by default -
    // preserves existing self-learning behavior for every eligible row
    // until a user explicitly opts one out. Reset alongside
    // previewOverrides whenever a new file is selected, a new preview
    // loads, or an import completes.
    const [selfLearningDisabledRows, setSelfLearningDisabledRows] =
        useState<Map<number, boolean>>(new Map());

    // OPTIONAL Category Scope for this preview (Personal / Business) - a
    // view over the categories' existing finance_scope, never a change to
    // them. null = none chosen: no scope filtering. Reset with the other
    // per-preview state (new file, new preview, import done). Changing it
    // never touches a row's category - one outside the new scope shows as
    // "(unavailable)" and still imports as-is; it never blocks the Import
    // (see rowsWithCategoryOutsideScope).
    const [categoryScope, setCategoryScope] =
        useState<BaseFinanceScope | null>(null);

    // "Show N Affected Rows" view: only rows whose category is outside the
    // selected scope are listed (a view filter only - no data changes).
    // Reset with the scope.
    const [showAffectedRowsOnly, setShowAffectedRowsOnly] =
        useState(false);

    // Latest preview / previewCandidates for the row handlers below, which
    // keep ONE identity for the page's lifetime (so memoized preview rows
    // never re-render just because a handler was re-created). Refreshed
    // after every commit; handlers only run from events, i.e. after it.
    const previewRef = useRef(preview);
    const previewCandidatesRef =
        useRef<NormalizedTransactionCandidate[]>([]);

    const handleToggleSelfLearning = useCallback((
        rowNumber: number
    ) => {
        setSelfLearningDisabledRows(previous => {
            const currentlyDisabled =
                previous.get(rowNumber) ?? false;

            return applySelfLearningToMatchingRows(
                previewCandidatesRef.current,
                previous,
                rowNumber,
                !currentlyDisabled
            );
        });
    }, []);

    // Whether the "clear all self-learned rules" confirmation dialog is
    // open - see the header tick above the "Row" column in the Import
    // Preview table.
    const [clearRulesDialogOpen, setClearRulesDialogOpen] =
        useState(false);

    // Custom Import Rules for the selected account (see
    // CustomRulesDialog / ImportService.createCustomRule).
    const [customRules, setCustomRules] =
        useState<CustomImportRule[]>([]);

    const [customRulesOpen, setCustomRulesOpen] =
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

    // The Import History record pending delete confirmation, or null
    // when the confirmation dialog is closed.
    const [batchToDelete, setBatchToDelete] =
        useState<ImportBatch | null>(null);

    const [deletingBatch, setDeletingBatch] =
        useState(false);

    // The Saved Mapping pending delete confirmation, or null when the
    // confirmation dialog is closed.
    const [mappingToDelete, setMappingToDelete] =
        useState<ImportMapping | null>(null);

    const [deletingMapping, setDeletingMapping] =
        useState(false);

    // ---------------------------------------------------------------
    // Import Draft / Auto-Recovery (see importDraft.ts). The open
    // preview and every edit in it are saved (debounced) to the
    // database, so a refresh/restart never loses the user's work.
    // ---------------------------------------------------------------

    const draftStore = useMemo(
        () => new ImportDraftRepository(),
        []
    );

    // The draft the open preview belongs to - null when no preview has
    // been started since the last successful import/discard. Kept when
    // the preview is merely closed (new file, Clear Preview, ...): the
    // draft itself stays until imported or explicitly discarded.
    const [draftId, setDraftId] =
        useState<string | null>(null);

    const [draftCreatedAt, setDraftCreatedAt] =
        useState("");

    // The statement file the open preview was built from. Survives a
    // restore (selectedFile - a File - can't).
    const [draftFile, setDraftFile] =
        useState<ImportDraftFileInfo | null>(null);

    // What the database currently holds (metadata only).
    const [storedDraft, setStoredDraft] =
        useState<ImportDraftSummary | null>(null);

    const [draftSaveStatus, setDraftSaveStatus] =
        useState<ImportDraftSaveStatus>({ kind: "idle" });

    const [draftSaver] = useState(
        () =>
            new ImportDraftAutoSaver(draftStore, {
                onStatus: setDraftSaveStatus,
                onSaved: setStoredDraft,
            })
    );

    const [recoveryDialogOpen, setRecoveryDialogOpen] =
        useState(false);

    const [resumingDraft, setResumingDraft] =
        useState(false);

    const [discardingDraft, setDiscardingDraft] =
        useState(false);

    const [draftRecoveryError, setDraftRecoveryError] =
        useState<string | null>(null);

    const [replaceDraftDialogOpen, setReplaceDraftDialogOpen] =
        useState(false);

    // The user already confirmed replacing the unfinished draft for the
    // currently selected file (e.g. before an Excel password retry).
    const draftReplacementConfirmedRef = useRef(false);

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

    // Deletes one Saved Mapping - see ImportService.deleteMapping.
    // Never touches accounts, transactions, or any other import/mapping.
    const handleDeleteMapping = async () => {
        if (!mappingToDelete) {
            return;
        }

        try {
            setDeletingMapping(true);
            setError(null);

            await service.deleteMapping(
                mappingToDelete.id
            );

            setMappings(previous =>
                previous.filter(
                    mapping =>
                        mapping.id !==
                        mappingToDelete.id
                )
            );

            // The "Detected Mapping" panel above may currently be
            // showing this exact mapping - clear it, since it no
            // longer exists to be re-confirmed against.
            setMatchedMapping(previous =>
                previous?.id === mappingToDelete.id
                    ? null
                    : previous
            );

            if (
                editingMapping?.id ===
                mappingToDelete.id
            ) {
                setEditingMapping(null);
            }

            setMessage(
                `Mapping "${mappingToDelete.name}" deleted.`
            );
        } catch (err) {
            console.error(
                "SAVED MAPPING DELETE ERROR:",
                err
            );

            setError(
                err instanceof Error
                    ? err.message
                    : String(err)
            );
        } finally {
            setDeletingMapping(false);
            setMappingToDelete(null);
        }
    };

    const handleFileChange = (
        event: React.ChangeEvent<HTMLInputElement>
    ) => {
        const file =
            event.target.files?.[0] ?? null;

        setSelectedFile(file);

        // Selecting a file never touches an existing draft; previewing it
        // asks before replacing one (see handlePreview).
        draftReplacementConfirmedRef.current = false;

        // An Excel file's format is unambiguous from its extension, so
        // Import Type defaults to "Bank Excel" without requiring the
        // user to pick it manually - matching the same detection
        // handlePreview already uses to route to previewExcel. An
        // explicit "Credit Card Excel" choice is left intact (both are
        // Excel-sourced; only the credit-card sign convention differs).
        // Any other file (CSV/PDF) leaves Import Type exactly as it was -
        // unchanged CSV/PDF behavior.
        if (
            file &&
            isExcelFileName(file.name) &&
            importType !== "CREDIT_CARD_EXCEL"
        ) {
            setImportType("BANK_EXCEL");
        }

        setPreview(null);
        setMappingName("");
        setMatchedMapping(null);
        setPreviewOverrides(
            createEmptyPreviewOverrides()
        );
        setSelfLearningDisabledRows(new Map());
        setCategoryScope(null);
        setShowAffectedRowsOnly(false);
        setMessage(null);
        setError(null);
        // A new file was selected - forget any password prompt/attempt
        // for whatever was selected before.
        setExcelPassword("");
        setExcelPasswordRequired(false);
        setExcelPasswordError(null);
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

        // A new preview starts a new draft - never silently replacing an
        // unfinished one.
        if (
            requiresDraftReplacementConfirmation({
                storedDraft,
                activeDraftId: draftId,
                replacementConfirmed:
                    draftReplacementConfirmedRef.current,
            })
        ) {
            setReplaceDraftDialogOpen(true);
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
                        importType,
                        excelPassword || undefined
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

            // Identifies the file in the draft (see ImportDraftFileInfo).
            // Computed before any state update below, so the preview and
            // its draft identity are set together.
            const fingerprint =
                await fingerprintFile(selectedFile);

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
            setSelfLearningDisabledRows(new Map());
            setCategoryScope(null);
            setShowAffectedRowsOnly(false);

            // A new draft for this preview; its first auto-save replaces
            // the previous draft (already confirmed above).
            setDraftId(crypto.randomUUID());
            setDraftCreatedAt(new Date().toISOString());
            setDraftFile({
                name: selectedFile.name,
                size: selectedFile.size,
                lastModified: selectedFile.lastModified,
                fingerprint,
            });

            // Unlocked (or never needed a password) - nothing left to
            // hold in memory.
            setExcelPassword("");
            setExcelPasswordRequired(false);
            setExcelPasswordError(null);
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
            setSelfLearningDisabledRows(new Map());
            setCategoryScope(null);
            setShowAffectedRowsOnly(false);

            const decision =
                classifyExcelPasswordError(err);

            setExcelPasswordRequired(
                decision.showPasswordPrompt
            );
            setExcelPasswordError(
                decision.passwordErrorMessage
            );
            setError(decision.genericErrorMessage);

            // Nothing further to try (an unrelated error, or an
            // unsupported protection scheme where retrying can never
            // succeed) - don't keep whatever was typed in memory.
            if (!decision.showPasswordPrompt) {
                setExcelPassword("");
            }
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
    // untouched here. Deliberately leaves previewOverrides/
    // selfLearningDisabledRows (and any row's live draft) exactly as they are: this
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
    const handleTransactionTypeOverride = useCallback((
        rowNumber: number,
        value: TransactionChannel | ""
    ) => {
        setPreviewOverrides(previous =>
            applyTransactionTypeToMatchingRows(
                previewRef.current?.candidates ?? [],
                previous,
                rowNumber,
                value
            )
        );
    }, []);

    // Category select - fires once per choice, so (like Type) it
    // propagates directly on change. Only ever updates preview state;
    // nothing is written until the actual Import.
    const handleCategoryOverride = useCallback((
        rowNumber: number,
        value: string
    ) => {
        setPreviewOverrides(previous =>
            applyCategoryToMatchingRows(
                previewRef.current?.candidates ?? [],
                previous,
                rowNumber,
                value
            )
        );
    }, []);

    // Balance-mismatch resolution (see importBalanceReview.ts): explicit,
    // single-row user actions only - never propagated, never automatic.
    const handleBalanceDirectionChange = useCallback((
        rowNumber: number,
        direction: "income" | "expense"
    ) => {
        setPreviewOverrides(previous =>
            applyBalanceDirection(
                previous,
                previewRef.current?.candidates ?? [],
                rowNumber,
                direction
            )
        );
    }, []);

    const handleBalanceAmountCommit = useCallback((
        rowNumber: number,
        amount: number
    ) => {
        setPreviewOverrides(previous =>
            applyBalanceAmount(
                previous,
                previewRef.current?.candidates ?? [],
                rowNumber,
                amount
            )
        );
    }, []);

    const handleBalanceSkipToggle = useCallback((
        rowNumber: number
    ) => {
        setPreviewOverrides(previous =>
            toggleBalanceSkip(previous, rowNumber)
        );
    }, []);

    // Custom Import Rules: loaded per account; after a create/edit/delete the
    // open preview is re-derived from its Self-Learning-only candidates
    // (reapplyCustomImportRules), so the change shows immediately.
    useEffect(() => {
        if (!selectedAccountId) {
            setCustomRules([]);
            return;
        }

        let cancelled = false;

        service
            .listCustomRules(selectedAccountId)
            .then(rules => {
                if (!cancelled) {
                    setCustomRules(rules);
                }
            })
            .catch(err =>
                console.error("CUSTOM RULES LOAD ERROR:", err)
            );

        return () => {
            cancelled = true;
        };
    }, [service, selectedAccountId]);

    const refreshCustomRules = async () => {
        const rules =
            await service.listCustomRules(selectedAccountId);

        setCustomRules(rules);
        setPreview(previous =>
            previous
                ? reapplyCustomImportRules(previous, rules)
                : previous
        );
    };

    // The dialog's rule manager is scoped to the selected account, so
    // input.accountId is always selectedAccountId.
    const handleCreateCustomRule = async (
        input: CreateCustomImportRuleInput
    ) => {
        await service.createCustomRule(input);
        await refreshCustomRules();
    };

    // Edits the existing rule in place; the open preview is re-derived
    // with the updated rule (never touches transactions).
    const handleUpdateCustomRule = async (
        id: string,
        input: CreateCustomImportRuleInput
    ) => {
        await service.updateCustomRule(id, input);
        await refreshCustomRules();
    };

    // Errors surface in the manager's delete confirmation.
    const handleDeleteCustomRule = async (id: string) => {
        await service.deleteCustomRule(id);
        await refreshCustomRules();
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
    // that only received it from this same edit. The row drops its own
    // live draft right after calling this (see ImportPreviewRow), since
    // previewOverrides now reflects the committed outcome.
    const handlePayeeOverrideCommit = useCallback((
        rowNumber: number,
        value: string
    ) => {
        setPreviewOverrides(previous =>
            applyPayeeToMatchingRows(
                previewRef.current?.candidates ?? [],
                previous,
                rowNumber,
                value
            )
        );
    }, []);

    // Fires once an edit to the Notes field is finished (on blur) - see
    // handlePayeeOverrideCommit, same reasoning, including undo
    // detection and the row dropping its live draft.
    const handleNotesOverrideCommit = useCallback((
        rowNumber: number,
        value: string
    ) => {
        setPreviewOverrides(previous =>
            applyNotesToMatchingRows(
                previewRef.current?.candidates ?? [],
                previous,
                rowNumber,
                value
            )
        );
    }, []);

    // ---------------------------------------------------------------
    // Import Draft: auto-save, recovery, discard.
    // ---------------------------------------------------------------

    // Auto-save: every change to the open preview or its edits schedules
    // a (debounced) save of the latest state - see ImportDraftAutoSaver.
    // Closing the preview schedules nothing and deletes nothing.
    useEffect(() => {
        if (!preview || !draftId || !draftFile) {
            return;
        }

        draftSaver.schedule({
            id: draftId,
            createdAt: draftCreatedAt,
            preview,
            state: {
                accountId: selectedAccountId,
                importType,
                file: draftFile,
                mappingName,
                matchedMapping,
                overrides: previewOverrides,
                selfLearningDisabledRows,
                categoryScope,
                showAffectedRowsOnly,
            },
        });
    }, [
        draftSaver,
        preview,
        draftId,
        draftCreatedAt,
        draftFile,
        selectedAccountId,
        importType,
        mappingName,
        matchedMapping,
        previewOverrides,
        selfLearningDisabledRows,
        categoryScope,
        showAffectedRowsOnly,
    ]);

    // Recovery: look for an unfinished draft when the page opens (after
    // a reload, a restart, or navigating back here).
    useEffect(() => {
        let cancelled = false;

        draftStore
            .getSummary()
            .then(summary => {
                if (!cancelled && summary) {
                    setStoredDraft(summary);
                    setRecoveryDialogOpen(true);
                }
            })
            .catch(err =>
                console.error("IMPORT DRAFT LOAD ERROR:", err)
            );

        return () => {
            cancelled = true;
        };
    }, [draftStore]);

    // Save what's pending when leaving the page (navigation/unmount) or
    // when the window is hidden; and, as a secondary guard only, ask
    // before a reload/close while a save is still outstanding. The saved
    // draft - not this prompt - is what protects the work.
    useEffect(() => {
        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            if (!draftSaver.hasUnsavedChanges()) {
                return;
            }

            void draftSaver.flush();
            event.preventDefault();
            event.returnValue = "";
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === "hidden") {
                void draftSaver.flush();
            }
        };

        window.addEventListener("beforeunload", handleBeforeUnload);
        document.addEventListener(
            "visibilitychange",
            handleVisibilityChange
        );

        return () => {
            window.removeEventListener(
                "beforeunload",
                handleBeforeUnload
            );
            document.removeEventListener(
                "visibilitychange",
                handleVisibilityChange
            );
            void draftSaver.flush();
        };
    }, [draftSaver]);

    // Puts the saved draft back exactly as it was: same account, import
    // type, mapping, scope, rows and every edit. Nothing is recomputed
    // (no file re-read, normalization, rule or duplicate pass).
    const handleResumeDraft = async () => {
        if (!storedDraft) {
            return;
        }

        try {
            setResumingDraft(true);
            setDraftRecoveryError(null);

            const record = await draftStore.load(
                storedDraft.id
            );

            if (!record) {
                throw new ImportDraftError(
                    "The unfinished import could not be found. It may have been discarded or imported already."
                );
            }

            const restored = parseImportDraft(record);
            const { state } = restored;

            // Anything still pending belongs to whatever preview was open
            // before - save it first; then record that the database holds
            // this draft exactly, so resuming doesn't rewrite it.
            await draftSaver.flush();
            draftSaver.markWritten(
                restored.id,
                restored.preview,
                record.stateJson,
                restored.updatedAt
            );

            setSelectedFile(null);

            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }

            draftReplacementConfirmedRef.current = false;
            setExcelPassword("");
            setExcelPasswordRequired(false);
            setExcelPasswordError(null);

            // Rules may have been added, edited or deleted (Import Rules
            // page) since the draft was saved - show the current ones.
            const currentRules = await service
                .listCustomRules(state.accountId)
                .catch(err => {
                    console.error("CUSTOM RULES LOAD ERROR:", err);
                    return null;
                });

            setSelectedAccountId(state.accountId);
            setImportType(state.importType);

            if (currentRules) {
                setCustomRules(currentRules);
                setPreview(
                    reapplyCustomImportRulesIfChanged(
                        restored.preview,
                        currentRules
                    )
                );
            } else {
                setPreview(restored.preview);
            }
            setMappingName(state.mappingName);
            setMatchedMapping(state.matchedMapping);
            setPreviewOverrides(state.overrides);
            setSelfLearningDisabledRows(
                state.selfLearningDisabledRows
            );
            setCategoryScope(state.categoryScope);
            setShowAffectedRowsOnly(state.showAffectedRowsOnly);

            setDraftId(restored.id);
            setDraftCreatedAt(restored.createdAt);
            setDraftFile(state.file);
            setDraftSaveStatus({
                kind: "saved",
                at: restored.updatedAt,
            });

            setError(null);
            setMessage(
                `Unfinished import restored: ${restored.preview.candidates.length.toLocaleString("en-US")} rows from ${state.file.name}.`
            );
            setRecoveryDialogOpen(false);
        } catch (err) {
            console.error("IMPORT DRAFT RESTORE ERROR:", err);

            setDraftRecoveryError(
                err instanceof ImportDraftError
                    ? `${err.message} You can discard it and preview the statement again.`
                    : `The unfinished import could not be restored: ${
                          err instanceof Error ? err.message : String(err)
                      }`
            );
        } finally {
            setResumingDraft(false);
        }
    };

    // Explicit discard (after a second confirmation in the dialog) - the
    // only way, besides a committed import, that a draft is deleted.
    const handleDiscardDraft = async () => {
        if (!storedDraft) {
            return;
        }

        const discardedId = storedDraft.id;

        try {
            setDiscardingDraft(true);

            await draftSaver.forget(discardedId);
            await draftStore.delete(discardedId);

            setStoredDraft(null);
            setDraftRecoveryError(null);
            setRecoveryDialogOpen(false);

            if (draftId === discardedId) {
                setDraftId(null);
                setDraftSaveStatus({ kind: "idle" });
            }

            setMessage("Unfinished import discarded.");
        } catch (err) {
            console.error("IMPORT DRAFT DISCARD ERROR:", err);

            setDraftRecoveryError(
                err instanceof Error ? err.message : String(err)
            );
        } finally {
            setDiscardingDraft(false);
        }
    };

    const handleConfirmReplaceDraft = () => {
        draftReplacementConfirmedRef.current = true;
        setReplaceDraftDialogOpen(false);
        void handlePreview();
    };

    const handleImport = async () => {
        // A preview restored from a draft has no File any more - only its
        // name, which is all the import needs.
        const sourceFileName = previewSourceFileName;

        const blockingError = resolveImportBlockingError({
            hasAccount: !!selectedAccountId,
            hasFile: !!sourceFileName,
            hasPreview: !!preview,
            errorRows: previewErrorRows,
            readyRows: previewReadyRows,
            balanceMismatchRows:
                balanceReview.unresolvedRowNumbers.size,
        });

        if (blockingError || !sourceFileName || !preview) {
            setError(blockingError);
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
            //
            // The draft is removed only once the import has committed; if
            // it throws or ends FAILED the draft stays for a retry (see
            // runImportWithDraft).
            const {
                batch,
                draftCleared,
                draftDeleteError,
            } = await runImportWithDraft({
                draftId,
                saver: draftSaver,
                store: draftStore,
                runImport: async () => await service.importCandidates(
                    selectedAccountId,
                    sourceFileName,
                    importType,
                    previewCandidates,
                    savedName,
                    selfLearningDisabledRowNumbers,
                    // Each row as previewed before any edit - only a row
                    // the user genuinely corrected against this ever
                    // creates/updates a learned rule (see
                    // learnRuleFromCandidate).
                    new Map(
                        preview.candidates.map(candidate => [
                            candidate.rowNumber,
                            candidate,
                        ])
                    ),
                    // Skipped rows are left out; for a PDF the service
                    // re-checks the running balance itself and refuses
                    // any unresolved mismatch (see importCandidates).
                    {
                        skippedRowNumbers: previewOverrides.skipped,
                        requireBalanceReconciliation: previewIsPdf,
                    }
                ),
            });

            if (draftCleared) {
                setDraftId(null);
                setDraftFile(null);
                setStoredDraft(null);
                setDraftSaveStatus({ kind: "idle" });
            }

            const skippedNote =
                previewSkippedRows > 0
                    ? ` ${previewSkippedRows} row${
                          previewSkippedRows === 1 ? "" : "s"
                      } skipped.`
                    : "";

            try {
                await service.saveMapping({
                    name: savedName,
                    institutionName:
                        resolveMappingInstitutionName(
                            preview.institutionName,
                            accounts.find(
                                account =>
                                    account.id ===
                                    selectedAccountId
                            )
                        ),
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
                    } imported.${skippedNote}`
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
                    }.${skippedNote}`
                );
            } else {
                setError(
                    `Import finished with status: ${batch.status}${
                        draftId
                            ? ". Your preview and edits are kept as an unfinished import - resume it to retry."
                            : ""
                    }`
                );
            }

            if (draftDeleteError) {
                setError(
                    "The import completed, but its recovery draft could not be removed. Discard the unfinished import instead of resuming it, or its rows would be imported again."
                );
            }

            setSelectedFile(null);
            setPreview(null);
            setMappingName("");
            setMatchedMapping(null);
            setPreviewOverrides(
                createEmptyPreviewOverrides()
            );
            setSelfLearningDisabledRows(new Map());
            setCategoryScope(null);
            setShowAffectedRowsOnly(false);

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

    // Deletes one Import History record (its import_batches row and
    // import_rows) - see ImportService.deleteBatch. Never deletes any
    // transaction; if the deleted batch was currently open in the
    // Import Details panel below, that panel is closed since there's
    // nothing left for it to show.
    const handleDeleteBatch = async () => {
        if (!batchToDelete) {
            return;
        }

        try {
            setDeletingBatch(true);
            setError(null);

            await service.deleteBatch(
                batchToDelete.id
            );

            if (
                selectedBatch?.id ===
                batchToDelete.id
            ) {
                closeDetails();
            }

            await loadBatches();

            setMessage(
                "Import history record deleted."
            );
        } catch (err) {
            console.error(
                "IMPORT BATCH DELETE ERROR:",
                err
            );

            setError(
                err instanceof Error
                    ? err.message
                    : String(err)
            );
        } finally {
            setDeletingBatch(false);
            setBatchToDelete(null);
        }
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

    const validationErrors =
        preview?.validation.errors ?? NO_ERRORS;

    // The preview's auto-detected/suggested candidates with any per-row
    // Transaction Type / Payee / Notes overrides applied on top - this
    // is what's shown in the table and what actually gets imported.
    //
    // Memoized, and unchanged rows keep their previous object (see
    // reuseUnchangedCandidates), so an edit only re-renders the rows it
    // actually changed - never all of them.
    const baseCandidates = preview?.candidates ?? NO_CANDIDATES;
    const previousCandidatesRef =
        useRef<NormalizedTransactionCandidate[] | null>(null);

    const previewCandidates: NormalizedTransactionCandidate[] =
        useMemo(
            () =>
                reuseUnchangedCandidates(
                    applyPreviewOverrides(
                        baseCandidates,
                        previewOverrides
                    ),
                    previousCandidatesRef.current
                ),
            [baseCandidates, previewOverrides]
        );

    // PDF running-balance check (see importBalanceReview.ts). Only for a
    // PDF statement - CSV/Excel imports are unchanged. Mismatches are
    // detected once on the rows as previewed, then re-checked against the
    // user's corrections/skips; unresolved ones block the Import.
    //
    // The file the open preview came from: the draft's record of it (set
    // with every new preview, and the only one left after a restore),
    // else the selected File.
    const previewSourceFileName =
        draftFile?.name ?? selectedFile?.name ?? null;

    const previewIsPdf =
        preview !== null &&
        previewSourceFileName !== null &&
        /\.pdf$/i.test(previewSourceFileName);

    const detectedBalanceMismatches = useMemo(
        () =>
            previewIsPdf
                ? detectBalanceMismatches(baseCandidates)
                : NO_BALANCE_MISMATCHES,
        [previewIsPdf, baseCandidates]
    );

    const previousBalanceReviewRef =
        useRef<BalanceReview | null>(null);

    const balanceReview: BalanceReview = useMemo(
        () =>
            reviewBalanceCorrections(
                detectedBalanceMismatches,
                previewCandidates,
                previewOverrides.skipped,
                previousBalanceReviewRef.current
            ),
        [
            detectedBalanceMismatches,
            previewCandidates,
            previewOverrides.skipped,
        ]
    );

    const previewErrors = useMemo(
        () =>
            combinePreviewErrors(
                validationErrors,
                previewOverrides.skipped,
                balanceReview.errors
            ),
        [
            validationErrors,
            previewOverrides.skipped,
            balanceReview.errors,
        ]
    );

    useLayoutEffect(() => {
        previousCandidatesRef.current = previewCandidates;
        previewCandidatesRef.current = previewCandidates;
        previewRef.current = preview;
        previousBalanceReviewRef.current = balanceReview;
    });

    // Which rows an existing self-learned rule actually matched during
    // preview enrichment (see ImportService's
    // enrichCandidatesWithLearnedRulesDetailed) - the single source of
    // truth for the Self-Learning indicator below, never recomputed here.
    const matchedLearnedRuleRowNumbers: ReadonlySet<number> =
        preview?.matchedLearnedRuleRowNumbers ?? NO_ROW_NUMBERS;

    // Rows a Custom Import Rule applied to, and how many per rule.
    const customRuleApplications =
        preview?.customRuleState?.applications;

    // A row whose matching rule's category was NOT applied (locked to the
    // other direction - see applyCustomImportRules) gets a note under its
    // Category select until it has a category again.
    const rejectedRuleCategoryNotice = (
        candidate: NormalizedTransactionCandidate,
        application: CustomRuleApplication | undefined,
        rules: readonly CustomImportRule[],
        allCategories: readonly Category[]
    ): string | undefined => {
        const rejected = application?.rejectedCategory;

        // Gone once the row has a category, or once its direction was
        // corrected in the preview to the one the category is locked to.
        if (
            !rejected ||
            candidate.categoryId ||
            candidate.type === rejected.lockedTo
        ) {
            return undefined;
        }

        return describeRejectedRuleCategory({
            keyword:
                rules
                    .find(rule => rule.id === rejected.ruleId)
                    ?.keyword.trim() ?? application.keyword,
            categoryName:
                allCategories.find(
                    category => category.id === rejected.categoryId
                )?.name ?? null,
            lockedTo: rejected.lockedTo,
            direction: candidate.type,
        });
    };

    const customRuleCountByRule = useMemo(() => {
        const counts = new Map<string, number>();

        for (const application of customRuleApplications?.values() ?? []) {
            for (const ruleId of application.ruleIds) {
                counts.set(ruleId, (counts.get(ruleId) ?? 0) + 1);
            }
        }

        return counts;
    }, [customRuleApplications]);

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

    // Learned / manually processed / total-processed counters shown above
    // the preview table - see countImportProgress. Derived from the same
    // state the Self-Learning indicators use, so they update on every
    // edit, propagation, toggle or new preview.
    const importProgress = useMemo(
        () =>
            countImportProgress(
                baseCandidates,
                matchedLearnedRuleRowNumbers,
                sessionLearnedRowNumbers,
                selfLearningDisabledRows,
                previewOverrides
            ),
        [
            baseCandidates,
            matchedLearnedRuleRowNumbers,
            sessionLearnedRowNumbers,
            selfLearningDisabledRows,
            previewOverrides,
        ]
    );

    // Category options per Credit/Debit direction for the destination
    // account - see resolveImportCategoryOptions.
    const categoryOptionsByDirection = useMemo(() => {
        const account = accounts.find(
            item => item.id === selectedAccountId
        );
        const context = account
            ? {
                  id: account.id,
                  businessEntityId:
                      account.businessEntityId ?? null,
              }
            : null;
        const build = (
            direction: NormalizedTransactionCandidate["type"]
        ) =>
            resolveImportCategoryOptions({
                categories,
                mappings: categoryContextMappings,
                account: context,
                direction,
                scope: categoryScope,
            });

        return {
            income: build("income"),
            expense: build("expense"),
            transfer: build("transfer"),
            none: build(null),
        };
    }, [
        accounts,
        selectedAccountId,
        categories,
        categoryContextMappings,
        categoryScope,
    ]);

    // Rows whose category (e.g. a learned one) is outside the selected
    // Category Scope (none when no scope is chosen). Review-only: shown as
    // "(unavailable)" and listable via "Show N Affected Rows"; never
    // silently changed, never blocking the Import.
    const categoryScopeAffectedRows = useMemo(
        () =>
            rowsWithCategoryOutsideScope(
                previewCandidates,
                categories,
                categoryScope
            ),
        [previewCandidates, categories, categoryScope]
    );

    // The affected-only view applies only once a scope is chosen (with
    // none, nothing is out of scope). Set lookup per row keeps filtering O(1)
    // per row; unchanged rows keep their memoized props (see
    // ImportPreviewRow), so the view never re-renders every row per edit.
    const affectedRowsViewActive =
        showAffectedRowsOnly && categoryScope !== null;

    const categoryScopeAffectedRowSet = useMemo(
        () => new Set(categoryScopeAffectedRows),
        [categoryScopeAffectedRows]
    );

    const affectedRowsToggle = categoryScope
        ? affectedRowsToggleLabel(
              affectedRowsViewActive,
              categoryScopeAffectedRows.length
          )
        : null;

    // TRANSFER-category ids: a row categorised as a transfer is shown -
    // and imported - as a Transfer (see TransactionService's transfer
    // rule). Same shared rule as everywhere else.
    const transferCategoryIds = useMemo(
        () => transferCategoryIdSet(categories),
        [categories]
    );

    // Rows with at least one validation error - one lookup per row
    // instead of filtering every error for every row.
    const errorRowNumbers = useMemo(
        () =>
            new Set(
                previewErrors.map(error => error.rowNumber)
            ),
        [previewErrors]
    );

    const handleViewDescription = useCallback(
        (value: string) =>
            setFullTextView({
                label: "Description",
                value,
            }),
        []
    );
    const previewTotalRows =
        preview?.candidates.length ?? 0;

    const previewErrorRows =
        errorRowNumbers.size;

    const previewDuplicateRows =
        preview?.duplicates.size ?? 0;

    const previewSkippedRows =
        previewOverrides.skipped.size;

    // Not skipped, no error, not a duplicate.
    const previewReadyRows = preview
        ? countReadyRows(
              previewCandidates,
              errorRowNumbers,
              preview.duplicates,
              previewOverrides.skipped
          )
        : 0;

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

                    <div
                        data-testid="new-import-fields"
                        className="mt-7 grid grid-cols-1 items-start gap-5 sm:grid-cols-3"
                    >

                        <div className="min-w-0">
                            <label className="mb-2 block truncate text-sm font-medium leading-5 text-slate-700">
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

                                <option value="CREDIT_CARD_EXCEL">
                                    Credit Card Excel
                                </option>
                            </select>
                        </div>

                        <div className="min-w-0">
                            <label className="mb-2 block truncate text-sm font-medium leading-5 text-slate-700">
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

                        <div className="min-w-0">
                            <label className="mb-2 block truncate text-sm font-medium leading-5 text-slate-700">
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

                    {!selectedFile && preview && draftFile && (
                        <div
                            data-testid="import-draft-file"
                            className="mt-5 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600"
                        >
                            Statement file:
                            <span className="ml-1 font-medium text-slate-900">
                                {draftFile.name}
                            </span>
                            <span className="ml-1 text-slate-400">
                                (restored from your unfinished import)
                            </span>
                        </div>
                    )}

                    {preview &&
                        draftId &&
                        !accountsLoading &&
                        selectedAccountId &&
                        !accounts.some(
                            account => account.id === selectedAccountId
                        ) && (
                            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                The account this import was started for no longer exists. Discard the unfinished import or choose another account and preview the statement again.
                            </div>
                        )}

                    {storedDraft && !preview && (
                        <ImportDraftBanner
                            draft={storedDraft}
                            onOpen={() => {
                                setDraftRecoveryError(null);
                                setRecoveryDialogOpen(true);
                            }}
                        />
                    )}

                    {excelPasswordRequired && (
                        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
                            <div className="text-sm font-semibold text-amber-800">
                                Password required
                            </div>

                            <p className="mt-1 text-xs text-amber-700">
                                This Excel file is password-protected. Enter its password to continue.
                            </p>

                            {excelPasswordError && (
                                <p className="mt-2 text-xs font-medium text-red-600">
                                    {excelPasswordError}
                                </p>
                            )}

                            <div className="mt-3 flex items-center gap-3">
                                <input
                                    type="password"
                                    autoComplete="off"
                                    value={excelPassword}
                                    onChange={event =>
                                        setExcelPassword(
                                            event.target.value
                                        )
                                    }
                                    onKeyDown={event => {
                                        if (
                                            event.key === "Enter" &&
                                            excelPassword &&
                                            !previewing
                                        ) {
                                            void handlePreview();
                                        }
                                    }}
                                    placeholder="Enter password"
                                    disabled={previewing}
                                    className="h-10 flex-1 rounded-lg border border-amber-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-amber-400 disabled:bg-slate-50"
                                />

                                <button
                                    type="button"
                                    onClick={() =>
                                        void handlePreview()
                                    }
                                    disabled={
                                        previewing ||
                                        !excelPassword
                                    }
                                    className="inline-flex h-10 items-center gap-2 rounded-lg bg-amber-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {previewing
                                        ? "Unlocking..."
                                        : excelPasswordError
                                            ? "Retry"
                                            : "Unlock"}
                                </button>
                            </div>
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

                    <div
                        data-testid="import-actions"
                        className="mt-6 flex flex-wrap items-center justify-end gap-3"
                    >

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

                        {!preview && !excelPasswordRequired && (
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

                            <div className="flex flex-wrap items-center justify-end gap-2">
                            <ImportDraftSaveIndicator
                                status={draftSaveStatus}
                            />
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

                        {balanceReview.rows.size > 0 && (
                            <div
                                data-testid="balance-review-summary"
                                className={`mt-6 rounded-2xl border p-4 text-sm ${
                                    balanceReview.counts.mismatch > 0
                                        ? "border-red-100 bg-red-50 text-red-700"
                                        : "border-emerald-100 bg-emerald-50 text-emerald-700"
                                }`}
                            >
                                <div className="flex items-center gap-2 font-semibold">
                                    <AlertTriangle size={16} />
                                    {balanceReview.counts.mismatch > 0
                                        ? `${balanceReview.counts.mismatch} row${
                                              balanceReview.counts.mismatch === 1
                                                  ? " does"
                                                  : "s do"
                                          } not match the statement's running balance`
                                        : "Every flagged row is resolved"}
                                    {(balanceReview.counts.corrected > 0 ||
                                        balanceReview.counts.skipped > 0) && (
                                        <span className="font-normal">
                                            {" "}
                                            ({balanceReview.counts.corrected} corrected,{" "}
                                            {balanceReview.counts.skipped} skipped)
                                        </span>
                                    )}
                                </div>

                                <p className="mt-1.5 text-xs leading-relaxed">
                                    Expected balance = the previous row&apos;s
                                    statement balance plus this row&apos;s Income or
                                    minus its Expense. Difference = statement
                                    balance minus expected balance. Nothing has
                                    been changed automatically. Correct the amount
                                    or Income/Expense of each highlighted row until
                                    it matches, or skip it. A mismatched row
                                    can&apos;t be imported until you do.
                                </p>
                            </div>
                        )}

                        {/* Preview header row: progress counters left,
                            Category Scope right. Wraps (never overlaps) on
                            narrow screens; ml-auto keeps the scope block
                            right-aligned even when it wraps to its own line. */}
                        <div
                            data-testid="import-preview-header"
                            className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3"
                        >
                            {/* Left group: progress counters, then the
                                icon-only Custom Rules button (same wand icon
                                as the per-row Custom Rule indicator beside a
                                row's Payee; pill-height, 28px). Wraps as one
                                group. */}
                            <div
                                data-testid="import-progress-group"
                                className="flex flex-wrap items-center gap-2"
                            >
                                <ImportProgressCounters
                                    counts={importProgress}
                                />

                                <button
                                    type="button"
                                    onClick={() => setCustomRulesOpen(true)}
                                    disabled={!selectedAccountId || importing}
                                    data-testid="manage-custom-rules"
                                    aria-label="Custom Rules"
                                    title="Custom Rules"
                                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 transition hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <Wand2
                                        size={14}
                                        aria-hidden="true"
                                        className="text-violet-600"
                                    />
                                </button>
                            </div>

                            <div
                                data-testid="import-category-scope"
                                className="ml-auto flex flex-row flex-nowrap items-center gap-2 whitespace-nowrap"
                            >
                                <span
                                    id="import-category-scope-label"
                                    className="text-xs font-medium text-slate-600"
                                >
                                    Category Scope
                                </span>

                                <div
                                    role="radiogroup"
                                    aria-labelledby="import-category-scope-label"
                                    className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-0.5"
                                >
                                    {(["PERSONAL", "BUSINESS"] as const).map(scope => (
                                        <button
                                            key={scope}
                                            type="button"
                                            role="radio"
                                            aria-checked={categoryScope === scope}
                                            onClick={() => setCategoryScope(scope)}
                                            disabled={importing}
                                            className={
                                                categoryScope === scope
                                                    ? "rounded-full bg-white px-3 py-px text-sm font-semibold text-slate-900 shadow-sm"
                                                    : "rounded-full px-3 py-px text-sm font-medium text-slate-500 hover:text-slate-800 disabled:cursor-not-allowed"
                                            }
                                        >
                                            {financeScopeLabel(scope)}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {categoryScope && categoryScopeAffectedRows.length > 0 && (
                            <div className="mt-3 flex flex-wrap items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                                <span className="flex-1">
                                    {`${categoryScopeAffectedRows.length} row(s) have a category that isn't in ${financeScopeLabel(categoryScope)} (shown as "unavailable"). They will import with that category unless you change it - you can pick a ${financeScopeLabel(categoryScope)} category or Uncategorized.`}
                                </span>

                                {affectedRowsToggle && (
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setShowAffectedRowsOnly(
                                                !affectedRowsViewActive
                                            )
                                        }
                                        className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1 text-sm font-semibold text-amber-800 hover:bg-amber-100"
                                    >
                                        {affectedRowsToggle}
                                    </button>
                                )}
                            </div>
                        )}

                        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-100">

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

                                <table className="w-full min-w-[1060px] text-left">

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
                                                Category
                                            </th>

                                            <th className="px-4 py-3">
                                                Notes
                                            </th>

                                        </tr>

                                    </thead>

                                    <tbody className="divide-y divide-slate-100">

                                        {affectedRowsViewActive &&
                                            categoryScopeAffectedRows.length === 0 && (
                                                <tr>
                                                    <td
                                                        colSpan={8}
                                                        className="px-4 py-10 text-center text-sm text-slate-500"
                                                    >
                                                        No affected rows left - every category is available under{" "}
                                                        {categoryScope && financeScopeLabel(categoryScope)}.{" "}
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                setShowAffectedRowsOnly(false)
                                                            }
                                                            className="font-semibold text-slate-800 underline underline-offset-2 hover:text-slate-950"
                                                        >
                                                            Show All Rows
                                                        </button>
                                                    </td>
                                                </tr>
                                            )}

                                        {previewCandidates.map(
                                            (candidate, candidateIndex) => {
                                                // Affected-only view: skip rows that aren't
                                                // affected (display numbers stay the rows'
                                                // positions in the full preview).
                                                if (
                                                    !isPreviewRowVisible(
                                                        candidate.rowNumber,
                                                        categoryScopeAffectedRowSet,
                                                        affectedRowsViewActive
                                                    )
                                                ) {
                                                    return null;
                                                }

                                                // Single source of truth for this row's Self-Learning
                                                // indicator - see resolveSelfLearningIndicator.
                                                const selfLearningIndicator =
                                                    resolveSelfLearningIndicator(
                                                        candidate.rowNumber,
                                                        matchedLearnedRuleRowNumbers,
                                                        sessionLearnedRowNumbers,
                                                        selfLearningDisabledRows
                                                    );

                                                // Memoized row: every prop is a primitive or a
                                                // stable reference, so it re-renders only when
                                                // this row itself changes - see ImportPreviewRow.
                                                return (
                                                    <ImportPreviewRow
                                                        key={candidate.rowNumber}
                                                        candidate={candidate}
                                                        displayNumber={candidateIndex + 1}
                                                        hasErrors={errorRowNumbers.has(
                                                            candidate.rowNumber
                                                        )}
                                                        isDuplicate={
                                                            preview?.duplicates.has(
                                                                candidate.rowNumber
                                                            ) ?? false
                                                        }
                                                        isTransfer={isTransferClassified(
                                                            candidate,
                                                            transferCategoryIds
                                                        )}
                                                        indicatorState={selfLearningIndicator.state}
                                                        indicatorClickable={selfLearningIndicator.clickable}
                                                        hasMatchedLearnedRule={
                                                            selfLearningIndicator.hasMatchedLearnedRule
                                                        }
                                                        importing={importing}
                                                        directionCategoryOptions={
                                                            categoryOptionsByDirection[
                                                                candidate.type ?? "none"
                                                            ]
                                                        }
                                                        categories={categories}
                                                        categoriesLoading={categoriesLoading}
                                                        onToggleSelfLearning={handleToggleSelfLearning}
                                                        onPayeeCommit={handlePayeeOverrideCommit}
                                                        onTransactionTypeChange={handleTransactionTypeOverride}
                                                        onCategoryChange={handleCategoryOverride}
                                                        onNotesCommit={handleNotesOverrideCommit}
                                                        onViewDescription={handleViewDescription}
                                                        balanceReview={balanceReview.rows.get(
                                                            candidate.rowNumber
                                                        )}
                                                        onBalanceDirectionChange={handleBalanceDirectionChange}
                                                        onBalanceAmountCommit={handleBalanceAmountCommit}
                                                        onBalanceSkipToggle={handleBalanceSkipToggle}
                                                        customRuleKeyword={
                                                            customRuleApplications?.get(
                                                                candidate.rowNumber
                                                            )?.keyword
                                                        }
                                                        customRuleCategoryNotice={rejectedRuleCategoryNotice(
                                                            candidate,
                                                            customRuleApplications?.get(
                                                                candidate.rowNumber
                                                            ),
                                                            customRules,
                                                            categories
                                                        )}
                                                    />
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
                            title="Refresh saved mappings"
                            aria-label="Refresh saved mappings"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                        >
                            <RefreshCw
                                size={15}
                            />
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
                                                                    <div className="inline-flex items-center gap-2">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() =>
                                                                                handleStartRenameMapping(
                                                                                    mapping
                                                                                )
                                                                            }
                                                                            title="Rename saved mapping"
                                                                            aria-label="Rename saved mapping"
                                                                            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                                                                        >
                                                                            <Pencil
                                                                                size={
                                                                                    14
                                                                                }
                                                                            />
                                                                        </button>

                                                                        <button
                                                                            type="button"
                                                                            onClick={() =>
                                                                                setMappingToDelete(
                                                                                    mapping
                                                                                )
                                                                            }
                                                                            disabled={
                                                                                deletingMapping
                                                                            }
                                                                            title="Delete saved mapping"
                                                                            aria-label="Delete saved mapping"
                                                                            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                                                                        >
                                                                            <Trash2
                                                                                size={
                                                                                    14
                                                                                }
                                                                            />
                                                                        </button>
                                                                    </div>
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
                            title="Refresh import history"
                            aria-label="Refresh import history"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                        >
                            <RefreshCw
                                size={15}
                            />
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

                                                            <div className="inline-flex items-center gap-2">

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
                                                                title="View import details"
                                                                aria-label="View import details"
                                                                className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                                                            >
                                                                <Eye
                                                                    size={
                                                                        14
                                                                    }
                                                                />
                                                            </button>

                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    setBatchToDelete(
                                                                        batch
                                                                    )
                                                                }
                                                                disabled={
                                                                    deletingBatch
                                                                }
                                                                title="Delete import history"
                                                                aria-label="Delete import history"
                                                                className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                                                            >
                                                                <Trash2
                                                                    size={
                                                                        14
                                                                    }
                                                                />
                                                            </button>

                                                            </div>

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

            <CustomRulesDialog
                open={customRulesOpen}
                onOpenChange={setCustomRulesOpen}
                accountId={selectedAccountId || null}
                accountName={
                    accounts.find(
                        account => account.id === selectedAccountId
                    )?.name ?? null
                }
                accounts={accounts}
                rules={customRules}
                previewCandidates={baseCandidates}
                appliedCountByRule={customRuleCountByRule}
                categories={categories}
                formatDate={formatDate}
                onCreate={handleCreateCustomRule}
                onUpdate={handleUpdateCustomRule}
                onDelete={handleDeleteCustomRule}
            />

            <ImportDraftRecoveryDialog
                open={recoveryDialogOpen}
                draft={storedDraft}
                accountName={
                    accounts.find(
                        account =>
                            account.id === storedDraft?.accountId
                    )?.name ?? null
                }
                resuming={resumingDraft}
                discarding={discardingDraft}
                error={draftRecoveryError}
                onOpenChange={setRecoveryDialogOpen}
                onResume={() => void handleResumeDraft()}
                onDiscard={() => void handleDiscardDraft()}
            />

            <ReplaceImportDraftDialog
                open={replaceDraftDialogOpen}
                draft={storedDraft}
                onCancel={() => setReplaceDraftDialogOpen(false)}
                onConfirm={handleConfirmReplaceDraft}
            />

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

            <AlertDialog
                open={batchToDelete !== null}
                onOpenChange={open => {
                    if (!deletingBatch && !open) {
                        setBatchToDelete(null);
                    }
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Delete this import history record?
                        </AlertDialogTitle>

                        <AlertDialogDescription>
                            {batchToDelete && (
                                <>
                                    <span className="font-medium text-slate-700">
                                        {
                                            batchToDelete.sourceFileName
                                        }
                                    </span>{" "}
                                    will be removed from Import
                                    History.
                                    <br />
                                    <br />
                                </>
                            )}
                            This does NOT delete any financial
                            transactions - any transactions already
                            imported from this record remain exactly
                            as they are. Only this history record
                            (and its row-level import details) is
                            removed.
                        </AlertDialogDescription>
                    </AlertDialogHeader>

                    <AlertDialogFooter>
                        <AlertDialogCancel
                            disabled={deletingBatch}
                        >
                            Cancel
                        </AlertDialogCancel>

                        <AlertDialogAction
                            disabled={deletingBatch}
                            onClick={() =>
                                void handleDeleteBatch()
                            }
                            className="bg-red-600 hover:bg-red-700"
                        >
                            {deletingBatch
                                ? "Deleting..."
                                : "Delete"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog
                open={mappingToDelete !== null}
                onOpenChange={open => {
                    if (!deletingMapping && !open) {
                        setMappingToDelete(null);
                    }
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Delete this saved mapping?
                        </AlertDialogTitle>

                        <AlertDialogDescription>
                            {mappingToDelete && (
                                <>
                                    <span className="font-medium text-slate-700">
                                        {
                                            mappingToDelete.name
                                        }
                                    </span>{" "}
                                    will be permanently removed from
                                    Saved Mappings.
                                    <br />
                                    <br />
                                </>
                            )}
                            This does NOT affect any account,
                            transaction, or past import - only this
                            saved column mapping is removed. A future
                            import with the same file structure will
                            no longer auto-fill from it.
                        </AlertDialogDescription>
                    </AlertDialogHeader>

                    <AlertDialogFooter>
                        <AlertDialogCancel
                            disabled={deletingMapping}
                        >
                            Cancel
                        </AlertDialogCancel>

                        <AlertDialogAction
                            disabled={deletingMapping}
                            onClick={() =>
                                void handleDeleteMapping()
                            }
                            className="bg-red-600 hover:bg-red-700"
                        >
                            {deletingMapping
                                ? "Deleting..."
                                : "Delete"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

        </div>
    );
}



















