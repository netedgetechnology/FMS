import { describe, expect, it } from "vitest";

import type { Transaction } from "../types";

import {
    ALL_MAPPING_NAMES,
    computeAvailableMappingNames,
    computeFilteredTotals,
    filterTransactionsForList,
    paginateTransactions,
} from "./TransactionsPage";

function transaction(
    id: string,
    overrides: Partial<Transaction> = {}
): Transaction {
    return {
        id,
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

const emptyMap = new Map<string, string>();

describe("computeAvailableMappingNames", () => {
    it("lists every distinct Mapping Name (sourceStatement) actually used, sorted", () => {
        const names = computeAvailableMappingNames([
            transaction("t1", { sourceStatement: "Axisbank" }),
            transaction("t2", { sourceStatement: "SBI" }),
            transaction("t3", { sourceStatement: "Axisbank" }),
        ]);

        expect(names).toEqual(["Axisbank", "SBI"]);
    });

    it("never includes a manual transaction (sourceStatement null) as a Mapping Name option", () => {
        const names = computeAvailableMappingNames([
            transaction("t1", { sourceStatement: null }),
            transaction("t2", { sourceStatement: "Axisbank" }),
        ]);

        expect(names).toEqual(["Axisbank"]);
    });

    it("returns an empty list when nothing has ever been imported", () => {
        expect(
            computeAvailableMappingNames([
                transaction("t1"),
                transaction("t2"),
            ])
        ).toEqual([]);
    });
});

describe("filterTransactionsForList - Mapping Name filter", () => {
    const axis = transaction("axis-1", {
        sourceStatement: "Axisbank",
        payee: "Limestone Networks",
    });

    const sbi = transaction("sbi-1", {
        sourceStatement: "SBI",
        payee: "Electricity Board",
    });

    const manual = transaction("manual-1", {
        sourceStatement: null,
        payee: "Coffee Shop",
    });

    const all = [axis, sbi, manual];

    it("'All' shows every transaction, manual and imported alike", () => {
        const result = filterTransactionsForList(
            all,
            { search: "", mappingName: ALL_MAPPING_NAMES },
            emptyMap,
            emptyMap
        );

        expect(result).toEqual(all);
    });

    it("selecting a Mapping Name shows only transactions belonging to it", () => {
        const result = filterTransactionsForList(
            all,
            { search: "", mappingName: "Axisbank" },
            emptyMap,
            emptyMap
        );

        expect(result).toEqual([axis]);
    });

    it("a manually created transaction is never shown under an imported Mapping Name filter", () => {
        const result = filterTransactionsForList(
            all,
            { search: "", mappingName: "Axisbank" },
            emptyMap,
            emptyMap
        );

        expect(result).not.toContainEqual(manual);
    });

    it("search works together with the Mapping Name filter (both apply)", () => {
        const searchMatchesBoth = filterTransactionsForList(
            all,
            {
                search: "networks",
                mappingName: ALL_MAPPING_NAMES,
            },
            emptyMap,
            emptyMap
        );

        expect(searchMatchesBoth).toEqual([axis]);

        // Same search text, but scoped to a mapping that doesn't contain
        // the match - narrows to nothing, proving both filters apply
        // together (AND), not just whichever was set last.
        const searchNarrowedByMapping = filterTransactionsForList(
            all,
            { search: "networks", mappingName: "SBI" },
            emptyMap,
            emptyMap
        );

        expect(searchNarrowedByMapping).toEqual([]);
    });
});

describe("filterTransactionsForList - date range filter", () => {
    const before = transaction("before", {
        transactionDate: "2026-07-31",
    });

    const rangeStart = transaction("range-start", {
        transactionDate: "2026-08-01",
    });

    const middle = transaction("middle", {
        transactionDate: "2026-08-15",
    });

    const rangeEnd = transaction("range-end", {
        transactionDate: "2026-08-31",
    });

    const after = transaction("after", {
        transactionDate: "2026-09-01",
    });

    const all = [before, rangeStart, middle, rangeEnd, after];

    it("no applied range (null/undefined) leaves every transaction - existing behavior unchanged", () => {
        expect(
            filterTransactionsForList(
                all,
                {
                    search: "",
                    mappingName: ALL_MAPPING_NAMES,
                    dateRange: null,
                },
                emptyMap,
                emptyMap
            )
        ).toEqual(all);

        expect(
            filterTransactionsForList(
                all,
                { search: "", mappingName: ALL_MAPPING_NAMES },
                emptyMap,
                emptyMap
            )
        ).toEqual(all);
    });

    it("an applied range is inclusive of both the start and end date", () => {
        const result = filterTransactionsForList(
            all,
            {
                search: "",
                mappingName: ALL_MAPPING_NAMES,
                dateRange: {
                    start: "2026-08-01",
                    end: "2026-08-31",
                },
            },
            emptyMap,
            emptyMap
        );

        expect(result).toEqual([rangeStart, middle, rangeEnd]);
    });

    it("excludes transactions strictly outside the range on either side", () => {
        const result = filterTransactionsForList(
            all,
            {
                search: "",
                mappingName: ALL_MAPPING_NAMES,
                dateRange: {
                    start: "2026-08-01",
                    end: "2026-08-31",
                },
            },
            emptyMap,
            emptyMap
        );

        expect(result).not.toContainEqual(before);
        expect(result).not.toContainEqual(after);
    });

    it("combines with search using AND logic", () => {
        const namedMiddle = transaction("named-middle", {
            transactionDate: "2026-08-15",
            payee: "Limestone Networks",
        });

        const namedOutOfRange = transaction("named-out-of-range", {
            transactionDate: "2026-09-15",
            payee: "Limestone Networks",
        });

        const result = filterTransactionsForList(
            [namedMiddle, namedOutOfRange],
            {
                search: "networks",
                mappingName: ALL_MAPPING_NAMES,
                dateRange: {
                    start: "2026-08-01",
                    end: "2026-08-31",
                },
            },
            emptyMap,
            emptyMap
        );

        expect(result).toEqual([namedMiddle]);
    });

    it("combines with the Mapping Name filter using AND logic", () => {
        const axisInRange = transaction("axis-in-range", {
            transactionDate: "2026-08-15",
            sourceStatement: "Axisbank",
        });

        const axisOutOfRange = transaction("axis-out-of-range", {
            transactionDate: "2026-09-15",
            sourceStatement: "Axisbank",
        });

        const result = filterTransactionsForList(
            [axisInRange, axisOutOfRange],
            {
                search: "",
                mappingName: "Axisbank",
                dateRange: {
                    start: "2026-08-01",
                    end: "2026-08-31",
                },
            },
            emptyMap,
            emptyMap
        );

        expect(result).toEqual([axisInRange]);
    });
});

describe("computeFilteredTotals", () => {
    it("Total Debit sums expenses, Total Credit sums income, Balance = credit - debit", () => {
        const totals = computeFilteredTotals([
            transaction("t1", { type: "expense", amount: 300 }),
            transaction("t2", { type: "income", amount: 1000 }),
            transaction("t3", { type: "expense", amount: 200 }),
        ]);

        expect(totals.totalDebit).toBe(500);
        expect(totals.totalCredit).toBe(1000);
        expect(totals.balance).toBe(500);
    });

    it("ignores transfers, matching the existing totalIncome/totalExpense convention", () => {
        const totals = computeFilteredTotals([
            transaction("t1", { type: "transfer", amount: 5000 }),
            transaction("t2", { type: "income", amount: 100 }),
        ]);

        expect(totals.totalDebit).toBe(0);
        expect(totals.totalCredit).toBe(100);
        expect(totals.balance).toBe(100);
    });

    it("totals use every filtered transaction, not just what a single page would hold", () => {
        const manyExpenses = Array.from(
            { length: 75 },
            (_, index) =>
                transaction(`t${index}`, {
                    type: "expense",
                    amount: 10,
                })
        );

        // 75 rows is more than a single default (50-row) page - the
        // helper receives the full filtered list, unpaginated, and must
        // sum all of it.
        expect(
            computeFilteredTotals(manyExpenses).totalDebit
        ).toBe(750);
    });

    it("'All' totals cover every transaction, imported and manual alike", () => {
        const all = [
            transaction("axis-1", {
                sourceStatement: "Axisbank",
                type: "expense",
                amount: 400,
            }),
            transaction("manual-1", {
                sourceStatement: null,
                type: "income",
                amount: 900,
            }),
        ];

        const filtered = filterTransactionsForList(
            all,
            { search: "", mappingName: ALL_MAPPING_NAMES },
            emptyMap,
            emptyMap
        );

        const totals = computeFilteredTotals(filtered);

        expect(totals.totalDebit).toBe(400);
        expect(totals.totalCredit).toBe(900);
        expect(totals.balance).toBe(500);
    });
});

describe("paginateTransactions", () => {
    const rows = Array.from({ length: 25 }, (_, index) =>
        transaction(`t${index + 1}`)
    );

    it("slices to the requested page size", () => {
        expect(paginateTransactions(rows, 1, 10)).toHaveLength(10);
        expect(paginateTransactions(rows, 1, 10)[0].id).toBe("t1");

        expect(paginateTransactions(rows, 2, 10)).toHaveLength(10);
        expect(paginateTransactions(rows, 2, 10)[0].id).toBe("t11");

        // Last page holds only the remainder.
        expect(paginateTransactions(rows, 3, 10)).toHaveLength(5);
    });

    it("'All' rows-per-page returns every filtered row, unpaginated", () => {
        expect(paginateTransactions(rows, 1, "All")).toHaveLength(
            25
        );
    });

    it("page count/contents follow the filtered list, not the unfiltered one", () => {
        const filtered = rows.slice(0, 3);

        expect(paginateTransactions(filtered, 1, 10)).toEqual(
            filtered
        );
    });
});
