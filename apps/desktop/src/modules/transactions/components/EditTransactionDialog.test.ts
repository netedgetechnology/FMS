import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

import type { Transaction } from "../types";

import { getDefaultValues } from "./EditTransactionDialog";

function transaction(
    overrides: Partial<Transaction> = {}
): Transaction {
    return {
        id: "txn-1",
        accountId: "account-1",
        categoryId: null,
        subcategoryId: null,
        payee: "Test Payee",
        counterparty: null,
        branch: null,
        type: "expense",
        amount: 100,
        transactionDate: "2026-08-01",
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
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        ...overrides,
    };
}

describe("EditTransactionDialog.getDefaultValues - Transaction Date", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("1. shows the transaction's own stored date, never today's date, even when they differ", () => {
        // "Today" is deliberately different from the stored date, so
        // this fails if Edit ever starts defaulting to today the way
        // Add does.
        vi.setSystemTime(new Date("2026-09-19T12:00:00.000Z"));

        const values = getDefaultValues(
            transaction({ transactionDate: "2026-08-01" })
        );

        expect(values.transactionDate).toBe("2026-08-01");
    });

    it("2. passes the stored date through unchanged - it's a direct read, not a reformat/recompute", () => {
        const values = getDefaultValues(
            transaction({ transactionDate: "2026-01-15" })
        );

        expect(values.transactionDate).toBe("2026-01-15");
    });
});
