import {
    CounterpartyRuleRepository,
    CustomImportRuleRepository,
    ImportBatchRepository,
    ImportMappingRepository,
    ImportRowRepository,
} from "../repositories";

import {
    TransactionRepository,
} from "@/modules/transactions/repositories";

import {
    TransactionService,
} from "@/modules/transactions/services";

import { AccountRepository } from "@/modules/accounts/repositories/AccountRepository";
import { CategoryContextMappingRepository } from "@/modules/categories/repositories";

import {
    processCsv,
    processExcel,
    processPdf,
    processDocumentWithMapping,
    getExcelSheetNames,
    resolveExcelWorkbookContent,
    computeHeaderSignature,
    type CsvImportType,
    type CsvPreviewResult,
    type ExcelProcessingResult,
    validateCandidates,
    reconcileBalanceChain,
    describeBalanceMismatch,
} from "@financeos/import-engine";
import {
    isRawNarrationPayee,
    learnRuleFromCorrection,
    learningKeyForCandidate,
    ruleAppliesLearnedValues,
    type LearnableValues,
} from "./learningKey";
import {
    applyCustomImportRules,
    categoryDirectionLocksFor,
    customRuleFieldsForDescription,
    normalizeRuleText,
    type CategoryDirectionLocks,
    type CustomRuleApplication,
} from "./customImportRules";

import type {
    CsvColumnMapping,
    CsvDocument,
    NormalizedTransactionCandidate,
    TransactionChannel,
} from "@financeos/import-engine";

import type {
    CreateCustomImportRuleInput,
    CustomImportRule,
    ImportBatch,
    ImportMapping,
    ImportRow,
    CreateImportBatchRequest,
    CreateImportRowRequest,
    SaveImportMappingRequest,
    UpdateImportBatchRequest,
    UpdateImportRowRequest,
} from "../types";

function createId(): string {
    return crypto.randomUUID();
}

export interface ExcelPreviewResult
    extends ExcelProcessingResult {
    duplicates: Map<number, string>;
    sheetNames: string[];
    matchedLearnedRuleRowNumbers: Set<number>;
    customRuleState?: CustomRulePreviewState;
}

// CsvPreviewResult (from @financeos/import-engine) doesn't know about
// account-scoped learning, so - exactly like ExcelPreviewResult above -
// this app-level extension attaches which rows an existing learned rule
// actually matched (see EnrichedCandidatesResult), for the Import
// Preview's Self-Learning indicator.
export interface CsvPreviewResultWithLearning
    extends CsvPreviewResult {
    matchedLearnedRuleRowNumbers: Set<number>;
    customRuleState?: CustomRulePreviewState;
}

// Custom Import Rule state carried with a preview so the page can re-apply
// rules instantly after one is created/deleted, without re-reading the
// file (see withCustomImportRules).
export interface CustomRulePreviewState {
    // The candidates after Self-Learning, BEFORE any custom rule.
    candidatesBeforeCustomRules: NormalizedTransactionCandidate[];
    // Rows an automatic self-learned rule applied to (Self-Learning's own
    // result, unchanged).
    learnedRuleRowNumbers: Set<number>;
    // rowNumber -> the custom rule(s) applied to that row.
    applications: Map<number, CustomRuleApplication>;
    // The destination account's category direction locks, resolved when
    // the preview was built, so a re-application after a rule is created
    // or edited applies the same Credit/Debit protection (see
    // applyCustomImportRules). Absent on drafts saved before it existed.
    categoryDirectionLocks?: CategoryDirectionLocks;
}

// Custom rules on top of Self-Learning: Custom Rule > Self-Learning >
// imported, per specified field (see applyCustomImportRules). A row a
// custom rule applied to counts as having a permanent learned rule
// applied (matchedLearnedRuleRowNumbers - the Self-Learning indicator's
// GREEN), alongside the automatically learned ones.
export function withCustomImportRules(
    learned: EnrichedCandidatesResult,
    rules: readonly CustomImportRule[],
    categoryDirectionLocks?: CategoryDirectionLocks
): {
    candidates: NormalizedTransactionCandidate[];
    matchedRowNumbers: Set<number>;
    customRuleState: CustomRulePreviewState;
} {
    const applied = applyCustomImportRules(
        learned.candidates,
        rules,
        categoryDirectionLocks
    );

    const matchedRowNumbers = new Set(learned.matchedRowNumbers);

    for (const rowNumber of applied.applications.keys()) {
        matchedRowNumbers.add(rowNumber);
    }

    return {
        candidates: applied.candidates,
        matchedRowNumbers,
        customRuleState: {
            candidatesBeforeCustomRules: learned.candidates,
            learnedRuleRowNumbers: learned.matchedRowNumbers,
            applications: applied.applications,
            ...(categoryDirectionLocks
                ? { categoryDirectionLocks }
                : {}),
        },
    };
}

// A single account-scoped learned association: Payee, Transaction Type,
// and Notes together for one narration pattern. `type`/`notes` are
// nullable ("not learned yet" - see migration 028) - a raw string here
// (not the import-engine TransactionChannel type) since this is the
// untyped DB shape; narrowed back to TransactionChannel where it's
// applied to a candidate below.
export interface LearnedTransactionPatternRule {
    counterparty: string;
    type: string | null;
    notes: string | null;
    // Learned Category id (migration 039); absent/null = none learned.
    categoryId?: string | null;
}

