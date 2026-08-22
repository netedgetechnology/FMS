import {
    ImportBatchRepository,
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
    type CsvImportType,
    type CsvPreviewResult,
    validateCandidates,
} from "@financeos/import-engine";

import type {
    NormalizedTransactionCandidate,
} from "@financeos/import-engine";

import type {
    ImportBatch,
    ImportRow,
    CreateImportBatchRequest,
    CreateImportRowRequest,
    UpdateImportBatchRequest,
    UpdateImportRowRequest,
} from "../types";

function createId(): string {
    return crypto.randomUUID();
}

export class ImportService {
    private readonly batchRepository =
        new ImportBatchRepository();

    private readonly rowRepository =
        new ImportRowRepository();

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

        await this.batchRepository.create(
            batch
        );

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
                request.normalizedData ??
                null,
            transactionId: null,
            status: "PENDING",
            errorMessage: null,
            createdAt:
                new Date().toISOString(),
        };

        await this.rowRepository.create(
            row
        );

        return row;
    }

    async previewCsv(
        accountId: string,
        content: string,
        importType: CsvImportType = "BANK_CSV"
    ): Promise<CsvPreviewResult> {
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

        const validation =
            result.validation;

        const duplicates = new Map<
            number,
            string
        >();

        if (validation.valid) {
            for (
                const candidate
                of result.candidates
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
        }

        return {
            ...result,
            duplicates,
        };
    }
    async processCsv(
        accountId: string,
        sourceFileName: string,
        content: string,
        importType: CsvImportType = "BANK_CSV"
    ): Promise<ImportBatch> {

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

        if (
            result.validation.errors.length > 0
        ) {
            const batch =
                await this.createBatch({
                    accountId,
                    importType: importType,
                    sourceFileName,
                    totalRows:
                        result.candidates.length,
                });

            await this.updateBatch({
                id: batch.id,
                status: "PROCESSING",
                totalRows:
                    result.candidates.length,
            });

            for (
                const candidate
                of result.candidates
            ) {
                const errors =
                    result.validation.errors.filter(
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

            const failedRows =
                result.validation.errors
                    .map(
                        error =>
                            error.rowNumber
                    )
                    .filter(
                        (rowNumber, index, rows) =>
                            rows.indexOf(
                                rowNumber
                            ) === index
                    ).length;

            await this.updateBatch({
                id: batch.id,
                status:
                    failedRows ===
                    result.candidates.length
                        ? "FAILED"
                        : "COMPLETED_WITH_ERRORS",
                totalRows:
                    result.candidates.length,
                importedRows: 0,
                duplicateRows: 0,
                failedRows,
            });

            return (
                (await this.getBatch(
                    batch.id
                )) ?? batch
            );
        }

        const batch =
            await this.createBatch({
                accountId,
                importType: importType,
                sourceFileName,
                totalRows:
                    result.candidates.length,
            });

        return await this.executeCandidates(
            batch.id,
            result.candidates
        );
    }
    async executeCandidates(
        batchId: string,
        candidates: NormalizedTransactionCandidate[]
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

        for (const candidate of candidates) {

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

            if (candidateErrors.length > 0) {
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
                        type:
                            candidate.type!,
                        amount:
                            candidate.amount!,
                        transactionDate:
                            candidate.transactionDate!,
                        referenceNumber:
                            candidate.referenceNumber ??
                            undefined,
                        notes:
                            candidate.description ||
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
            (await this.getBatch(
                batch.id
            )) ?? {
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
}












