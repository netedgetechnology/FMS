import { describe, expect, it } from "vitest";

import type { BudgetLedgerEntry } from "./budgetSpending";
import { classifyBudgetTransaction } from "./budgetTransaction";

function entry(
    overrides: Partial<BudgetLedgerEntry> = {}
): BudgetLedgerEntry {
    return {
        id: "txn-1",
        type: "expense",
        amount: 1000,
        transactionDate: "2026-09-10",
        categoryId: "cat-food",
        accountId: "bank-1",
        ...overrides,
    };
}

const CREDIT_CARDS = new Set(["cc-1", "cc-2"]);

describe("classifyBudgetTransaction - what counts as expense", () => {
    it("counts a normal bank / debit expense at face value", () => {
        const result = classifyBudgetTransaction(
            entry({ amount: 2500 })
        );

        expect(result).toEqual({
            include: true,
            amount: 2500,
            reason: "expense",
        });
    });

    it("counts a credit-card purchase (an expense row) at face value", () => {
        // A purchase paid by credit card is still just an expense here -
        // the payment that later clears the card is a separate transfer.
        const result = classifyBudgetTransaction(
            entry({ amount: 4200 })
        );

        expect(result.include).toBe(true);
        expect(result.amount).toBe(4200);
    });

    it("counts an imported expense (the isImported flag is irrelevant here)", () => {
        const result = classifyBudgetTransaction(
            entry({ amount: 999 })
        );

        expect(result.include).toBe(true);
        expect(result.amount).toBe(999);
    });

    it("counts a fee expense at face value", () => {
        const result = classifyBudgetTransaction(
            entry({ amount: 59, categoryId: "cat-fees" })
        );

        expect(result.include).toBe(true);
        expect(result.amount).toBe(59);
    });

    it("uses the absolute value of a negative stored amount (NOT treated as a refund)", () => {
        const result = classifyBudgetTransaction(
            entry({ amount: -1500 })
        );

        expect(result).toEqual({
            include: true,
            amount: 1500,
            reason: "expense",
        });
    });
});

describe("classifyBudgetTransaction - what is excluded", () => {
    it("excludes income", () => {
        expect(
            classifyBudgetTransaction(
                entry({ type: "income", amount: 90000 })
            )
        ).toEqual({
            include: false,
            amount: 0,
            reason: "not-an-expense",
        });
    });

    it("excludes a transfer even when it carries a category and an amount", () => {
        expect(
            classifyBudgetTransaction(
                entry({
                    type: "transfer",
                    amount: 5000,
                    categoryId: "cat-food",
                })
            )
        ).toMatchObject({
            include: false,
            reason: "not-an-expense",
        });
    });

    it("excludes a credit-card bill payment represented as a transfer", () => {
        expect(
            classifyBudgetTransaction(
                entry({ type: "transfer", amount: 18000 })
            ).include
        ).toBe(false);
    });

    it("excludes the income side of a credit-card payment (card statement)", () => {
        expect(
            classifyBudgetTransaction(
                entry({ type: "income", amount: 18000 })
            ).include
        ).toBe(false);
    });

    it("excludes a soft-deleted row before anything else", () => {
        expect(
            classifyBudgetTransaction(
                entry({
                    deletedAt: "2026-09-11T00:00:00.000Z",
                })
            )
        ).toEqual({
            include: false,
            amount: 0,
            reason: "soft-deleted",
        });
    });
});