// The account-scoped "pattern -> learned values" store this reuses (see
// CounterpartyRuleRepository) - the underlying table/columns are still
// named after Counterparty (that migration has already shipped and can
// never be renamed), but this is the app's one and only account-scoped
// narration-pattern learning store, and it now carries the confirmed
// Payee, Transaction Type, and Notes for a pattern together. Kept as a
// small structural interface (rather than importing the concrete
// repository type) so this logic can be unit-tested against a fake
// store, with no database.
export interface TransactionPatternRuleStore {
    findByAccountAndPattern(
        accountId: string,
        pattern: string
    ): Promise<LearnedTransactionPatternRule | null>;

    upsert(
        accountId: string,
        pattern: string,
        payee: string,
        type: string | null,
        notes: string | null,
        categoryId?: string | null
    ): Promise<unknown>;
}

// A row's learning key: normalized Description pattern + Credit/Debit
// direction - see learningKeyForCandidate (shared with the Import
// Preview's in-session propagation, so both always agree).
const learningPatternForCandidate = learningKeyForCandidate;

export interface ImportCandidatesOptions {
    // Rows the user chose to leave out of this import (Import Preview
    // "Skip row"). They are removed before anything is written.
    skippedRowNumbers?: ReadonlySet<number>;
    // PDF statements: refuse the import while any row still disagrees
    // with the statement's running balance (see reconcileBalanceChain).
    // The check runs on the FULL candidate list - a skipped row's printed
    // balance is still the next row's previous balance - and a skipped
    // row counts as resolved.
    requireBalanceReconciliation?: boolean;
}

export class BalanceMismatchImportError extends Error {
    constructor(readonly rowNumbers: number[], firstMessage: string) {
        super(
            `${rowNumbers.length} row${
                rowNumbers.length === 1 ? " does" : "s do"
            } not match the statement's running balance (row ${rowNumbers.join(", ")}). ${firstMessage}`
        );
        this.name = "BalanceMismatchImportError";
    }
}

// A row's values as the Import Preview showed them before any user edit
// (already enriched by an existing learned rule) - what
// learnRuleFromCandidate compares the final values against to decide
// whether the row was genuinely corrected.
export type LearningBaseline = Pick<
    NormalizedTransactionCandidate,
    "payee" | "transactionType" | "notes" | "categoryId"
>;

export interface EnrichedCandidatesResult {
    candidates: NormalizedTransactionCandidate[];
    // rowNumbers of every candidate for which an existing learned rule was
    // actually found (see TransactionPatternRuleStore.findByAccountAndPattern)
    // and applied below - the single source of truth for "does a
    // self-learned rule match this row", reused as-is by the Import
    // Preview's Self-Learning indicator (never recomputed separately).
    matchedRowNumbers: Set<number>;
}

// Populates each candidate's Payee, Transaction Type, and Notes from a
// previously-learned "account + transaction-pattern -> ..." association
// (see learningKeyForCandidate), scoped to the destination account so
// a rule learned for one account never leaks into a different account.
// Unlike a first-time suggestion, a matching rule's Payee/Type always
// win over the raw parsed/detected value, since the rule represents a
// user-confirmed correction that should keep applying on every future
// import. A field the rule hasn't learned yet (null) leaves that field
// exactly as it was - so Type falls back to whatever the existing
// DR/CR-independent channel detection already produced, and Notes stays
// blank, until the rule actually learns one.
export async function enrichCandidatesWithLearnedRulesDetailed(
    accountId: string,
    candidates: NormalizedTransactionCandidate[],
    rules: TransactionPatternRuleStore
): Promise<EnrichedCandidatesResult> {
    const enriched: NormalizedTransactionCandidate[] =
        [];

    const matchedRowNumbers =
        new Set<number>();

    for (
        const candidate of candidates
    ) {
        const pattern =
            learningPatternForCandidate(candidate);

        if (!pattern) {
            enriched.push(candidate);
            continue;
        }

        const rule =
            await rules.findByAccountAndPattern(
                accountId,
                pattern
            );

        if (!rule) {
            enriched.push(candidate);
            continue;
        }

        // Only a rule that actually applies a learned value to this row
        // (a real Payee, Notes, a Category, or a Type different from the
        // row's detected one - see ruleAppliesLearnedValues) counts as
        // "an existing learned rule" for the Self-Learning indicator. A
        // rule Payee that is only a narration of this kind (e.g. a
        // sibling row's narration with a different reference number) is
        // never applied - the row keeps its own narration.
        if (
            ruleAppliesLearnedValues(
                {
                    payee: rule.counterparty,
                    transactionType: rule.type,
                    notes: rule.notes,
                    categoryId: rule.categoryId,
                },
                candidate
            )
        ) {
            matchedRowNumbers.add(
                candidate.rowNumber
            );
        }

        enriched.push({
            ...candidate,
            payee: isRawNarrationPayee(
                rule.counterparty,
                candidate.description
            )
                ? candidate.payee
                : rule.counterparty,
            transactionType:
                (rule.type as TransactionChannel | null) ??
                candidate.transactionType,
            notes:
                rule.notes ??
                candidate.notes,
            categoryId:
                rule.categoryId ??
                candidate.categoryId ??
                null,
        });
    }

    return { candidates: enriched, matchedRowNumbers };
}

