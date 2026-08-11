import { InvestmentTransactionType } from "./InvestmentTransactionType";

export interface InvestmentTransaction {
    id: string;

    investmentId: string;

    transactionType: InvestmentTransactionType;

    transactionDate: string;

    quantity: number;

    price: number;

    amount: number;

    fees: number;

    taxes: number;

    referenceNumber: string | null;

    notes?: string;

    createdAt: string;

    updatedAt: string;
}
