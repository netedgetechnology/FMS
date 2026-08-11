export type CreditCardNetwork =
    | "VISA"
    | "MASTERCARD"
    | "AMEX"
    | "RUPAY"
    | "OTHER";

export interface CreditCard {
    id: string;
    accountId: string;
    cardNetwork: CreditCardNetwork;
    creditLimit: number;
    statementDay: number | null;
    paymentDueDay: number | null;
    openingOutstandingBalance: number;
    createdAt: string;
    updatedAt: string;
}

export interface CreateCreditCardRequest {
    accountId: string;
    cardNetwork: CreditCardNetwork;
    creditLimit: number;
    statementDay?: number | null;
    paymentDueDay?: number | null;
    openingOutstandingBalance: number;
}

export interface UpdateCreditCardRequest {
    id: string;
    cardNetwork: CreditCardNetwork;
    creditLimit: number;
    statementDay?: number | null;
    paymentDueDay?: number | null;
    openingOutstandingBalance: number;
}
