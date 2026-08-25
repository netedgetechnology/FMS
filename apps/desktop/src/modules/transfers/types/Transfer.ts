export interface Transfer {
    id: string;
    sourceAccountId: string;
    destinationAccountId: string;
    amount: number;
    transactionDate: string;
    currencyId: string;
    referenceNumber: string | null;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}

export interface CreateTransferRequest {
    id: string;
    sourceAccountId: string;
    destinationAccountId: string;
    amount: number;
    transactionDate: string;
    currencyId: string;
    referenceNumber?: string | null;
    notes?: string | null;
}
