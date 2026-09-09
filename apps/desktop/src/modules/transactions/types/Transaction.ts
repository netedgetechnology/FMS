export type TransactionType =
    | "income"
    | "expense"
    | "transfer";

export type TransactionStatus =
    | "PENDING"
    | "CLEARED";

export type PaymentMethod =
    | "CASH"
    | "CARD"
    | "DEBIT_CARD"
    | "UPI"
    | "BANK_TRANSFER"
    | "DIRECT_DEBIT"
    | "OTHER";

// The transaction *channel* - which rail carried the money (UPI/IMPS/
// NEFT/RTGS/Cash/Cheque/Credit Card). Separate from PaymentMethod (a
// broader, manually-selected category) and from TransactionType above
// (DR/CR direction, i.e. income/expense/transfer): this never
// overwrites either. Kept in sync with @financeos/import-engine's own
// TransactionChannel. CREDIT_CARD is a generic payment rail like every
// other value here, independent of an account's own
// AccountType.CREDIT_CARD.
export type TransactionChannel =
    | "UPI"
    | "IMPS"
    | "NEFT"
    | "RTGS"
    | "CASH"
    | "CHEQUE"
    | "EMANDATE"
    | "NET_BANKING"
    | "MOBILE_APP"
    | "CREDIT_CARD";

export interface Transaction {

    id: string;

    accountId: string;

    categoryId: string | null;

    subcategoryId: string | null;

    payee: string;

    // The person/company on the other side of the transaction. Distinct
    // from payee/description/referenceNumber/notes - never merged into
    // any of them.
    counterparty: string | null;

    // The bank branch a transaction was processed at.
    branch: string | null;

    type: TransactionType;

    amount: number;

    transactionDate: string;

    referenceNumber: string | null;

    notes: string | null;

    tags: string | null;

    status: TransactionStatus;

    paymentMethod: PaymentMethod | null;

    upiReference: string | null;

    bankTransactionReference: string | null;

    cardReference: string | null;

    transactionType: TransactionChannel | null;

    reconciled: boolean;

    reconciledAt: string | null;

    isImported: boolean;

    sourceStatement: string | null;

    externalTransactionId: string | null;

    originalNarration: string | null;

    createdAt: string;

    updatedAt: string;

}

export interface CreateTransactionRequest {

    accountId: string;

    categoryId?: string | null;

    subcategoryId?: string | null;

    payee: string;

    counterparty?: string | null;

    branch?: string | null;

    type: TransactionType;

    amount: number;

    transactionDate: string;

    referenceNumber?: string | null;

    notes?: string | null;

    tags?: string | null;

    status?: TransactionStatus;

    paymentMethod?: PaymentMethod | null;

    upiReference?: string | null;

    bankTransactionReference?: string | null;

    cardReference?: string | null;

    transactionType?: TransactionChannel | null;

    reconciled?: boolean;

    reconciledAt?: string | null;

    isImported?: boolean;

    sourceStatement?: string | null;

    externalTransactionId?: string | null;

    originalNarration?: string | null;

}

export interface UpdateTransactionRequest
    extends Partial<CreateTransactionRequest> {

    id: string;

}
