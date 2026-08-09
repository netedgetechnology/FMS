export type AccountType =
    | "bank"
    | "cash"
    | "credit_card"
    | "wallet"
    | "investment"
    | "loan";

export interface Account {

    id: string;

    name: string;

    accountType: AccountType;

    institution: string | null;

    accountNumber: string | null;

    currency: string;

    openingBalance: number;

    currentBalance: number;

    color: string | null;

    icon: string | null;

    notes: string | null;

    isActive: boolean;

    createdAt: Date;

    updatedAt: Date;

}

export interface CreateAccountRequest {

    name: string;

    accountType: AccountType;

    institution?: string;

    accountNumber?: string;

    currency?: string;

    openingBalance?: number;

    color?: string;

    icon?: string;

    notes?: string;

}

export interface UpdateAccountRequest
    extends Partial<CreateAccountRequest> {

    id: string;

}
