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

export interface Transaction {

    id: string;

    accountId: string;

    categoryId: string | null;

    subcategoryId: string | null;

    payee: string;

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
