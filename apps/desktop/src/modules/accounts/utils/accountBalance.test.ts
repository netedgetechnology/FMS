import { describe, expect, it } from "vitest";

import {
    computeAccountCurrentBalance,
    computeAccountCurrentBalances,
    computeAccountTransactionDeltas,
} from "./accountBalance";

// Regression: the Accounts page showed "Family Member Account" at
// ₹0.00 because it rendered the account's stored opening_balance
// (0) directly, ignoring the ₹2,000 of income transactions posted
// against it. These tests reproduce that exact scenario and the
// general formula (opening balance + income - expense) both the
// Accounts page and the Dashboard now share.
describe("computeAccountTransactionDeltas", () => {
    it("1. sums income transactions for an account as a positive delta", () => {
        const deltas = computeAccountTransactionDeltas([
            { accountId: "family-account", type: "income", amount: 500 },
            { accountId: "family-account", type: "income", amount: 1000 },
            { accountId: "family-account", type: "income", amount: 500 },
        ]);

        expect(deltas.get("family-account")).toBe(2000);
    });

    it("2. subtracts expense transactions for an account", () => {
        const deltas = computeAccountTransactionDeltas([
            { accountId: "acct-1", type: "income", amount: 1000 },
            { accountId: "acct-1", type: "expense", amount: 300 },
        ]);

        expect(deltas.get("acct-1")).toBe(700);
    });

    it("3. ignores transfer transactions - they are not income or expense", () => {
        const deltas = computeAccountTransactionDeltas([
            { accountId: "acct-1", type: "income", amount: 1000 },
            { accountId: "acct-1", type: "transfer", amount: 400 },
        ]);

        expect(deltas.get("acct-1")).toBe(1000);
    });

    it("4. keeps each account's delta independent of other accounts", () => {
        const deltas = computeAccountTransactionDeltas([
            { accountId: "acct-1", type: "income", amount: 1000 },
            { accountId: "acct-2", type: "expense", amount: 200 },
        ]);

        expect(deltas.get("acct-1")).toBe(1000);
        expect(deltas.get("acct-2")).toBe(-200);
    });

    it("5. treats a stored negative amount as its absolute value, matching the sign convention amount is always stored positive", () => {
        const deltas = computeAccountTransactionDeltas([
            { accountId: "acct-1", type: "expense", amount: -50 },
        ]);

        expect(deltas.get("acct-1")).toBe(-50);
    });

    it("6. returns an empty map for an account with no transactions at all", () => {
        const deltas = computeAccountTransactionDeltas([]);

        expect(deltas.has("acct-1")).toBe(false);
    });
});

describe("computeAccountCurrentBalance", () => {
    it("1. Family Member Account: opening balance 0 + ₹2,000 income = ₹2,000, not ₹0.00", () => {
        const deltas = computeAccountTransactionDeltas([
            { accountId: "family-account", type: "income", amount: 500 },
            { accountId: "family-account", type: "income", amount: 500 },
            { accountId: "family-account", type: "income", amount: 1000 },
        ]);

        const balance = computeAccountCurrentBalance(
            { id: "family-account", openingBalance: 0 },
            deltas
        );

        expect(balance).toBe(2000);
    });

    it("2. adds the delta on top of a non-zero opening balance", () => {
        const deltas = computeAccountTransactionDeltas([
            { accountId: "acct-1", type: "expense", amount: 200 },
        ]);

        const balance = computeAccountCurrentBalance(
            { id: "acct-1", openingBalance: 1000 },
            deltas
        );

        expect(balance).toBe(800);
    });

    it("3. an account with no matching transactions keeps exactly its opening balance", () => {
        const deltas = computeAccountTransactionDeltas([
            { accountId: "some-other-account", type: "income", amount: 999 },
        ]);

        const balance = computeAccountCurrentBalance(
            { id: "acct-1", openingBalance: 1000 },
            deltas
        );

        expect(balance).toBe(1000);
    });

    it("4. a LOAN mirror account's already-derived opening balance (see AccountRepository) is untouched when no transaction targets it directly - EMI payments post against the paying bank account, not the loan account", () => {
        const deltas = computeAccountTransactionDeltas([
            // The EMI payment transaction is recorded against the
            // paying bank account (loan.accountId), never the LOAN
            // mirror account (loan.loanAccountId) - see
            // LoanPaymentService. So the loan account's own delta stays
            // empty and its repository-derived negative outstanding
            // balance passes through unchanged.
            { accountId: "paying-bank-account", type: "expense", amount: 5000 },
        ]);

        const loanBalance = computeAccountCurrentBalance(
            { id: "loan-account", openingBalance: -45000 },
            deltas
        );

        expect(loanBalance).toBe(-45000);
    });
});

describe("computeAccountCurrentBalances", () => {
    it("1. computes every account's current balance in one pass", () => {
        const balances = computeAccountCurrentBalances(
            [
                { id: "family-account", openingBalance: 0 },
                { id: "salary-account", openingBalance: 10000 },
            ],
            [
                { accountId: "family-account", type: "income", amount: 500 },
                { accountId: "family-account", type: "income", amount: 1500 },
                { accountId: "salary-account", type: "expense", amount: 2000 },
            ]
        );

        expect(balances.get("family-account")).toBe(2000);
        expect(balances.get("salary-account")).toBe(8000);
    });

    it("2. every account gets an entry even with zero matching transactions", () => {
        const balances = computeAccountCurrentBalances(
            [{ id: "acct-1", openingBalance: 250 }],
            []
        );

        expect(balances.get("acct-1")).toBe(250);
    });

    it("3. a deleted/unknown account referenced by a transaction is simply not present in the result - it never crashes", () => {
        const balances = computeAccountCurrentBalances(
            [{ id: "acct-1", openingBalance: 0 }],
            [{ accountId: "acct-missing", type: "income", amount: 100 }]
        );

        expect(balances.get("acct-1")).toBe(0);
        expect(balances.has("acct-missing")).toBe(false);
    });
});
