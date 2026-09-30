import type {
    CsvImportType,
    NormalizedTransactionCandidate,
    TransactionChannel,
} from "@financeos/import-engine";

import type { BaseFinanceScope } from "@/modules/categories/types";

import type {
    CsvPreviewResultWithLearning,
    CustomRulePreviewState,
    ExcelPreviewResult,
} from "../services/ImportService";
import type { CustomRuleApplication } from "../services/customImportRules";
import type {
    ImportBatch,
    ImportDraftRecord,
    ImportDraftSummary,
    ImportMapping,
} from "../types";
import type { PreviewOverrides } from "./ImportsPage";

// ---------------------------------------------------------------------
// Import Draft / Auto-Recovery.
//
// An unfinished Import Preview is persisted (import_drafts, migration
// 042) so a refresh, remount or restart never loses the user's work. The
// draft holds the COMPLETE preview exactly as the page has it - the
// normalized rows (each with its original Description/rawData), document,
// mapping, validation, duplicates, learned/custom-rule state - plus every
// edit made on top of it. Restoring never re-reads the file, re-runs
// normalization, re-applies rules or re-checks duplicates: the page gets
// back the very same objects it had, so it renders the very same screen.
//
// Two payloads, saved independently:
//   preview_json - large (every row); rewritten only when the preview
//                  object itself changes (new preview, mapping change,
//                  custom rule create/delete, clearing learned rules).
//   state_json   - small (overrides, scope, account, ...); rewritten on
//                  every (debounced) edit.
// ---------------------------------------------------------------------

// Bump when the payload shape changes incompatibly; an older/newer draft
// is then reported as incompatible (never half-restored).
export const IMPORT_DRAFT_FORMAT_VERSION = 1;

export type ImportDraftPreview =
    | CsvPreviewResultWithLearning
    | ExcelPreviewResult;

// The statement file the preview was built from. The File itself can't
// survive a reload, so the draft keeps what the page needs from it (the
// name - used for the import batch and PDF detection) plus metadata to
// recognise it.
export interface ImportDraftFileInfo {
    name: string;
    size: number | null;
    lastModified: number | null;
    // SHA-256 of the file content (hex), null when unavailable.
    fingerprint: string | null;
}

export interface ImportDraftState {
    accountId: string;
    importType: CsvImportType;
    file: ImportDraftFileInfo;
    mappingName: string;
    matchedMapping: ImportMapping | null;
    overrides: PreviewOverrides;
    selfLearningDisabledRows: Map<number, boolean>;
    categoryScope: BaseFinanceScope | null;
    showAffectedRowsOnly: boolean;
}

export interface ImportDraftSnapshot {
    id: string;
    createdAt: string;
    preview: ImportDraftPreview;
    state: ImportDraftState;
}

export interface RestoredImportDraft {
    id: string;
    createdAt: string;
    updatedAt: string;
    preview: ImportDraftPreview;
    state: ImportDraftState;
}

// Corrupted or incompatible draft - the page reports it and offers to
// discard it; it never crashes or half-restores.
export class ImportDraftError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ImportDraftError";
    }
}

const IMPORT_TYPES: readonly CsvImportType[] = [
    "BANK_CSV",
    "BANK_EXCEL",
    "BANK_PDF",
    "CREDIT_CARD_CSV",
    "CREDIT_CARD_PDF",
    "CREDIT_CARD_EXCEL",
];

// ---------------------------------------------------------------------
// Encoding. JSON has no Map/Set, so those become entry/value arrays; every
// other value is already plain JSON (strings, numbers, null, arrays,
// objects), so the rest round-trips unchanged.
// ---------------------------------------------------------------------

interface EncodedCustomRuleState {
    candidatesBeforeCustomRules: NormalizedTransactionCandidate[];
    learnedRuleRowNumbers: number[];
    applications: Array<[number, CustomRuleApplication]>;
    categoryDirectionLocks?: Record<string, "income" | "expense">;
}