// Re-applies the account's (updated) custom rules to an open preview -
// from the Self-Learning-only candidates it carries, so a newly created
// rule applies immediately and a deleted rule's values disappear, without
// re-reading the file. Per-row overrides live separately in the page and
// still win. A preview without custom-rule state is returned unchanged.
export function reapplyCustomImportRules<
    T extends {
        candidates: NormalizedTransactionCandidate[];
        matchedLearnedRuleRowNumbers: Set<number>;
        customRuleState?: CustomRulePreviewState;
    },
>(preview: T, rules: readonly CustomImportRule[]): T {
    const state = preview.customRuleState;

    if (!state) {
        return preview;
    }

    const next = withCustomImportRules(
        {
            candidates: state.candidatesBeforeCustomRules,
            matchedRowNumbers: state.learnedRuleRowNumbers,
        },
        rules,
        state.categoryDirectionLocks
    );

    return {
        ...preview,
        candidates: next.candidates,
        matchedLearnedRuleRowNumbers: next.matchedRowNumbers,
        customRuleState: next.customRuleState,
    };
}

// reapplyCustomImportRules, but returns the very same preview when the
// current rules produce exactly what it already shows - e.g. a resumed
// draft whose rules weren't edited meanwhile, so nothing is re-saved.
export function reapplyCustomImportRulesIfChanged<
    T extends {
        candidates: NormalizedTransactionCandidate[];
        matchedLearnedRuleRowNumbers: Set<number>;
        customRuleState?: CustomRulePreviewState;
    },
>(preview: T, rules: readonly CustomImportRule[]): T {
    const next = reapplyCustomImportRules(preview, rules);

    if (next === preview || !preview.customRuleState || !next.customRuleState) {
        return next;
    }

    const sameCandidates =
        next.candidates.length === preview.candidates.length &&
        next.candidates.every((candidate, index) => {
            const current = preview.candidates[index]!;

            return (
                candidate === current ||
                (candidate.rowNumber === current.rowNumber &&
                    candidate.payee === current.payee &&
                    candidate.notes === current.notes &&
                    (candidate.categoryId ?? null) ===
                        (current.categoryId ?? null) &&
                    (candidate.transactionType ?? null) ===
                        (current.transactionType ?? null))
            );
        });

    const sameRowNumbers =
        next.matchedLearnedRuleRowNumbers.size ===
            preview.matchedLearnedRuleRowNumbers.size &&
        [...next.matchedLearnedRuleRowNumbers].every(rowNumber =>
            preview.matchedLearnedRuleRowNumbers.has(rowNumber)
        );

    const before = preview.customRuleState.applications;
    const after = next.customRuleState.applications;
    const sameApplications =
        before.size === after.size &&
        [...after].every(
            ([rowNumber, application]) =>
                JSON.stringify(before.get(rowNumber)) ===
                JSON.stringify(application)
        );

    return sameCandidates && sameRowNumbers && sameApplications
        ? preview
        : next;
}

// Thin, backward-compatible wrapper over enrichCandidatesWithLearnedRulesDetailed
// for callers that only need the enriched candidates themselves.
export async function enrichCandidatesWithLearnedRules(
    accountId: string,
    candidates: NormalizedTransactionCandidate[],
    rules: TransactionPatternRuleStore
): Promise<NormalizedTransactionCandidate[]> {
    const result =
        await enrichCandidatesWithLearnedRulesDetailed(
            accountId,
            candidates,
            rules
        );

    return result.candidates;
}

// Learns (or refreshes) an "account + pattern -> Payee/Type/Notes/Category"
// association from a single candidate - but ONLY when its final values
// are a genuine correction (see learnRuleFromCorrection). `baseline` is
// the row as the preview showed it before any user edit (already
// enriched by an existing rule); without one, the existing rule (or the
// untouched narration) is the baseline. A row nobody corrected never
// creates or updates a rule, and a raw-narration Payee never overwrites
// a learned one. No-ops when the narration is too short/generic to
// learn from (see learningKeyForCandidate).
export async function learnRuleFromCandidate(
    accountId: string,
    candidate: NormalizedTransactionCandidate,
    rules: TransactionPatternRuleStore,
    baseline?: LearningBaseline,
    // Fields a Custom Import Rule owns for this row - never learned (see
    // learnRuleFromCorrection).
    customRuleFields?: ReadonlySet<keyof LearnableValues>
): Promise<void> {
    const pattern =
        learningPatternForCandidate(candidate);

    if (!pattern) {
        return;
    }

    await learnRuleFromCorrection(
        rules,
        accountId,
        pattern,
        candidate,
        baseline,
        customRuleFields
    );
}

// Validates and normalizes a custom rule's fields (create and edit):
// keyword whitespace collapsed, blank values stored as null, and at
// least one field to set.
function cleanCustomRuleInput(
    input: CreateCustomImportRuleInput
): Omit<CustomImportRule, "id" | "createdAt" | "updatedAt"> {
    const clean = (value: string | null | undefined) =>
        value?.trim() ? value.trim() : null;

    const keyword = input.keyword.trim().replace(/\s+/g, " ");

    if (!input.accountId) {
        throw new Error("Select an account before adding a custom rule.");
    }

    if (!normalizeRuleText(keyword)) {
        throw new Error("Enter a keyword for the custom rule.");
    }

    const payee = clean(input.payee);
    const notes = clean(input.notes);
    const categoryId = clean(input.categoryId);
    const transactionType = clean(input.transactionType);

    if (!payee && !notes && !categoryId && !transactionType) {
        throw new Error(
            "Set at least one of Payee, Notes, Category or Type."
        );
    }

    return {
        accountId: input.accountId,
        keyword,
        payee,
        notes,
        categoryId,
        transactionType,
    };
}

