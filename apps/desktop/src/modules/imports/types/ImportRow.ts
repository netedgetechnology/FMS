export type ImportRowStatus =
    | "PENDING"
    | "VALID"
    | "IMPORTED"
    | "DUPLICATE"
    | "FAILED";

export interface ImportRow {
    id: string;
    importBatchId: string;
    rowNumber: number;
    rawData: Record<string, unknown>;
    normalizedData: Record<string, unknown> | null;
    transactionId: string | null;
    status: ImportRowStatus;
    errorMessage: string | null;
    createdAt: string;
}

export interface CreateImportRowRequest {
    importBatchId: string;
    rowNumber: number;
    rawData: Record<string, unknown>;
    normalizedData?: Record<string, unknown> | null;
}

export interface UpdateImportRowRequest {
    id: string;
    normalizedData?: Record<string, unknown> | null;
    transactionId?: string | null;
    status?: ImportRowStatus;
    errorMessage?: string | null;
}
