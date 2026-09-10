// Kept in sync with @financeos/import-engine's CsvImportType - an
// ImportBatch always records the same Import Type value the preview/
// import was run with.
export type ImportType =
    | "BANK_CSV"
    | "BANK_EXCEL"
    | "BANK_PDF"
    | "CREDIT_CARD_CSV"
    | "CREDIT_CARD_PDF"
    | "CREDIT_CARD_EXCEL";

export type ImportBatchStatus =
    | "PENDING"
    | "PROCESSING"
    | "COMPLETED"
    | "COMPLETED_WITH_ERRORS"
    | "FAILED";

export interface ImportBatch {
    id: string;
    accountId: string | null;
    importType: ImportType;
    sourceFileName: string;
    status: ImportBatchStatus;
    totalRows: number;
    importedRows: number;
    duplicateRows: number;
    failedRows: number;
    createdAt: string;
    updatedAt: string;
}

export interface CreateImportBatchRequest {
    accountId?: string | null;
    importType: ImportType;
    sourceFileName: string;
    totalRows?: number;
}

export interface UpdateImportBatchRequest {
    id: string;
    status?: ImportBatchStatus;
    totalRows?: number;
    importedRows?: number;
    duplicateRows?: number;
    failedRows?: number;
}