export class ImportService {
    private readonly batchRepository =
        new ImportBatchRepository();

    private readonly rowRepository =
        new ImportRowRepository();

    private readonly mappingRepository =
        new ImportMappingRepository();

    private readonly counterpartyRuleRepository =
        new CounterpartyRuleRepository();

    private readonly customRuleRepository =
        new CustomImportRuleRepository();

    private readonly transactionRepository =
        new TransactionRepository();

    private readonly transactionService =
        new TransactionService();

    // Only for the destination account's category direction locks - see
    // loadCategoryDirectionLocks.
    private readonly accountRepository =
        new AccountRepository();

    private readonly categoryContextMappingRepository =
        new CategoryContextMappingRepository();

    async getBatches(): Promise<ImportBatch[]> {
        return await this.batchRepository.getAll();
    }

    async getBatch(
        id: string
    ): Promise<ImportBatch | null> {
        return await this.batchRepository.getById(id);
    }

    async getRows(
        batchId: string
    ): Promise<ImportRow[]> {
        return await this.rowRepository.getByBatchId(
            batchId
        );
    }

    async createBatch(
        request: CreateImportBatchRequest
    ): Promise<ImportBatch> {
        const now =
            new Date().toISOString();

        const batch: ImportBatch = {
            id: createId(),
            accountId:
                request.accountId ?? null,
            importType:
                request.importType,
            sourceFileName:
                request.sourceFileName,
            status: "PENDING",
            totalRows:
                request.totalRows ?? 0,
            importedRows: 0,
            duplicateRows: 0,
            failedRows: 0,
            createdAt: now,
            updatedAt: now,
        };

        await this.batchRepository.create(batch);

        return batch;
    }

    async addRow(
        request: CreateImportRowRequest
    ): Promise<ImportRow> {
        const row: ImportRow = {
            id: createId(),
            importBatchId:
                request.importBatchId,
            rowNumber:
                request.rowNumber,
            rawData:
                request.rawData,
            normalizedData:
                request.normalizedData ?? null,
            transactionId: null,
            status: "PENDING",
            errorMessage: null,
            createdAt:
                new Date().toISOString(),
        };

        await this.rowRepository.create(row);

        return row;
    }

    // Looks for a previously confirmed mapping whose source column
    // structure (not just its detected institution) exactly matches this
    // file's headers, so it can be reused automatically. Returns null
    // when nothing matches - callers should fall back to the automatic
    // column detection in that case.
    async findMatchingMapping(
        headers: string[],
        importType: CsvImportType
    ): Promise<ImportMapping | null> {
        const headerSignature =
            computeHeaderSignature(
                headers,
                importType
            );

        return await this.mappingRepository.findBySignature(
            headerSignature
        );
    }

    // Persists (or refreshes) the mapping the user confirmed for this
    // file's header structure, so future imports of the same statement
    // format can reuse it automatically.
    async saveMapping(
        params: {
            name: string;
            institutionName: string | null;
            headers: string[];
            mapping: CsvColumnMapping;
            importType: CsvImportType;
        }
    ): Promise<ImportMapping> {
        const request: SaveImportMappingRequest = {
            name: params.name,
            institutionName:
                params.institutionName,
            importType: params.importType,
            headerSignature:
                computeHeaderSignature(
                    params.headers,
                    params.importType
                ),
            headers: params.headers,
            mapping: params.mapping,
        };

        return await this.mappingRepository.upsert(
            request
        );
    }

    // Every Saved Mapping, for the Saved Mappings management list (see
    // ImportsPage.tsx).
    async listMappings(): Promise<ImportMapping[]> {
        return await this.mappingRepository.getAll();
    }

    // Renames a Saved Mapping without touching its column mapping/rules,
    // then keeps every already-imported transaction created from it in
    // sync: source_statement (Transaction.sourceStatement, i.e. the
    // Transactions page's "Mapping Name") is free text stamped at import
    // time (see executeCandidates below), not a foreign key to
    // import_mappings - so renaming the mapping alone would silently
    // orphan already-imported transactions from their (renamed) mapping
    // name unless those rows are updated here too.
    async renameMapping(
        id: string,
        name: string
    ): Promise<ImportMapping> {
        const trimmedName = name.trim();

        if (!trimmedName) {
            throw new Error(
                "Mapping name cannot be empty."
            );
        }

        const existing =
            await this.mappingRepository.findById(id);

        if (!existing) {
            throw new Error(
                "Import mapping not found."
            );
        }

        const renamed =
            await this.mappingRepository.rename(
                id,
                trimmedName
            );

        if (existing.name !== trimmedName) {
            await this.transactionRepository.renameSourceStatement(
                existing.name,
                trimmedName
            );
        }

        return renamed;
    }

    async previewCsv(
        accountId: string,
        content: string,
        importType: CsvImportType = "BANK_CSV"
    ): Promise<CsvPreviewResultWithLearning> {
        const result =
            processCsv(
                content,
                importType
            );

        if (
            result.document.headers.length === 0
        ) {
            throw new Error(
                "CSV file contains no headers."
            );
        }

        if (
            result.document.rows.length === 0
        ) {
            throw new Error(
                "CSV file contains no transaction rows."
            );
        }

        const {
            candidates,
            matchedRowNumbers: matchedLearnedRuleRowNumbers,
            customRuleState,
        } =
            await this.enrichLearnedRules(
                accountId,
                result.candidates
            );

        const duplicates =
            await this.findDuplicates(
                accountId,
                candidates
            );

        return {
            ...result,
            candidates,
            duplicates,
            matchedLearnedRuleRowNumbers,
            customRuleState,
        };
    }

