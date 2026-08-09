import { AccountType } from "./AccountType";

export interface UpdateAccountRequest {
    id: string;

    name: string;

    type: AccountType;

    institutionId: string | null;

    currencyId: string;

    openingBalance: number;

    accountNumber?: string;

    branchName?: string;

    ifscCode?: string;

    swiftCode?: string;

    iban?: string;

    description?: string;

    isActive: boolean;
}
