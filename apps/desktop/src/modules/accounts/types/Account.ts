import { AccountType } from "./AccountType";

export interface Account {
    id: string;

    name: string;

    type: AccountType;

    institutionId: string | null;

institutionName?: string;

    currencyId: string;

    openingBalance: number;

    accountNumber?: string;

    branchName?: string;

    ifscCode?: string;

    swiftCode?: string;

    iban?: string;

    description?: string;

    isActive: boolean;

    createdAt: string;

    updatedAt: string;
}