    // Re-normalizes an already-parsed document against a user-edited
    // column mapping (from the "Detected Mapping" UI) without re-reading
    // or re-parsing the source file.
    async previewWithMapping(
        accountId: string,
        document: CsvDocument,
        mapping: CsvColumnMapping,
        importType: CsvImportType = "BANK_CSV"
    ): Promise<CsvPreviewResultWithLearning> {
        const result =
            processDocumentWithMapping(
                document,
                mapping,
                importType
            );

        const {
            candidates,
            matchedRowNumbers: matchedLearnedRuleRowNumbers,
            customRuleState,
        } =
            await this.enrichLearnedRules(
                accountId,
                result.candidates
            );

        const duplicates =
            await this.findDuplicates(
                accountId,
                candidates
            );

        return {
            ...result,
            candidates,
            duplicates,
            matchedLearnedRuleRowNumbers,
            customRuleState,
        };
    }

    async previewExcel(
        accountId: string,
        content: ArrayBuffer,
        sheetName?: string,
        importType: CsvImportType = "BANK_CSV",
        // Memory-only for this call - never stored on the batch/row/
        // preview result, never logged (see ExcelPasswordError in
        // @financeos/import-engine for how a protected file surfaces
        // here instead of a normal parse result).
        password?: string
    ): Promise<ExcelPreviewResult> {
        // Agile-Encryption-protected .xlsx (the common, modern "Encrypt
        // with Password" case) is decrypted for real here, up front -
        // everything below then runs completely unchanged against the
        // resulting plain workbook bytes, exactly as for a file that
        // was never protected. Any other file (unprotected, legacy
        // XOR/RC4 .xls, Standard Encryption, corrupt) passes through
        // untouched, deferring to processExcel/getExcelSheetNames's own
        // existing password handling below.
        const resolvedContent =
            await resolveExcelWorkbookContent(
                content,
                password
            );

        const result =
            processExcel(
                resolvedContent,
                sheetName,
                importType,
                password
            );

        if (
            result.document.headers.length === 0
        ) {
            throw new Error(
                "Excel sheet contains no headers."
            );
        }

        if (
            result.document.rows.length === 0
        ) {
            throw new Error(
                "Excel sheet contains no transaction rows."
            );
        }

        const {
            candidates,
            matchedRowNumbers: matchedLearnedRuleRowNumbers,
            customRuleState,
        } =
            await this.enrichLearnedRules(
                accountId,
                result.candidates
            );

        const duplicates =
            await this.findDuplicates(
                accountId,
                candidates
            );

        return {
            ...result,
            candidates,
            duplicates,
            matchedLearnedRuleRowNumbers,
            customRuleState,
            sheetNames:
                getExcelSheetNames(
                    resolvedContent,
                    password
                ),
        };
    }

    async previewPdf(
        accountId: string,
        content: ArrayBuffer,
        importType: CsvImportType = "BANK_CSV"
    ): Promise<CsvPreviewResultWithLearning> {
        const result =
            await processPdf(
                content,
                importType
            );

        if (
            result.document.rows.length === 0
        ) {
            throw new Error(
                "PDF contains no recognizable transaction rows."
            );
        }

        const {
            candidates,
            matchedRowNumbers: matchedLearnedRuleRowNumbers,
            customRuleState,
        } =
            await this.enrichLearnedRules(
                accountId,
                result.candidates
            );

        return {
            ...result,
            candidates,
            duplicates:
                await this.findDuplicates(
                    accountId,
                    candidates
                ),
            matchedLearnedRuleRowNumbers,
            customRuleState,
        };
    }
    // Executes the import using an already-previewed document + the
    // confirmed mapping (auto-detected, saved-and-reused, or manually
    // edited) - the same mapping shown in the preview - instead of
    // re-parsing the source file and re-running auto-detection from
    // scratch. This is what "Confirm & Import" uses, so what gets
    // imported always matches what was previewed and approved.
    async importWithMapping(
        accountId: string,
        sourceFileName: string,
        document: CsvDocument,
        mapping: CsvColumnMapping,
        importType: CsvImportType = "BANK_CSV",
        mappingName?: string | null,
        selfLearningDisabledRowNumbers?: ReadonlySet<number>
    ): Promise<ImportBatch> {
        const result =
            processDocumentWithMapping(
                document,
                mapping,
                importType
            );

        return await this.importCandidates(
            accountId,
            sourceFileName,
            importType,
            result.candidates,
            mappingName,
            selfLearningDisabledRowNumbers
        );
    }

