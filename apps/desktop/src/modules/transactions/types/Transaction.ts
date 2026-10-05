export type TransactionType =
    | "income"
    | "expense"
    | "transfer";

export type TransferDirection =
    | "OUT"
    | "IN";

export type TransactionStatus =
    | "PENDING"
    | "CLEARED";

// A Payment Type code from the user-managed master list (Settings ->
// Payment Types, table payment_types) - e.g. "UPI", "PAYPAL", or one the
// user added such as "GOOGLE_PAY". Every Payment Type selector offers the
// active master-list types; no list of codes is kept in code.
export type PaymentTypeCode = string;

// The manually-selected Payment Method (transactions.payment_method). A
// master-list code.
export type PaymentMethod = PaymentTypeCode;

// The transaction *channel* - which rail carried the money
// (transactions.transaction_type). Also a master-list code, but a
// separate field from PaymentMethod, and from TransactionType above
// (DR/CR direction, i.e. income/expense/transfer): this never
// overwrites either. @financeos/import-engine detects a fixed subset of
// these codes from bank narrations; the user may pick any master-list
// type in Import Preview. CREDIT_CARD is a generic payment rail,
// independent of an account's own AccountType.CREDIT_CARD.
export type TransactionChannel = PaymentTypeCode;

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

    // Only for type "transfer": which way it moves money on this account
    // ("OUT" = leaves, "IN" = arrives). null otherwise, or for a legacy
    // transfer whose direction was never recorded. Always present on rows
    // read from the database; optional for hand-built objects.
    transferDirection?: TransferDirection | null;

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

    transferDirection?: TransferDirection | null;

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
