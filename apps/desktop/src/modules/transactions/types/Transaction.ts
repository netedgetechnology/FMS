export type TransactionType =
    | "income"
    | "expense"
    | "transfer";

export interface Transaction {

    id: string;

    accountId: string;

    categoryId: string | null;

    payee: string;

    type: TransactionType;

    amount: number;

    transactionDate: string;

    referenceNumber: string | null;

    notes: string | null;

    createdAt: string;

    updatedAt: string;

}

export interface CreateTransactionRequest {

    accountId: string;

    categoryId?: string | null;

    payee: string;

    type: TransactionType;

    amount: number;

    transactionDate: string;

    referenceNumber?: string;

    notes?: string;

}

export interface UpdateTransactionRequest
    extends Partial<CreateTransactionRequest> {

    id: string;

}