    // Executes the import from a final candidate list - e.g. the preview's
    // candidates with per-row edits already applied (like a manually
    // overridden Transaction Type) - without re-normalizing from the
    // document/mapping. Used so a per-row override in the preview table is
    // guaranteed to be what actually gets imported.
    async importCandidates(
        accountId: string,
        sourceFileName: string,
        importType: CsvImportType,
        candidates: NormalizedTransactionCandidate[],
        mappingName?: string | null,
        selfLearningDisabledRowNumbers?: ReadonlySet<number>,
        learningBaselines?: ReadonlyMap<number, LearningBaseline>,
        options: ImportCandidatesOptions = {}
    ): Promise<ImportBatch> {
        const skipped =
            options.skippedRowNumbers ?? new Set<number>();

        if (options.requireBalanceReconciliation) {
            const unresolved =
                reconcileBalanceChain(candidates).mismatches.filter(
                    mismatch => !skipped.has(mismatch.rowNumber)
                );

            if (unresolved.length > 0) {
                // Nothing is written - no batch, no rows.
                throw new BalanceMismatchImportError(
                    unresolved.map(mismatch => mismatch.rowNumber),
                    describeBalanceMismatch(unresolved[0]!)
                );
            }
        }

        if (skipped.size > 0) {
            candidates = candidates.filter(
                candidate => !skipped.has(candidate.rowNumber)
            );
        }

        const validation =
            validateCandidates(candidates);

        if (
            validation.errors.length > 0
        ) {
            return await this.createFailedBatch(
                accountId,
                sourceFileName,
                importType,
                candidates
            );
        }

        const batch =
            await this.createBatch({
                accountId,
                importType,
                sourceFileName,
                totalRows:
                    candidates.length,
            });

        return await this.executeCandidates(
            batch.id,
            candidates,
            mappingName,
            selfLearningDisabledRowNumbers,
            learningBaselines
        );
    }

    private async findDuplicates(
        accountId: string,
        candidates: NormalizedTransactionCandidate[]
    ): Promise<Map<number, string>> {
        const duplicates =
            new Map<number, string>();

        const validation =
            validateCandidates(candidates);

        if (!validation.valid) {
            return duplicates;
        }

        for (
            const candidate of candidates
        ) {
            if (
                !candidate.transactionDate ||
                !candidate.type ||
                candidate.amount === null
            ) {
                continue;
            }

            const duplicate =
                await this.transactionService.findDuplicate(
                    accountId,
                    candidate.transactionDate,
                    candidate.type,
                    candidate.amount,
                    candidate.referenceNumber,
                    candidate.payee,
                    candidate.description
                );

            if (duplicate) {
                duplicates.set(
                    candidate.rowNumber,
                    duplicate.id
                );
            }
        }

        return duplicates;
    }

    // Self-Learning first, then the account's Custom Import Rules on top
    // (see withCustomImportRules).
    private async enrichLearnedRules(
        accountId: string,
        candidates: NormalizedTransactionCandidate[]
    ): Promise<
        EnrichedCandidatesResult & {
            customRuleState: CustomRulePreviewState;
        }
    > {
        const learned =
            await enrichCandidatesWithLearnedRulesDetailed(
                accountId,
                candidates,
                this.counterpartyRuleRepository
            );

        return withCustomImportRules(
            learned,
            await this.loadCustomRules(accountId),
            await this.loadCategoryDirectionLocks(accountId)
        );
    }

    // The account's category direction locks, so a custom rule never
    // applies a category the row's Credit/Debit direction can't be saved
    // with. Like loadCustomRules, a read failure is logged and treated as
    // "no locks" rather than blocking the preview.
    private async loadCategoryDirectionLocks(
        accountId: string
    ): Promise<CategoryDirectionLocks> {
        try {
            const [account, mappings] = await Promise.all([
                this.accountRepository.getById(accountId),
                this.categoryContextMappingRepository.getAll(),
            ]);

            return categoryDirectionLocksFor(
                mappings,
                account
                    ? {
                          id: account.id,
                          businessEntityId:
                              account.businessEntityId ?? null,
                      }
                    : null
            );
        } catch (error) {
            console.error(
                "Failed to load category mappings for custom rules:",
                error
            );

            return {};
        }
    }

    // Custom rules are a layer on top of the import; a failure to read
    // them is logged and treated as "no custom rules" rather than
    // blocking the preview or the import itself.
    private async loadCustomRules(
        accountId: string
    ): Promise<CustomImportRule[]> {
        try {
            return await this.customRuleRepository.listByAccount(
                accountId
            );
        } catch (error) {
            console.error("Failed to load custom import rules:", error);
            return [];
        }
    }

    // -----------------------------------------------------------------
    // Custom Import Rules (user-defined, permanent, per account).
    // Creating or deleting a rule never touches any transaction or any
    // automatic self-learned rule.
    // -----------------------------------------------------------------

    async listCustomRules(
        accountId: string
    ): Promise<CustomImportRule[]> {
        return await this.customRuleRepository.listByAccount(accountId);
    }

    // Every account's rules, newest first (Import Rules page).
    async listAllCustomRules(): Promise<CustomImportRule[]> {
        return await this.customRuleRepository.listAll();
    }

    async createCustomRule(
        input: CreateCustomImportRuleInput
    ): Promise<CustomImportRule> {
        return await this.customRuleRepository.create({
            id: crypto.randomUUID(),
            ...cleanCustomRuleInput(input),
        });
    }

    // Updates the existing rule (never creates a second one). Like
    // create/delete, it touches no transaction and no self-learned rule.
    async updateCustomRule(
        id: string,
        input: CreateCustomImportRuleInput
    ): Promise<CustomImportRule> {
        return await this.customRuleRepository.update({
            id,
            ...cleanCustomRuleInput(input),
        });
    }

    async deleteCustomRule(id: string): Promise<void> {
        await this.customRuleRepository.delete(id);
    }