export function encodeDraftPreview(
    preview: ImportDraftPreview
): Record<string, unknown> {
    const {
        duplicates,
        matchedLearnedRuleRowNumbers,
        customRuleState,
        ...rest
    } = preview;

    return {
        ...rest,
        duplicates: Array.from(duplicates),
        matchedLearnedRuleRowNumbers: Array.from(
            matchedLearnedRuleRowNumbers
        ),
        ...(customRuleState
            ? {
                  customRuleState: {
                      candidatesBeforeCustomRules:
                          customRuleState.candidatesBeforeCustomRules,
                      learnedRuleRowNumbers: Array.from(
                          customRuleState.learnedRuleRowNumbers
                      ),
                      applications: Array.from(
                          customRuleState.applications
                      ),
                      ...(customRuleState.categoryDirectionLocks
                          ? {
                                categoryDirectionLocks: {
                                    ...customRuleState.categoryDirectionLocks,
                                },
                            }
                          : {}),
                  } satisfies EncodedCustomRuleState,
              }
            : {}),
    };
}

export function encodeDraftState(
    state: ImportDraftState
): Record<string, unknown> {
    const { overrides } = state;

    return {
        accountId: state.accountId,
        importType: state.importType,
        file: state.file,
        mappingName: state.mappingName,
        matchedMapping: state.matchedMapping,
        overrides: {
            transactionType: Array.from(overrides.transactionType),
            payee: Array.from(overrides.payee),
            notes: Array.from(overrides.notes),
            categoryId: Array.from(overrides.categoryId),
            direction: Array.from(overrides.direction),
            amount: Array.from(overrides.amount),
            skipped: Array.from(overrides.skipped),
        },
        selfLearningDisabledRows: Array.from(
            state.selfLearningDisabledRows
        ),
        categoryScope: state.categoryScope,
        showAffectedRowsOnly: state.showAffectedRowsOnly,
    };
}

// ---------------------------------------------------------------------
// Decoding + validation. Anything unexpected throws ImportDraftError.
// ---------------------------------------------------------------------

type Json = Record<string, unknown>;

function fail(detail: string): never {
    throw new ImportDraftError(
        `The saved import draft is damaged or incompatible (${detail}).`
    );
}

function isObject(value: unknown): value is Json {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
    );
}

function parseJson(text: string, label: string): Json {
    let value: unknown;

    try {
        value = JSON.parse(text);
    } catch {
        fail(`${label} is not valid JSON`);
    }

    if (!isObject(value)) {
        fail(`${label} is not an object`);
    }

    return value;
}

function expectArray(value: unknown, label: string): unknown[] {
    if (!Array.isArray(value)) {
        fail(`${label} is missing`);
    }

    return value;
}

function isRowNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function decodeRowNumberSet(
    value: unknown,
    label: string
): Set<number> {
    const items = expectArray(value, label);

    if (!items.every(isRowNumber)) {
        fail(`${label} has an invalid row number`);
    }

    return new Set(items as number[]);
}

function decodeRowMap<Value>(
    value: unknown,
    label: string,
    isValue: (item: unknown) => item is Value
): Map<number, Value> {
    const entries = expectArray(value, label);
    const map = new Map<number, Value>();

    for (const entry of entries) {
        if (
            !Array.isArray(entry) ||
            entry.length !== 2 ||
            !isRowNumber(entry[0]) ||
            !isValue(entry[1])
        ) {
            fail(`${label} has an invalid entry`);
        }

        map.set(entry[0], entry[1]);
    }

    return map;
}

const isString = (value: unknown): value is string =>
    typeof value === "string";

function decodeDirectionLocks(
    value: unknown
): Record<string, "income" | "expense"> {
    if (!isObject(value)) {
        fail("the category direction locks are invalid");
    }

    const locks: Record<string, "income" | "expense"> = {};

    for (const [categoryId, direction] of Object.entries(value)) {
        if (direction !== "income" && direction !== "expense") {
            fail("the category direction locks are invalid");
        }

        locks[categoryId] = direction;
    }

    return locks;
}

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);

const isBoolean = (value: unknown): value is boolean =>
    typeof value === "boolean";