describe("classifyBudgetTransaction - credit-card bill payment", () => {
    it("excludes a bank expense whose cardReference is a real credit-card account", () => {
        const result = classifyBudgetTransaction(
            entry({
                accountId: "bank-1",
                cardReference: "cc-1",
                amount: 18000,
            }),
            { creditCardAccountIds: CREDIT_CARDS }
        );

        expect(result).toEqual({
            include: false,
            amount: 0,
            reason: "credit-card-payment",
        });
    });

    it("still counts a normal bank expense with no cardReference", () => {
        const result = classifyBudgetTransaction(
            entry({
                accountId: "bank-1",
                cardReference: null,
                amount: 2500,
            }),
            { creditCardAccountIds: CREDIT_CARDS }
        );

        expect(result.include).toBe(true);
        expect(result.amount).toBe(2500);
    });

    it("counts a purchase booked ON the card (accountId === cardReference)", () => {
        const result = classifyBudgetTransaction(
            entry({
                accountId: "cc-1",
                cardReference: "cc-1",
                amount: 3200,
            }),
            { creditCardAccountIds: CREDIT_CARDS }
        );

        expect(result.include).toBe(true);
        expect(result.amount).toBe(3200);
    });

    it("counts a purchase on the card with no cardReference", () => {
        const result = classifyBudgetTransaction(
            entry({
                accountId: "cc-1",
                cardReference: null,
                amount: 3200,
            }),
            { creditCardAccountIds: CREDIT_CARDS }
        );

        expect(result.include).toBe(true);
    });

    it("counts an expense whose cardReference is not a known credit-card account (e.g. free-text debit-card ref)", () => {
        const result = classifyBudgetTransaction(
            entry({
                accountId: "bank-1",
                cardReference: "1234", // debit-card free text, not an account id
                amount: 900,
            }),
            { creditCardAccountIds: CREDIT_CARDS }
        );

        expect(result.include).toBe(true);
        expect(result.amount).toBe(900);
    });

    it("does nothing without the creditCardAccountIds context", () => {
        const result = classifyBudgetTransaction(
            entry({
                accountId: "bank-1",
                cardReference: "cc-1",
                amount: 18000,
            })
        );

        expect(result.include).toBe(true);
    });

    it("a transfer to a card is still excluded via the direction gate, not this rule", () => {
        const result = classifyBudgetTransaction(
            entry({
                type: "transfer",
                accountId: "bank-1",
                cardReference: "cc-1",
                amount: 18000,
            }),
            { creditCardAccountIds: CREDIT_CARDS }
        );

        expect(result).toMatchObject({
            include: false,
            reason: "not-an-expense",
        });
    });
});

describe("classifyBudgetTransaction - loan EMI split", () => {
    const emiInterestByTransactionId = new Map<
        string,
        number
    >([
        ["emi-txn", 2000],
        ["emi-txn-interest-free", 0],
    ]);

    it("counts only the interest portion of a recorded EMI payment", () => {
        const result = classifyBudgetTransaction(
            entry({
                id: "emi-txn",
                amount: 10000, // 8000 principal + 2000 interest
            }),
            { emiInterestByTransactionId }
        );

        expect(result).toEqual({
            include: true,
            amount: 2000,
            reason: "loan-emi-interest",
        });
    });

    it("counts nothing when the EMI instalment is all principal / interest-free", () => {
        const result = classifyBudgetTransaction(
            entry({
                id: "emi-txn-interest-free",
                amount: 10000,
            }),
            { emiInterestByTransactionId }
        );

        expect(result).toEqual({
            include: true,
            amount: 0,
            reason: "loan-emi-principal-only",
        });
    });

    it("treats a transaction not in the map as an ordinary expense", () => {
        const result = classifyBudgetTransaction(
            entry({ id: "plain-txn", amount: 3000 }),
            { emiInterestByTransactionId }
        );

        expect(result).toEqual({
            include: true,
            amount: 3000,
            reason: "expense",
        });
    });

    it("ignores the map for a row with no id", () => {
        const result = classifyBudgetTransaction(
            { ...entry({ amount: 3000 }), id: undefined },
            { emiInterestByTransactionId }
        );

        expect(result.reason).toBe("expense");
        expect(result.amount).toBe(3000);
    });

    it("still excludes an EMI-linked row if it is somehow not an expense", () => {
        const result = classifyBudgetTransaction(
            entry({ id: "emi-txn", type: "transfer" }),
            { emiInterestByTransactionId }
        );

        expect(result.include).toBe(false);
    });
});