    private async createFailedBatch(
        accountId: string,
        sourceFileName: string,
        importType: CsvImportType,
        candidates: NormalizedTransactionCandidate[]
    ): Promise<ImportBatch> {
        const batch =
            await this.createBatch({
                accountId,
                importType,
                sourceFileName,
                totalRows:
                    candidates.length,
            });

        await this.updateBatch({
            id: batch.id,
            status: "PROCESSING",
            totalRows:
                candidates.length,
        });

        const validation =
            validateCandidates(candidates);

        const failedRows =
            new Set<number>();

        for (
            const candidate of candidates
        ) {
            const errors =
                validation.errors.filter(
                    error =>
                        error.rowNumber ===
                        candidate.rowNumber
                );

            const row =
                await this.addRow({
                    importBatchId:
                        batch.id,
                    rowNumber:
                        candidate.rowNumber,
                    rawData:
                        candidate.rawData,
                    normalizedData:
                        candidate as unknown as Record<string, unknown>,
                });

            if (errors.length > 0) {
                failedRows.add(
                    candidate.rowNumber
                );

                await this.updateRow({
                    id: row.id,
                    status: "FAILED",
                    errorMessage:
                        errors
                            .map(
                                error =>
                                    error.message
                            )
                            .join(" "),
                });
            }
        }

        await this.updateBatch({
            id: batch.id,
            status:
                failedRows.size ===
                candidates.length
                    ? "FAILED"
                    : "COMPLETED_WITH_ERRORS",
            totalRows:
                candidates.length,
            importedRows: 0,
            duplicateRows: 0,
            failedRows:
                failedRows.size,
        });

        return (
            (await this.getBatch(batch.id)) ??
            batch
        );
    }

    async executeCandidates(
        batchId: string,
        candidates: NormalizedTransactionCandidate[],
        mappingName?: string | null,
        selfLearningDisabledRowNumbers?: ReadonlySet<number>,
        learningBaselines?: ReadonlyMap<number, LearningBaseline>
    ): Promise<ImportBatch> {
        const batch =
            await this.getBatch(batchId);

        if (!batch) {
            throw new Error(
                "Import batch not found."
            );
        }

        if (!batch.accountId) {
            throw new Error(
                "An account is required to import transactions."
            );
        }

        await this.updateBatch({
            id: batch.id,
            status: "PROCESSING",
            totalRows: candidates.length,
            importedRows: 0,
            duplicateRows: 0,
            failedRows: 0,
        });

        const validation =
            validateCandidates(candidates);

        let importedRows = 0;
        let duplicateRows = 0;
        let failedRows = 0;

        const existingRows =
            await this.getRows(batch.id);

        // Fields a Custom Import Rule owns on a row are never learned by
        // automatic Self-Learning (see learnRuleFromCorrection).
        const customRules =
            await this.loadCustomRules(batch.accountId);

        // Every transaction this run has created. Duplicate detection
        // must only compare a row with transactions that existed BEFORE
        // this import started - a statement can legitimately contain
        // several rows identical in date/amount/direction/narration/
        // reference (repeated transfers, reversal + re-send, cut-off
        // references), and an earlier row of THIS import must never
        // make a later one a "duplicate". Re-importing an already-
        // imported statement is still caught, since those transactions
        // pre-date this run and are never in this set.
        const createdInThisImport =
            new Set<string>();

        for (
            const candidate of candidates
        ) {
            let row =
                existingRows.find(
                    item =>
                        item.rowNumber ===
                        candidate.rowNumber
                );

            if (!row) {
                row =
                    await this.addRow({
                        importBatchId:
                            batch.id,
                        rowNumber:
                            candidate.rowNumber,
                        rawData:
                            candidate.rawData,
                        normalizedData:
                            candidate as unknown as Record<string, unknown>,
                    });
            } else {
                await this.updateRow({
                    id: row.id,
                    normalizedData:
                        candidate as unknown as Record<string, unknown>,
                });
            }

            const candidateErrors =
                validation.errors.filter(
                    error =>
                        error.rowNumber ===
                        candidate.rowNumber
                );

            if (
                candidateErrors.length > 0
            ) {
                await this.updateRow({
                    id: row.id,
                    status: "FAILED",
                    errorMessage:
                        candidateErrors
                            .map(
                                error =>
                                    error.message
                            )
                            .join(" "),
                });

                failedRows += 1;
                continue;
            }

            // Learn from this row's final Payee/Type/Notes/Category -
            // but only if they are a genuine correction of the row as
            // previewed (`learningBaselines`, see
            // learnRuleFromCandidate) - regardless of whether it turns
            // out to be a duplicate. A
            // failure here (e.g. a transient DB error) is logged and
            // skipped, never allowed to abort this row's import - let
            // alone the rest of the batch - since learning is a
            // best-effort convenience for future imports, not a
            // requirement for this one to succeed.
            //
            // Skipped entirely when this row's per-row Self-Learning
            // toggle is off (see ImportsPage's toggleSelfLearningRow) -
            // that only opts THIS row out of writing a new/refreshed
            // association for THIS import; it never deletes or disables
            // whatever rule may already exist for the pattern, and never
            // affects any other row.
            const selfLearningEnabledForRow =
                !selfLearningDisabledRowNumbers?.has(
                    candidate.rowNumber
                );

            try {
                if (selfLearningEnabledForRow) {
                    await learnRuleFromCandidate(
                        batch.accountId,
                        candidate,
                        this.counterpartyRuleRepository,
                        learningBaselines?.get(
                            candidate.rowNumber
                        ),
                        customRules.length > 0
                            ? customRuleFieldsForDescription(
                                  candidate.description,
                                  customRules
                              )
                            : undefined
                    );
                }
            } catch (learnError) {
                console.error(
                    "Failed to learn transaction pattern rule:",
                    learnError
                );
            }

            try {
                const duplicate =
                    await this.transactionRepository.findDuplicate(
                        batch.accountId,
                        candidate.transactionDate!,
                        candidate.type!,
                        candidate.amount!,
                        candidate.referenceNumber,
                        candidate.payee,
                        candidate.description,
                        createdInThisImport
                    );

                if (duplicate) {
                    await this.updateRow({
                        id: row.id,
                        transactionId:
                            duplicate.id,
                        status: "DUPLICATE",
                        errorMessage:
                            "Matching transaction already exists.",
                    });

                    duplicateRows += 1;
                    continue;
                }

                const transactionId =
                    await this.transactionService.create({
                        accountId:
                            batch.accountId,
                        // The Category chosen (or learned) in the Import
                        // Preview - null for Uncategorized. The existing
                        // transaction/category relationship and
                        // TransactionService's Income/Expense mapping
                        // check apply exactly as for a manual entry.
                        categoryId:
                            candidate.categoryId ?? null,
                        payee:
                            candidate.payee ||
                            candidate.description,
                        branch:
                            candidate.branch ??
                            null,
                        type:
                            candidate.type!,
                        amount:
                            candidate.amount!,
                        transactionDate:
                            candidate.transactionDate!,
                        referenceNumber:
                            candidate.referenceNumber ??
                            undefined,
                        // The source statement's own Transaction ID, from
                        // an explicit "Transaction ID" mapping only - never
                        // used for duplicate matching (see
                        // TransactionRepository.findDuplicate, which never
                        // references this column).
                        externalTransactionId:
                            candidate.externalTransactionId ??
                            undefined,
                        // The raw source narration (used for duplicate
                        // matching) - kept separate from `notes`, which is
                        // an independent, user-editable annotation.
                        originalNarration:
                            candidate.description ||
                            undefined,
                        notes:
                            candidate.notes ||
                            undefined,
                        transactionType:
                            candidate.transactionType ??
                            null,
                        // The Mapping Name this statement was imported
                        // with (see ImportsPage's "Mapping Name" field) -
                        // reuses the existing, previously-unset
                        // sourceStatement column so transactions can later
                        // be filtered by the mapping that produced them.
                        // Never set for manually-added transactions (see
                        // TransactionService.create/AddTransactionDialog).
                        sourceStatement:
                            mappingName ??
                            undefined,
                    });

                createdInThisImport.add(transactionId);

                await this.updateRow({
                    id: row.id,
                    transactionId,
                    status: "IMPORTED",
                    errorMessage: null,
                });

                importedRows += 1;
            } catch (error) {
                await this.updateRow({
                    id: row.id,
                    status: "FAILED",
                    errorMessage:
                        error instanceof Error
                            ? error.message
                            : "Failed to import transaction.",
                });

                failedRows += 1;
            }
        }

        const status =
            failedRows === 0
                ? "COMPLETED"
                : importedRows > 0 ||
                    duplicateRows > 0
                  ? "COMPLETED_WITH_ERRORS"
                  : "FAILED";

        await this.updateBatch({
            id: batch.id,
            status,
            totalRows:
                candidates.length,
            importedRows,
            duplicateRows,
            failedRows,
        });

        return (
            (await this.getBatch(batch.id)) ?? {
                ...batch,
                status,
                totalRows:
                    candidates.length,
                importedRows,
                duplicateRows,
                failedRows,
            }
        );
    }

