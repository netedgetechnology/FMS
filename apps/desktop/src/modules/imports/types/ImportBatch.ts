export type ImportType =
    | "BANK_CSV"
    | "CREDIT_CARD_CSV";

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