const isDirection = (
    value: unknown
): value is "income" | "expense" =>
    value === "income" || value === "expense";

const isApplication = (
    value: unknown
): value is CustomRuleApplication =>
    isObject(value) &&
    Array.isArray(value.ruleIds) &&
    typeof value.keyword === "string";

function decodeCandidates(
    value: unknown,
    label: string
): NormalizedTransactionCandidate[] {
    const candidates = expectArray(value, label);

    for (const candidate of candidates) {
        if (
            !isObject(candidate) ||
            !isRowNumber(candidate.rowNumber) ||
            typeof candidate.description !== "string" ||
            typeof candidate.payee !== "string"
        ) {
            fail(`${label} contains an invalid row`);
        }
    }

    return candidates as unknown as NormalizedTransactionCandidate[];
}

export function decodeDraftPreview(json: Json): ImportDraftPreview {
    const document = json.document;

    if (
        !isObject(document) ||
        !Array.isArray(document.headers) ||
        !Array.isArray(document.rows)
    ) {
        fail("the statement document is missing");
    }

    if (!isObject(json.mapping)) {
        fail("the column mapping is missing");
    }

    if (
        !isObject(json.validation) ||
        !Array.isArray(json.validation.errors)
    ) {
        fail("the validation result is missing");
    }

    const candidates = decodeCandidates(json.candidates, "rows");

    const {
        duplicates,
        matchedLearnedRuleRowNumbers,
        customRuleState,
        ...rest
    } = json;

    let decodedCustomRuleState: CustomRulePreviewState | undefined;

    if (customRuleState !== undefined) {
        if (!isObject(customRuleState)) {
            fail("the custom rule state is invalid");
        }

        decodedCustomRuleState = {
            candidatesBeforeCustomRules: decodeCandidates(
                customRuleState.candidatesBeforeCustomRules,
                "rows before custom rules"
            ),
            learnedRuleRowNumbers: decodeRowNumberSet(
                customRuleState.learnedRuleRowNumbers,
                "learned rule rows"
            ),
            applications: decodeRowMap(
                customRuleState.applications,
                "custom rule rows",
                isApplication
            ),
            ...(customRuleState.categoryDirectionLocks !== undefined
                ? {
                      categoryDirectionLocks: decodeDirectionLocks(
                          customRuleState.categoryDirectionLocks
                      ),
                  }
                : {}),
        };
    }

    return {
        ...(rest as unknown as ImportDraftPreview),
        candidates,
        duplicates: decodeRowMap(duplicates, "duplicates", isString),
        matchedLearnedRuleRowNumbers: decodeRowNumberSet(
            matchedLearnedRuleRowNumbers,
            "learned rows"
        ),
        ...(decodedCustomRuleState
            ? { customRuleState: decodedCustomRuleState }
            : {}),
    };
}

function isTransactionTypeOverride(
    value: unknown
): value is TransactionChannel | "" {
    return typeof value === "string";
}