    async updateBatch(
        request: UpdateImportBatchRequest
    ): Promise<void> {
        await this.batchRepository.update(
            request
        );
    }

    async updateRow(
        request: UpdateImportRowRequest
    ): Promise<void> {
        await this.rowRepository.update(
            request
        );
    }

    // Permanently deletes every persisted self-learned rule (across every
    // account) - the Import Preview's "clear all self-learned rules"
    // header action. Reuses the existing account-scoped learning store
    // (see enrichCandidatesWithLearnedRulesDetailed / learnRuleFromCandidate
    // above) as-is; this only clears it, it never changes how matching or
    // learning itself works.
    async clearAllLearnedRules(): Promise<void> {
        await this.counterpartyRuleRepository.deleteAll();
    }

    // Removes one Import History record from the list - its
    // import_batches row and its import_rows - so an obsolete/no-longer-
    // useful entry (e.g. one whose transactions were separately deleted)
    // doesn't linger in the list forever. Deliberately never touches
    // `transactions`: an import_row's transaction_id is only a
    // reference, and this deletes nothing from that table, so every
    // transaction created from this import - or from any other -
    // remains exactly as it is, imported or not. See
    // ImportBatchRepository.deleteAtomic for why both DELETEs run in one
    // real database transaction.
    async deleteBatch(id: string): Promise<void> {
        const existing =
            await this.batchRepository.getById(id);

        if (!existing) {
            throw new Error(
                "Import batch not found."
            );
        }

        await this.batchRepository.deleteAtomic(id);
    }

    // Removes one Saved Mapping. Never touches accounts, transactions,
    // or any other import - see ImportMappingRepository.delete's own
    // doc comment for why a plain single-row DELETE is already safe
    // here (nothing else references this row).
    async deleteMapping(id: string): Promise<void> {
        const existing =
            await this.mappingRepository.findById(id);

        if (!existing) {
            throw new Error(
                "Import mapping not found."
            );
        }

        await this.mappingRepository.delete(id);
    }
}

