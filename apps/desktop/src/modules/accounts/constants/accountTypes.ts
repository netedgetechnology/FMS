import { AccountType } from "../types";

export interface AccountTypeOption {
    value: AccountType;
    label: string;
}

export const ACCOUNT_TYPE_OPTIONS: AccountTypeOption[] = [
    {
        value: AccountType.CASH,
        label: "Cash",
    },
    {
        value: AccountType.SAVINGS,
        label: "Savings",
    },
    {
        value: AccountType.CURRENT,
        label: "Current",
    },
    {
        value: AccountType.CREDIT_CARD,
        label: "Credit Card",
    },
    {
        value: AccountType.INVESTMENT,
        label: "Investment",
    },
    {
        value: AccountType.WALLET,
        label: "Wallet",
    },
];
