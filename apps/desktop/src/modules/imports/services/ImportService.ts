import {
    CounterpartyRuleRepository,
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

import {
    processCsv,
    processExcel,
    processPdf,
    processDocumentWithMapping,
    getExcelSheetNames,
    computeHeaderSignature,
    extractTransactionPattern,
    type CsvImportType,
    type CsvPreviewResult,
    type ExcelProcessingResult,
    validateCandidates,
} from "@financeos/import-engine";

import type {
    CsvColumnMapping,
    CsvDocument,
    NormalizedTransactionCandidate,
    TransactionChannel,
} from "@financeos/import-engine";

import type {
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
}

// CsvPreviewResult (from @financeos/import-engine) doesn't know about
// account-scoped learning, so - exactly like ExcelPreviewResult above -
// this app-level extension attaches which rows an existing learned rule
// actually matched (see EnrichedCandidatesResult), for the Import
// Preview's Self-Learning indicator.
export interface CsvPreviewResultWithLearning
    extends CsvPreviewResult {
    matchedLearnedRuleRowNumbers: Set<number>;
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
        notes: string | null
    ): Promise<unknown>;
}

// A row's learning key - see extractTransactionPattern. Deliberately
// derived from Description alone, never Payee: Payee is user-editable
// (and gets overwritten by a learned rule right below), so basing the
// pattern on it would make the learning key itself shift out from under
// an edit/enrichment instead of staying a stable identity for the
// transaction. A candidate with no Description at all simply has no
// learning pattern (null) rather than falling back to the unstable
// field.
function learningPatternForCandidate(
    candidate: NormalizedTransactionCandidate
): string | null {
    return extractTransactionPattern(
        candidate.description
    );
}

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
// (see extractTransactionPattern), scoped to the destination account so
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

        matchedRowNumbers.add(
            candidate.rowNumber
        );

        enriched.push({
            ...candidate,
            payee: rule.counterparty,
            transactionType:
                (rule.type as TransactionChannel | null) ??
                candidate.transactionType,
            notes:
                rule.notes ??
                candidate.notes,
        });
    }

    return { candidates: enriched, matchedRowNumbers };
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

// Learns (or refreshes) an "account + pattern -> Payee/Type/Notes"
// association from a single candidate's final values (auto-suggested
// and accepted, or manually entered/corrected) - confirmed accurate the
// moment it's actually imported. No-ops entirely when the Payee is
// blank or the narration is too short/generic to safely learn from (see
// extractTransactionPattern). A blank Type/Notes on this candidate never
// erases a previously-learned value for the pattern - see
// CounterpartyRuleRepository.upsert.
export async function learnRuleFromCandidate(
    accountId: string,
    candidate: NormalizedTransactionCandidate,
    rules: TransactionPatternRuleStore
): Promise<void> {
    if (!candidate.payee) {
        return;
    }

    const pattern =
        learningPatternForCandidate(candidate);

    if (pattern) {
        await rules.upsert(
            accountId,
            pattern,
            candidate.payee,
            candidate.transactionType,
            candidate.notes
        );
    }
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

    private readonly transactionRepository =
        new TransactionRepository();

    private readonly transactionService =
        new TransactionService();

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
        };
    }

    async previewExcel(
        accountId: string,
        content: ArrayBuffer,
        sheetName?: string,
        importType: CsvImportType = "BANK_CSV"
    ): Promise<ExcelPreviewResult> {
        const result =
            processExcel(
                content,
                sheetName,
                importType
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
            sheetNames:
                getExcelSheetNames(content),
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
        selfLearningDisabledRowNumbers?: ReadonlySet<number>
    ): Promise<ImportBatch> {
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
            selfLearningDisabledRowNumbers
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

    private async enrichLearnedRules(
        accountId: string,
        candidates: NormalizedTransactionCandidate[]
    ): Promise<EnrichedCandidatesResult> {
        return enrichCandidatesWithLearnedRulesDetailed(
            accountId,
            candidates,
            this.counterpartyRuleRepository
        );
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
        selfLearningDisabledRowNumbers?: ReadonlySet<number>
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

            // Learn from this row's final Payee/Type/Notes
            // (auto-suggested and accepted, or manually
            // entered/corrected) regardless of whether it turns out to
            // be a duplicate - the association is still
            // confirmed-accurate for this transaction pattern. A
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
                        this.counterpartyRuleRepository
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
                        candidate.description
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
                        categoryId: null,
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
}

