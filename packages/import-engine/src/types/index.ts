export interface CsvRow {
    rowNumber: number;
    values: string[];
}

export interface CsvDocument {
    headers: string[];
    rows: CsvRow[];
}

// The transaction *channel* - how the money moved (UPI/IMPS/NEFT/RTGS/
// Cash/Cheque). Distinct from and never derived from DR/CR direction:
// direction says money in vs. money out (-> the existing "type" field,
// income/expense/transfer); channel says which rail carried it. Optional.
export type TransactionChannel =
    | "UPI"
    | "IMPS"
    | "NEFT"
    | "RTGS"
    | "CASH"
    | "CHEQUE"
    | "EMANDATE"
    | "NET_BANKING"
    | "MOBILE_APP";

export interface NormalizedTransactionCandidate {
    rowNumber: number;
    transactionDate: string | null;
    payee: string;
    description: string;
    amount: number | null;
    type: "income" | "expense" | "transfer" | null;
    referenceNumber: string | null;
    // The source statement's own transaction ID, from an explicit mapped
    // "Transaction ID" column only - never auto-detected (see
    // ColumnMappingField/HEADER_RULES in columnDetector.ts) and never
    // used for duplicate matching (see TransactionRepository.findDuplicate,
    // which only ever considers referenceNumber). Distinct from
    // referenceNumber, which stays the general reference/UTR/cheque-number
    // field.
    externalTransactionId: string | null;
    // The transaction channel (see TransactionChannel) - from an explicit
    // mapped source column when provided, otherwise auto-detected from
    // description/payee/reference text. Never affects amount, type
    // (direction), or balance.
    transactionType: TransactionChannel | null;
    // Informational only (e.g. running/closing balance from the source
    // statement) - not part of the canonical Transaction schema and never
    // written to it. Carried through for preview/audit visibility.
    balance: number | null;
    // The bank branch a transaction was processed at (from a mapped
    // source column). Persisted with the canonical transaction.
    branch: string | null;
    // The person/company on the other side of the transaction. Always
    // null from normalization itself - the import-engine has no learning
    // state; the desktop layer fills this in from previously-confirmed
    // counterparty associations (see @financeos import service) and/or a
    // per-row manual entry, which always wins.
    counterparty: string | null;
    // Free-form, user-editable transaction note. Independent from
    // `description` (the source narration) - always null from
    // normalization itself; filled in only via per-row manual entry.
    notes: string | null;
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
    balance?: string;
    branch?: string;
    transactionType?: string;
    // Manual-only mapping target for the source statement's own
    // "Transaction ID" column - never auto-detected (see
    // ColumnMappingField in columnDetector.ts).
    externalTransactionId?: string;
}

export interface LoanScheduleColumnMapping {
    installmentNumber?: string;
    dueDate?: string;
    paymentDate?: string;
    emi?: string;
    principal?: string;
    interest?: string;
    outstandingPrincipal?: string;
    outstandingBalance?: string;
    loanNumber?: string;
    description?: string;
    referenceNumber?: string;
}

export interface NormalizedLoanScheduleCandidate {
    rowNumber: number;
    installmentNumber: number | null;
    dueDate: string | null;
    paymentDate: string | null;
    emi: number | null;
    principal: number | null;
    interest: number | null;
    outstandingPrincipal: number | null;
    loanNumber: string | null;
    description: string;
    referenceNumber: string | null;
    rawData: Record<string, string>;
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