export function decodeDraftState(json: Json): ImportDraftState {
    if (typeof json.accountId !== "string" || !json.accountId) {
        fail("the account is missing");
    }

    if (!IMPORT_TYPES.includes(json.importType as CsvImportType)) {
        fail("the import type is unknown");
    }

    const file = json.file;

    if (!isObject(file) || typeof file.name !== "string" || !file.name) {
        fail("the file name is missing");
    }

    if (
        json.categoryScope !== null &&
        json.categoryScope !== "PERSONAL" &&
        json.categoryScope !== "BUSINESS"
    ) {
        fail("the category scope is unknown");
    }

    if (
        json.matchedMapping !== null &&
        !isObject(json.matchedMapping)
    ) {
        fail("the saved mapping is invalid");
    }

    const overrides = json.overrides;

    if (!isObject(overrides)) {
        fail("the row edits are missing");
    }

    return {
        accountId: json.accountId,
        importType: json.importType as CsvImportType,
        file: {
            name: file.name,
            size: isFiniteNumber(file.size) ? file.size : null,
            lastModified: isFiniteNumber(file.lastModified)
                ? file.lastModified
                : null,
            fingerprint: isString(file.fingerprint)
                ? file.fingerprint
                : null,
        },
        mappingName: isString(json.mappingName) ? json.mappingName : "",
        matchedMapping: (json.matchedMapping ??
            null) as ImportMapping | null,
        overrides: {
            transactionType: decodeRowMap(
                overrides.transactionType,
                "Type edits",
                isTransactionTypeOverride
            ),
            payee: decodeRowMap(overrides.payee, "Payee edits", isString),
            notes: decodeRowMap(overrides.notes, "Notes edits", isString),
            categoryId: decodeRowMap(
                overrides.categoryId,
                "Category edits",
                isString
            ),
            direction: decodeRowMap(
                overrides.direction,
                "balance direction corrections",
                isDirection
            ),
            amount: decodeRowMap(
                overrides.amount,
                "balance amount corrections",
                isFiniteNumber
            ),
            skipped: decodeRowNumberSet(overrides.skipped, "skipped rows"),
        },
        selfLearningDisabledRows: decodeRowMap(
            json.selfLearningDisabledRows,
            "Self-Learning choices",
            isBoolean
        ),
        categoryScope: json.categoryScope as BaseFinanceScope | null,
        showAffectedRowsOnly: json.showAffectedRowsOnly === true,
    };
}

// Record (as stored) -> the exact preview + state to put back on the page.
export function parseImportDraft(
    record: ImportDraftRecord
): RestoredImportDraft {
    if (record.formatVersion !== IMPORT_DRAFT_FORMAT_VERSION) {
        throw new ImportDraftError(
            "The saved import draft was created by a different version of FinWea and can't be restored."
        );
    }

    const preview = decodeDraftPreview(
        parseJson(record.previewJson, "the preview")
    );
    const state = decodeDraftState(
        parseJson(record.stateJson, "the edits")
    );

    if (preview.candidates.length !== record.rowCount) {
        fail("the row count does not match");
    }

    return {
        id: record.id,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        preview,
        state,
    };
}

// ---------------------------------------------------------------------
// Debounced auto-save.
// ---------------------------------------------------------------------

// The storage the saver needs (ImportDraftRepository) - structural, so it
// can be tested against an in-memory fake.
export interface ImportDraftStore {
    getSummary(): Promise<ImportDraftSummary | null>;
    load(id: string): Promise<ImportDraftRecord | null>;
    saveFull(record: ImportDraftRecord): Promise<void>;
    saveState(
        id: string,
        stateJson: string,
        updatedAt: string
    ): Promise<void>;
    delete(id: string): Promise<void>;
}

export type ImportDraftSaveStatus =
    | { kind: "idle" }
    // Changes are waiting for the debounce, or being written.
    | { kind: "saving" }
    | { kind: "saved"; at: string }
    | { kind: "error"; message: string };

export interface ImportDraftAutoSaverOptions {
    // Quiet time after the last change before writing.
    debounceMs?: number;
    // Upper bound on how long continuous edits can postpone a write.
    maxWaitMs?: number;
    // Delay before retrying a failed write.
    retryMs?: number;
    now?: () => Date;
    onStatus?: (status: ImportDraftSaveStatus) => void;
    onSaved?: (summary: ImportDraftSummary) => void;
}

// Coalesces the page's state changes into at most one write per quiet
// period. Only the latest snapshot is ever written (intermediate ones are
// dropped), writes never overlap, and the large preview payload is
// serialized only when the preview object changed since the last write.
// Nothing here runs per keystroke: Payee/Notes text reaches the page's
// state only on blur (see ImportPreviewRow).
export class ImportDraftAutoSaver {
    private readonly debounceMs: number;
    private readonly maxWaitMs: number;
    private readonly retryMs: number;
    private readonly now: () => Date;

    private latest: ImportDraftSnapshot | null = null;
    private firstPendingAt: number | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private inFlight: Promise<void> | null = null;

