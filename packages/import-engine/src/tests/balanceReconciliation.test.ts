import { describe, expect, it } from "vitest";

import type { NormalizedTransactionCandidate } from "../types";
import {
    balanceMismatchErrors,
    describeBalanceMismatch,
    reconcileBalanceChain,
} from "../validation/balanceReconciliation";

function candidate(
    rowNumber: number,
    transactionDate: string,
    type: NormalizedTransactionCandidate["type"],
    amount: number | null,
    balance: number | null,
): NormalizedTransactionCandidate {
    return {
        rowNumber,
        transactionDate,
        payee: "x",
        description: "x",
        amount,
        type,
        referenceNumber: null,
        externalTransactionId: null,
        transactionType: null,
        balance,
        branch: null,
        counterparty: null,
        notes: null,
        rawData: {},
    };
}

describe("reconcileBalanceChain", () => {
    it("matching running balance: no mismatches", () => {
        expect(
            reconcileBalanceChain([
                candidate(1, "2026-01-01", "income", 100, 100),
                candidate(2, "2026-01-02", "expense", 40, 60),
                candidate(3, "2026-01-03", "income", 0.1, 60.1),
            ]),
        ).toEqual({
            checkedRows: 2,
            mismatchedRowNumbers: [],
            mismatches: [],
            order: "ascending",
        });
    });

    it("walks a newest-first statement in chronological order", () => {
        expect(
            reconcileBalanceChain([
                candidate(1, "2026-01-03", "expense", 40, 60),
                candidate(2, "2026-01-02", "income", 100, 100),
            ]).mismatches,
        ).toEqual([]);
    });

    it("direction mismatch: the opposite direction would reconcile exactly", () => {
        const result = reconcileBalanceChain([
            candidate(1, "2026-01-01", "income", 100, 100),
            candidate(2, "2026-01-02", "income", 40, 60),
        ]);

        expect(result.mismatches).toEqual([
            {
                rowNumber: 2,
                previousRowNumber: 1,
                previousBalance: 100,
                amount: 40,
                type: "income",
                expectedBalance: 140,
                statementBalance: 60,
                difference: -80,
                statementMovement: -40,
                kind: "direction",
            },
        ]);
    });

    it("amount mismatch: the balance moved by a different amount", () => {
        const result = reconcileBalanceChain([
            candidate(1, "2026-01-01", "income", 100, 100),
            candidate(2, "2026-01-02", "expense", 0.5, 60),
        ]);

        expect(result.mismatches).toEqual([
            {
                rowNumber: 2,
                previousRowNumber: 1,
                previousBalance: 100,
                amount: 0.5,
                type: "expense",
                expectedBalance: 99.5,
                statementBalance: 60,
                difference: -39.5,
                statementMovement: -40,
                kind: "amount",
            },
        ]);
    });

    it("multiple mismatches are each reported against their own predecessor (a wrong row never taints the next)", () => {
        const result = reconcileBalanceChain([
            candidate(1, "2026-01-01", "income", 1000, 1000),
            candidate(2, "2026-01-02", "income", 200, 800),
            candidate(3, "2026-01-03", "expense", 50, 750),
            candidate(4, "2026-01-04", "expense", 10, 700),
            candidate(5, "2026-01-05", "income", 300, 1000),
        ]);

        expect(result.checkedRows).toBe(4);
        expect(result.mismatchedRowNumbers).toEqual([2, 4]);
        expect(
            result.mismatches.map((m) => [
                m.rowNumber,
                m.kind,
                m.expectedBalance,
                m.statementBalance,
            ]),
        ).toEqual([
            [2, "direction", 1200, 800],
            [4, "amount", 740, 700],
        ]);
    });

    it("works in cents (no floating-point false mismatches)", () => {
        expect(
            reconcileBalanceChain([
                candidate(1, "2026-01-01", "income", 0.1, 0.1),
                candidate(2, "2026-01-02", "income", 0.2, 0.3),
                candidate(3, "2026-01-03", "expense", 0.1, 0.2),
            ]).mismatches,
        ).toEqual([]);
    });

    it("ambiguous direction (type null) and transfers are skipped, never guessed", () => {
        const result = reconcileBalanceChain([
            candidate(1, "2026-01-01", "income", 100, 100),
            candidate(2, "2026-01-02", null, 40, 60),
            candidate(3, "2026-01-03", "transfer", 10, 50),
            candidate(4, "2026-01-04", "expense", 5, 45),
        ]);

        expect(result.checkedRows).toBe(1);
        expect(result.mismatches).toEqual([]);
    });

    it("restarts the chain after a row with no balance", () => {
        expect(
            reconcileBalanceChain([
                candidate(1, "2026-01-01", "income", 100, 100),
                candidate(2, "2026-01-02", "expense", 5, null),
                candidate(3, "2026-01-03", "expense", 5, 80),
            ]),
        ).toMatchObject({
            checkedRows: 0,
            mismatches: [],
        });
    });

    it("handles thousands of rows in linear time", () => {
        const rows: NormalizedTransactionCandidate[] = [];
        let balance = 0;

        for (let i = 1; i <= 20000; i += 1) {
            balance += i % 2 ? 10 : -3;
            rows.push(
                candidate(
                    i,
                    "2026-01-01",
                    i % 2 ? "income" : "expense",
                    i % 2 ? 10 : 3,
                    balance,
                ),
            );
        }

        const started = performance.now();
        const result = reconcileBalanceChain(rows);

        expect(result.checkedRows).toBe(19999);
        expect(result.mismatches).toEqual([]);
        expect(performance.now() - started).toBeLessThan(500);
    });
});

describe("describeBalanceMismatch / balanceMismatchErrors", () => {
    it("states previous, expected, statement balance and difference, with a direction hint", () => {
        const [mismatch] = reconcileBalanceChain([
            candidate(1, "2026-01-01", "income", 100, 100),
            candidate(2, "2026-01-02", "income", 40, 60),
        ]).mismatches;

        expect(describeBalanceMismatch(mismatch!)).toBe(
            "Balance mismatch: previous balance 100.00 + Income 40.00 = expected 140.00, but the statement shows 60.00 (difference -80.00). The balance moved the opposite way - check whether this row is Income or Expense.",
        );
    });

    it("explains an amount mismatch by the actual movement", () => {
        const [mismatch] = reconcileBalanceChain([
            candidate(1, "2026-01-01", "income", 100, 100),
            candidate(2, "2026-01-02", "expense", 0.5, 60),
        ]).mismatches;

        expect(describeBalanceMismatch(mismatch!)).toBe(
            "Balance mismatch: previous balance 100.00 - Expense 0.50 = expected 99.50, but the statement shows 60.00 (difference -39.50). The balance moved by 40.00, not by this row's amount - check the amount, or skip the row.",
        );

        expect(balanceMismatchErrors([mismatch!])).toEqual([
            {
                rowNumber: 2,
                field: "balance",
                message: describeBalanceMismatch(mismatch!),
            },
        ]);
    });
});
