import { AccountType } from "../types";

export interface AccountTypeOption {
    value: AccountType;
    label: string;
}

export const BANK_ACCOUNT_TYPE_OPTIONS: AccountTypeOption[] = [
    {
        value: AccountType.CURRENT,
        label: "Current / Checking",
    },
    {
        value: AccountType.SAVINGS,
        label: "Savings",
    },
];

export const CREDIT_CARD_TYPE_OPTIONS: AccountTypeOption[] = [
    {
        value: AccountType.CREDIT_CARD,
        label: "Credit Card",
    },
];

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
