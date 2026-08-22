export interface CsvRow {
    rowNumber: number;
    values: string[];
}

export interface CsvDocument {
    headers: string[];
    rows: CsvRow[];
}

export interface NormalizedTransactionCandidate {
    rowNumber: number;
    transactionDate: string | null;
    payee: string;
    description: string;
    amount: number | null;
    type: "income" | "expense" | "transfer" | null;
    referenceNumber: string | null;
    rawData: Record<string, string>;
}

export interface CsvColumnMapping {
    date?: string;
    description?: string;
    payee?: string;
    amount?: string;
    debit?: string;
    credit?: string;
    type?: string;
    referenceNumber?: string;
}

export interface ImportValidationError {
    rowNumber: number;
    field?: string;
    message: string;
}

export interface ImportValidationResult {
    valid: boolean;
    errors: ImportValidationError[];
}
