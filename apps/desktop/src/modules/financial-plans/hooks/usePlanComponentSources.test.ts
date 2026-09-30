import { describe, expect, it } from "vitest";

import type { Account } from "@/modules/accounts/types";
import type { Category } from "@/modules/categories/types";
import type { Investment } from "@/modules/investments/types";
import type { Loan } from "@/modules/loans/types";
import type { Transaction } from "@/modules/transactions/types";

import { sourceOptionsFor } from "./usePlanComponentSources";

function category(
    overrides: Partial<Category> = {}
): Category {
    return {
        id: "cat-1",
        parentId: null,
        name: "Category",
        categoryType: "INCOME",
        financeScope: "PERSONAL" as Category["financeScope"],
        businessEntityId: null,
        description: null,
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function account(
    overrides: Partial<Account> = {}
): Account {
    return {
        id: "acc-1",
        name: "Account",
        type: "SAVINGS" as Account["type"],
        institutionId: null,
        businessEntityId: null,
        currencyId: "INR",
        openingBalance: 0,
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function transaction(
    overrides: Partial<Transaction> = {}
): Transaction {
    return {
        id: "txn-1",
        accountId: "acc-1",
        categoryId: "cat-1",
        subcategoryId: null,
        payee: "Payee",
        counterparty: null,
        branch: null,
        type: "income",
        amount: 100,
        transactionDate: "2026-09-01",
        referenceNumber: null,
        notes: null,
        tags: null,
        status: "CLEARED",
        paymentMethod: null,
        upiReference: null,
        bankTransactionReference: null,
        cardReference: null,
        transactionType: null,
        reconciled: false,
        reconciledAt: null,
        isImported: false,
        sourceStatement: null,
        externalTransactionId: null,
        originalNarration: null,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
        ...overrides,
    };
}

function data(
    overrides: Partial<{
        accounts: Account[];
        categories: Category[];
        investments: Investment[];
        loans: Loan[];
        transactions: Transaction[];
    }> = {}
) {
    return {
        accounts: [],
        categories: [],
        investments: [],
        loans: [],
        transactions: [],
        ...overrides,
    };
}

describe("sourceOptionsFor - CATEGORY", () => {
    it("includes a category whose categoryType matches the role, even with no transactions", () => {
        const options = sourceOptionsFor(
            data({
                categories: [
                    category({
                        id: "cat-salary",
                        categoryType: "INCOME",
                    }),
                ],
            }),
            "CATEGORY",
            "CONTRIBUTION",
            "INR"
        );

        expect(options.map(o => o.id)).toEqual([
            "cat-salary",
        ]);
    });

    it("never includes a TRANSFER category, regardless of transaction data", () => {
        const options = sourceOptionsFor(
            data({
                categories: [
                    category({
                        id: "cat-transfer",
                        categoryType: "TRANSFER",
                    }),
                ],
                accounts: [account()],
                transactions: [
                    transaction({
                        categoryId: "cat-transfer",
                        type: "income",
                    }),
                ],
            }),
            "CATEGORY",
            "CONTRIBUTION",
            "INR"
        );

        expect(options).toEqual([]);
    });

    it("excludes a categoryType/role mismatch with no matching transactions", () => {
        const options = sourceOptionsFor(
            data({
                categories: [
                    category({
                        id: "cat-groceries",
                        categoryType: "EXPENSE",
                    }),
                ],
            }),
            "CATEGORY",
            "CONTRIBUTION",
            "INR"
        );

        expect(options).toEqual([]);
    });

    it("rescues a category whose categoryType doesn't match the role when it has a real matching transaction in the plan currency (reported bug: Salary typed EXPENSE, used for income)", () => {
        const options = sourceOptionsFor(
            data({
                categories: [
                    category({
                        id: "cat-salary",
                        categoryType: "EXPENSE",
                    }),
                ],
                accounts: [
                    account({
                        id: "acc-inr",
                        currencyId: "INR",
                    }),
                ],
                transactions: [
                    transaction({
                        accountId: "acc-inr",
                        categoryId: "cat-salary",
                        type: "income",
                    }),
                ],
            }),
            "CATEGORY",
            "CONTRIBUTION",
            "INR"
        );

        expect(options.map(o => o.id)).toEqual([
            "cat-salary",
        ]);
    });

    it("does not rescue a mismatched category when the matching transaction is in a different currency than the plan", () => {
        const options = sourceOptionsFor(
            data({
                categories: [
                    category({
                        id: "cat-salary",
                        categoryType: "EXPENSE",
                    }),
                ],
                accounts: [
                    account({
                        id: "acc-usd",
                        currencyId: "USD",
                    }),
                ],
                transactions: [
                    transaction({
                        accountId: "acc-usd",
                        categoryId: "cat-salary",
                        type: "income",
                    }),
                ],
            }),
            "CATEGORY",
            "CONTRIBUTION",
            "INR"
        );

        expect(options).toEqual([]);
    });

    it("does not rescue a mismatched category from a transaction in the wrong direction", () => {
        const options = sourceOptionsFor(
            data({
                categories: [
                    category({
                        id: "cat-salary",
                        categoryType: "EXPENSE",
                    }),
                ],
                accounts: [account({ id: "acc-1" })],
                transactions: [
                    transaction({
                        accountId: "acc-1",
                        categoryId: "cat-salary",
                        type: "expense",
                    }),
                ],
            }),
            "CATEGORY",
            "CONTRIBUTION",
            "INR"
        );

        expect(options).toEqual([]);
    });

    it("SPENDING role is rescued symmetrically by a real expense transaction", () => {
        const options = sourceOptionsFor(
            data({
                categories: [
                    category({
                        id: "cat-refund",
                        categoryType: "INCOME",
                    }),
                ],
                accounts: [account({ id: "acc-1" })],
                transactions: [
                    transaction({
                        accountId: "acc-1",
                        categoryId: "cat-refund",
                        type: "expense",
                    }),
                ],
            }),
            "CATEGORY",
            "SPENDING",
            "INR"
        );

        expect(options.map(o => o.id)).toEqual([
            "cat-refund",
        ]);
    });
});
