import { describe, expect, it } from "vitest";

import { AccountType } from "@/modules/accounts/types";

import { computeAccountBalances } from "./DashboardService";

function account(
    id: string,
    type: AccountType,
    openingBalance: number,
    name: string = id,
) {
    return { id, name, type, openingBalance };
}

const noTransactions = new Map<string, number>();

describe("computeAccountBalances", () => {
    it("computes Bank Balance from CURRENT and SAVINGS accounts only", () => {
        const result = computeAccountBalances(
            [
                account("a1", AccountType.CURRENT, 1000),
                account("a2", AccountType.SAVINGS, 500),
            ],
            noTransactions,
        );

        expect(result.bankBalance).toBe(1500);
    });

    it("computes Cash On Hand from CASH and WALLET accounts only", () => {
        const result = computeAccountBalances(
            [
                account("a1", AccountType.CASH, 200),
                account("a2", AccountType.WALLET, 300),
            ],
            noTransactions,
        );

        expect(result.cashOnHand).toBe(500);
    });

    it("sums multiple bank accounts correctly", () => {
        const result = computeAccountBalances(
            [
                account("a1", AccountType.CURRENT, 1000),
                account("a2", AccountType.CURRENT, 2000),
                account("a3", AccountType.SAVINGS, 500),
                account("a4", AccountType.SAVINGS, 1500),
            ],
            noTransactions,
        );

        expect(result.bankBalance).toBe(5000);
        expect(result.cashOnHand).toBe(0);
    });

    it("sums multiple cash accounts correctly", () => {
        const result = computeAccountBalances(
            [
                account("a1", AccountType.CASH, 100),
                account("a2", AccountType.CASH, 250),
                account("a3", AccountType.WALLET, 75),
                account("a4", AccountType.WALLET, 25),
            ],
            noTransactions,
        );

        expect(result.cashOnHand).toBe(450);
        expect(result.bankBalance).toBe(0);
    });

    it("handles bank-only data (Cash On Hand is zero)", () => {
        const result = computeAccountBalances(
            [
                account("a1", AccountType.CURRENT, 1000),
                account("a2", AccountType.SAVINGS, 2000),
            ],
            noTransactions,
        );

        expect(result.bankBalance).toBe(3000);
        expect(result.cashOnHand).toBe(0);
    });

    it("handles cash-only data (Bank Balance is zero)", () => {
        const result = computeAccountBalances(
            [account("a1", AccountType.CASH, 500)],
            noTransactions,
        );

        expect(result.bankBalance).toBe(0);
        expect(result.cashOnHand).toBe(500);
    });

    it("computes both figures correctly when bank and cash accounts are present together", () => {
        const result = computeAccountBalances(
            [
                account("a1", AccountType.CURRENT, 10000),
                account("a2", AccountType.SAVINGS, 5000),
                account("a3", AccountType.CASH, 300),
                account("a4", AccountType.WALLET, 700),
            ],
            noTransactions,
        );

        expect(result.bankBalance).toBe(15000);
        expect(result.cashOnHand).toBe(1000);
    });

    it("displays zero correctly when there are no accounts at all", () => {
        const result = computeAccountBalances([], noTransactions);

        expect(result.bankBalance).toBe(0);
        expect(result.cashOnHand).toBe(0);
        expect(result.accountsNetWorth).toBe(0);
        expect(result.accounts).toEqual([]);
    });

    it("displays zero correctly for an account with a zero opening balance and no transactions", () => {
        const result = computeAccountBalances(
            [
                account("a1", AccountType.CURRENT, 0),
                account("a2", AccountType.CASH, 0),
            ],
            noTransactions,
        );

        expect(result.bankBalance).toBe(0);
        expect(result.cashOnHand).toBe(0);
    });

    it("excludes credit card accounts from both Bank Balance and Cash On Hand", () => {
        const result = computeAccountBalances(
            [
                account("a1", AccountType.CURRENT, 1000),
                account("a2", AccountType.CREDIT_CARD, -500),
            ],
            noTransactions,
        );

        expect(result.bankBalance).toBe(1000);
        expect(result.cashOnHand).toBe(0);
    });

    it("excludes loan accounts from both Bank Balance and Cash On Hand", () => {
        const result = computeAccountBalances(
            [
                account("a1", AccountType.CASH, 200),
                account("a2", AccountType.LOAN, -50000),
            ],
            noTransactions,
        );

        expect(result.bankBalance).toBe(0);
        expect(result.cashOnHand).toBe(200);
    });

    it("excludes investment (mirror) accounts from both Bank Balance and Cash On Hand", () => {
        const result = computeAccountBalances(
            [
                account("a1", AccountType.SAVINGS, 1000),
                account("a2", AccountType.INVESTMENT, 0),
            ],
            noTransactions,
        );

        expect(result.bankBalance).toBe(1000);
        expect(result.cashOnHand).toBe(0);
    });

    it("folds each account's net transaction activity into its balance before classifying it", () => {
        const result = computeAccountBalances(
            [
                account("a1", AccountType.CURRENT, 1000),
                account("a2", AccountType.CASH, 500),
            ],
            new Map([
                ["a1", 250], // net income on the bank account
                ["a2", -100], // net expense on the cash account
            ]),
        );

        expect(result.bankBalance).toBe(1250);
        expect(result.cashOnHand).toBe(400);
    });

    it("still subtracts credit card debt from accountsNetWorth, unchanged from the pre-split behavior", () => {
        const result = computeAccountBalances(
            [
                account("a1", AccountType.CURRENT, 1000),
                account("a2", AccountType.CASH, 200),
                account("a3", AccountType.CREDIT_CARD, -300),
            ],
            noTransactions,
        );

        // 1000 (bank) + 200 (cash) - 300 (credit card debt)
        expect(result.accountsNetWorth).toBe(900);
    });

    it("contributes nothing to accountsNetWorth from investment or loan mirror accounts", () => {
        const result = computeAccountBalances(
            [
                account("a1", AccountType.INVESTMENT, 999999),
                account("a2", AccountType.LOAN, -999999),
            ],
            noTransactions,
        );

        expect(result.accountsNetWorth).toBe(0);
    });

    it("preserves the per-account summary rows (id, name, type, amount, isCreditCard) for every account, regardless of classification", () => {
        const result = computeAccountBalances(
            [account("a1", AccountType.CREDIT_CARD, -400, "My Card")],
            noTransactions,
        );

        expect(result.accounts).toEqual([
            {
                id: "a1",
                name: "My Card",
                type: "CREDIT_CARD",
                amount: -400,
                isCreditCard: true,
            },
        ]);
    });
});