    // What the database currently holds for the active draft, so an
    // unchanged preview is never rewritten and an unchanged state is
    // never written at all.
    private written: {
        id: string;
        preview: ImportDraftPreview;
        stateJson: string | null;
        savedAt: string;
    } | null = null;

    private statusKind: ImportDraftSaveStatus["kind"] = "idle";

    // Counters for tests/diagnostics.
    fullWrites = 0;
    stateWrites = 0;

    constructor(
        private readonly store: ImportDraftStore,
        private readonly options: ImportDraftAutoSaverOptions = {}
    ) {
        this.debounceMs = options.debounceMs ?? 800;
        this.maxWaitMs = options.maxWaitMs ?? 5000;
        this.retryMs = options.retryMs ?? 3000;
        this.now = options.now ?? (() => new Date());
    }

    schedule(snapshot: ImportDraftSnapshot): void {
        this.latest = snapshot;

        const nowMs = this.now().getTime();

        if (this.firstPendingAt === null) {
            this.firstPendingAt = nowMs;
        }

        // Once per burst of changes - not per change - so the page isn't
        // re-rendered just to show the same "Saving..." again.
        if (this.statusKind !== "saving") {
            this.emitStatus({ kind: "saving" });
        }

        const waited = nowMs - this.firstPendingAt;

        this.startTimer(
            Math.max(
                0,
                Math.min(this.debounceMs, this.maxWaitMs - waited)
            )
        );
    }

    // Writes whatever is pending right now (and waits for a write already
    // in progress). Never throws - a failure is reported via onStatus and
    // retried.
    async flush(): Promise<void> {
        this.clearTimer();

        while (this.inFlight) {
            await this.inFlight;
        }

        const snapshot = this.latest;

        if (!snapshot) {
            return;
        }

        this.latest = null;
        this.firstPendingAt = null;

        const write = this.write(snapshot);

        this.inFlight = write;

        try {
            await write;
        } finally {
            this.inFlight = null;
        }
    }

    hasUnsavedChanges(): boolean {
        return this.latest !== null || this.inFlight !== null;
    }

    // Records that the database already holds this draft exactly (it was
    // just restored from it) - so resuming never rewrites it.
    markWritten(
        id: string,
        preview: ImportDraftPreview,
        stateJson: string | null,
        savedAt: string
    ): void {
        this.written = { id, preview, stateJson, savedAt };
    }

    // Stops tracking a draft that is being deleted (import committed, or
    // discarded): drops any pending write for it and waits for one in
    // progress, so nothing re-creates it afterwards.
    async forget(id: string): Promise<void> {
        if (this.latest?.id === id) {
            this.latest = null;
            this.firstPendingAt = null;
            this.clearTimer();
        }

        while (this.inFlight) {
            await this.inFlight;
        }

        if (this.written?.id === id) {
            this.written = null;
        }
    }

    dispose(): void {
        this.clearTimer();
    }

    private emitStatus(status: ImportDraftSaveStatus): void {
        this.statusKind = status.kind;
        this.options.onStatus?.(status);
    }

    private startTimer(delay: number): void {
        this.clearTimer();
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.flush();
        }, delay);
    }

    private clearTimer(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    private async write(snapshot: ImportDraftSnapshot): Promise<void> {
        let updatedAt = this.now().toISOString();

        try {
            const stateJson = JSON.stringify(
                encodeDraftState(snapshot.state)
            );

            const previewAlreadyWritten =
                this.written?.id === snapshot.id &&
                this.written.preview === snapshot.preview;

            if (!previewAlreadyWritten) {
                await this.store.saveFull({
                    ...summarizeSnapshot(snapshot, updatedAt),
                    previewJson: JSON.stringify(
                        encodeDraftPreview(snapshot.preview)
                    ),
                    stateJson,
                });

                this.fullWrites += 1;
            } else if (this.written?.stateJson !== stateJson) {
                await this.store.saveState(
                    snapshot.id,
                    stateJson,
                    updatedAt
                );

                this.stateWrites += 1;
            } else {
                // Identical to what's stored - nothing to write.
                updatedAt = this.written?.savedAt ?? updatedAt;
            }

            this.written = {
                id: snapshot.id,
                preview: snapshot.preview,
                stateJson,
                savedAt: updatedAt,
            };

            // Newer changes arrived while writing - keep "saving".
            if (!this.latest) {
                this.emitStatus({ kind: "saved", at: updatedAt });
            }

            this.options.onSaved?.(
                summarizeSnapshot(snapshot, updatedAt)
            );
        } catch (error) {
            console.error("IMPORT DRAFT SAVE ERROR:", error);

            // Keep it for the retry unless something newer replaced it.
            if (!this.latest) {
                this.latest = snapshot;
                this.firstPendingAt = this.now().getTime();
            }

            this.emitStatus({
                kind: "error",
                message:
                    error instanceof Error ? error.message : String(error),
            });

            this.startTimer(this.retryMs);
        }
    }
}

export function summarizeSnapshot(
    snapshot: ImportDraftSnapshot,
    updatedAt: string
): ImportDraftSummary {
    return {
        id: snapshot.id,
        formatVersion: IMPORT_DRAFT_FORMAT_VERSION,
        accountId: snapshot.state.accountId,
        importType: snapshot.state.importType,
        fileName: snapshot.state.file.name,
        rowCount: snapshot.preview.candidates.length,
        createdAt: snapshot.createdAt,
        updatedAt,
    };
}

// ---------------------------------------------------------------------
// Lifecycle rules.
// ---------------------------------------------------------------------

// Starting a new preview while ANY unfinished draft exists (saved, or the
// active one still waiting for its first write) needs explicit
// confirmation - a draft is never replaced silently.
export function requiresDraftReplacementConfirmation(state: {
    storedDraft: ImportDraftSummary | null;
    activeDraftId: string | null;
    replacementConfirmed: boolean;
}): boolean {
    return (
        !state.replacementConfirmed &&
        (state.storedDraft !== null || state.activeDraftId !== null)
    );
}

// Whether an import result means the rows were committed, so the draft
// can go. FAILED writes no transaction at all (see ImportService:
// every row failed validation or insertion) - the draft stays for a retry.
export function importCommitted(status: ImportBatch["status"]): boolean {
    return status === "COMPLETED" || status === "COMPLETED_WITH_ERRORS";
}

export interface ImportWithDraftResult {
    batch: ImportBatch;
    draftCleared: boolean;
    // Set when the import committed but removing the draft failed.
    draftDeleteError: unknown;
}

// Runs the import and removes the draft ONLY after it committed. The
// draft is fully saved first (so a failure leaves it exactly current); an
// import that throws or ends FAILED leaves it untouched for a retry.
export async function runImportWithDraft(params: {
    draftId: string | null;
    saver: Pick<ImportDraftAutoSaver, "flush" | "forget">;
    store: Pick<ImportDraftStore, "delete">;
    runImport: () => Promise<ImportBatch>;
}): Promise<ImportWithDraftResult> {
    const { draftId, saver, store } = params;

    if (draftId) {
        await saver.flush();
    }

    const batch = await params.runImport();

    if (!draftId || !importCommitted(batch.status)) {
        return { batch, draftCleared: false, draftDeleteError: null };
    }

    await saver.forget(draftId);

    try {
        await store.delete(draftId);
    } catch (error) {
        console.error("IMPORT DRAFT DELETE ERROR:", error);
        return { batch, draftCleared: false, draftDeleteError: error };
    }

    return { batch, draftCleared: true, draftDeleteError: null };
}

// SHA-256 (hex) of the statement file, for recognising it later. null
// when hashing isn't available - never blocks the preview.
export async function fingerprintFile(
    file: Blob
): Promise<string | null> {
    try {
        const digest = await crypto.subtle.digest(
            "SHA-256",
            await file.arrayBuffer()
        );

        return Array.from(new Uint8Array(digest), byte =>
            byte.toString(16).padStart(2, "0")
        ).join("");
    } catch {
        return null;
    }
}
