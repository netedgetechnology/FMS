import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

import {
    computeCashFlowSeries,
    computeExpensesByCategory,
    computeTopExpenseTransactions,
    DEFAULT_DASHBOARD_PERIOD,
    MAX_EXPENSE_TRANSACTIONS,
    rangeFromDays,
    resolveDashboardPeriod,
    type DashboardPeriod,
} from "./DashboardService";

import { colorForIndex, EXPENSE_PALETTE } from "../components/common/expensePalette";

const freezeAt = (iso: string) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
};

let txSequence = 0;

const tx = (
    transactionDate: string,
    type: string,
    amount: number,
    categoryId: string | null = null,
    id?: string,
) => ({
    id: id ?? `tx-${++txSequence}`,
    transactionDate,
    type,
    amount,
    categoryId,
});

describe("resolveDashboardPeriod", () => {
    afterEach(() => vi.useRealTimers());

    it("default period is the last 30 days and matches the main range util", () => {
        freezeAt("2026-09-01T09:00:00");

        expect(DEFAULT_DASHBOARD_PERIOD).toBe("30d");
        expect(resolveDashboardPeriod("30d")).toEqual(rangeFromDays(30));
    });

    it("maps day-based options onto rangeFromDays", () => {
        freezeAt("2026-09-01T00:00:00");

        const days: [DashboardPeriod, number][] = [
            ["7d", 7],
            ["60d", 60],
            ["90d", 90],
            ["180d", 180],
            ["365d", 365],
        ];

        for (const [period, n] of days) {
            expect(resolveDashboardPeriod(period)).toEqual(rangeFromDays(n));
        }
    });

    it("snaps month-based options to calendar boundaries", () => {
        freezeAt("2026-09-15T12:00:00");

        expect(resolveDashboardPeriod("thisMonth")).toEqual({
            start: "2026-09-01",
            end: "2026-09-15",
        });

        expect(resolveDashboardPeriod("lastMonth")).toEqual({
            start: "2026-08-01",
            end: "2026-08-31",
        });

        expect(resolveDashboardPeriod("last3Months")).toEqual({
            start: "2026-07-01",
            end: "2026-09-15",
        });

        expect(resolveDashboardPeriod("last12Months")).toEqual({
            start: "2025-10-01",
            end: "2026-09-15",
        });
    });

    it("produces different ranges for different periods (filters are decoupled)", () => {
        freezeAt("2026-09-01T00:00:00");

        const a = resolveDashboardPeriod("7d");
        const b = resolveDashboardPeriod("365d");

        expect(a).not.toEqual(b);
    });
});

describe("computeCashFlowSeries", () => {
    afterEach(() => vi.useRealTimers());

    it("buckets by day for short ranges, zero-filling gaps", () => {
        const range = { start: "2026-09-01", end: "2026-09-03" };

        const series = computeCashFlowSeries(
            [
                tx("2026-09-01", "income", 1000),
                tx("2026-09-01", "expense", 400),
                tx("2026-09-03", "expense", 250),
                tx("2026-08-31", "income", 9999), // out of range
            ],
            range,
        );

        expect(series).toHaveLength(3);
        expect(series[0]).toMatchObject({ income: 1000, expense: 400 });
        expect(series[1]).toMatchObject({ income: 0, expense: 0 });
        expect(series[2]).toMatchObject({ income: 0, expense: 250 });
        // compact day + short-month label, no year
        expect(series[0].day).toMatch(/^\d{1,2} \p{L}+$/u);
    });

    it("aggregates by calendar month for ranges longer than ~13 weeks", () => {
        const range = { start: "2026-01-01", end: "2026-12-31" };

        const series = computeCashFlowSeries(
            [
                tx("2026-01-10", "income", 500),
                tx("2026-01-20", "expense", 100),
                tx("2026-03-05", "income", 700),
            ],
            range,
        );

        expect(series).toHaveLength(12);
        expect(series[0]).toMatchObject({ income: 500, expense: 100 });
        expect(series[2]).toMatchObject({ income: 700, expense: 0 });
        // short-month + 2-digit-year label
        expect(series[0].day).toMatch(/^\p{L}+ \d{2}$/u);
    });
});

describe("computeExpensesByCategory", () => {
    const names = new Map([
        ["c1", "Groceries"],
        ["c2", "Rent"],
        ["c3", "Fuel"],
    ]);

    const range = { start: "2026-09-01", end: "2026-09-30" };

    it("groups expenses by category, sorted descending, ignoring non-expense and out-of-range", () => {
        const result = computeExpensesByCategory(
            [
                tx("2026-09-02", "expense", 300, "c1"),
                tx("2026-09-05", "expense", 200, "c1"),
                tx("2026-09-05", "expense", 1000, "c2"),
                tx("2026-09-06", "income", 5000, "c1"),
                tx("2026-08-30", "expense", 999, "c3"),
                tx("2026-09-07", "expense", 150, null),
            ],
            names,
            range,
        );

        expect(result).toEqual([
            { name: "Rent", value: 1000 },
            { name: "Groceries", value: 500 },
            { name: "Others", value: 150 },
        ]);
    });

    it("changes with the range (filter is functional)", () => {
        const txns = [
            tx("2026-09-02", "expense", 300, "c1"),
            tx("2026-10-02", "expense", 800, "c2"),
        ];

        const sep = computeExpensesByCategory(txns, names, {
            start: "2026-09-01",
            end: "2026-09-30",
        });
        const oct = computeExpensesByCategory(txns, names, {
            start: "2026-10-01",
            end: "2026-10-31",
        });

        expect(sep).toEqual([{ name: "Groceries", value: 300 }]);
        expect(oct).toEqual([{ name: "Rent", value: 800 }]);
    });
});

describe("computeTopExpenseTransactions", () => {
    const range = { start: "2026-09-01", end: "2026-09-30" };

    const expenseTx = (
        transactionDate: string,
        amount: number,
        payee: string = "Vendor",
        type: string = "expense",
        id?: string,
    ) => ({
        id: id ?? `tx-${++txSequence}`,
        transactionDate,
        type,
        amount,
        payee,
    });

    it("returns only the top 10 transactions, sorted by amount descending, when more than 10 exist", () => {
        const txns = Array.from({ length: 12 }, (_, i) =>
            expenseTx("2026-09-05", i + 1, `Payee ${i + 1}`),
        ); // amounts 1..12

        const result = computeTopExpenseTransactions(txns, range);

        expect(result).toHaveLength(MAX_EXPENSE_TRANSACTIONS);
        expect(result.map((r) => r.value)).toEqual([
            12, 11, 10, 9, 8, 7, 6, 5, 4, 3,
        ]);
    });

    it("filters by the selected period, excluding transactions outside the range", () => {
        const txns = [
            expenseTx("2026-09-05", 300, "In range"),
            expenseTx("2026-10-05", 999999, "Out of range - next month"),
            expenseTx("2026-08-05", 999999, "Out of range - previous month"),
        ];

        const result = computeTopExpenseTransactions(txns, range);

        expect(result).toEqual([{ name: "In range", value: 300 }]);
    });

    it("changes with the range (filter is functional, like computeExpensesByCategory)", () => {
        const txns = [
            expenseTx("2026-09-02", 300, "Sep purchase"),
            expenseTx("2026-10-02", 800, "Oct purchase"),
        ];

        const sep = computeTopExpenseTransactions(txns, {
            start: "2026-09-01",
            end: "2026-09-30",
        });
        const oct = computeTopExpenseTransactions(txns, {
            start: "2026-10-01",
            end: "2026-10-31",
        });

        expect(sep).toEqual([{ name: "Sep purchase", value: 300 }]);
        expect(oct).toEqual([{ name: "Oct purchase", value: 800 }]);
    });

    it("selects expense transactions only, ignoring income and transfers", () => {
        const txns = [
            expenseTx("2026-09-05", 5000, "Salary", "income"),
            expenseTx("2026-09-06", 2000, "Savings transfer", "transfer"),
            expenseTx("2026-09-07", 400, "Groceries", "expense"),
        ];

        const result = computeTopExpenseTransactions(txns, range);

        expect(result).toEqual([{ name: "Groceries", value: 400 }]);
    });

    it("returns all available transactions when fewer than 10 exist", () => {
        const txns = [
            expenseTx("2026-09-01", 300, "A"),
            expenseTx("2026-09-02", 100, "B"),
            expenseTx("2026-09-03", 200, "C"),
        ];

        const result = computeTopExpenseTransactions(txns, range);

        expect(result).toHaveLength(3);
        expect(result.map((r) => r.value)).toEqual([300, 200, 100]);
    });

    it("never produces an 'Others' entry, and the top-10 sum excludes amounts beyond the top 10 (so percentages against it total 100%)", () => {
        // 11 expenses: the smallest (50) falls outside the top 10 and
        // must be dropped entirely, not merged into any bucket.
        const txns = [
            ...Array.from({ length: 10 }, (_, i) =>
                expenseTx("2026-09-05", 100 + i, `Payee ${i}`),
            ), // 100..109
            expenseTx("2026-09-06", 50, "Smallest - dropped"),
        ];

        const result = computeTopExpenseTransactions(txns, range);

        expect(result).toHaveLength(10);
        expect(result.some((r) => r.name === "Others")).toBe(false);

        const top10Sum = result.reduce((sum, r) => sum + r.value, 0);
        const allExpensesSum = txns.reduce((sum, t) => sum + t.amount, 0);

        // sum of the returned top 10 (104.5..109 range) must exclude the
        // dropped 50, so it is strictly less than the sum of all 11.
        expect(top10Sum).toBe(1045); // 100+101+...+109
        expect(top10Sum).toBeLessThan(allExpensesSum);
    });

    it("labels each transaction with its payee, falling back to 'Transaction' when payee is blank", () => {
        const txns = [
            expenseTx("2026-09-05", 500, "Amazon"),
            expenseTx("2026-09-06", 300, ""),
        ];

        const result = computeTopExpenseTransactions(txns, range);

        expect(result).toEqual([
            { name: "Amazon", value: 500 },
            { name: "Transaction", value: 300 },
        ]);
    });
});

describe("expense palette (dynamic colors)", () => {
    it("assigns a distinct colour per category up to the palette size", () => {
        const six = Array.from({ length: 6 }, (_, i) => colorForIndex(i));
        expect(new Set(six).size).toBe(6);
    });

    it("cycles without breaking for more categories than colours", () => {
        const many = Array.from({ length: 30 }, (_, i) => colorForIndex(i));
        expect(many).toHaveLength(30);
        expect(many[0]).toBe(many[EXPENSE_PALETTE.length]);
        expect(many.every((c) => typeof c === "string" && c.startsWith("#"))).toBe(true);
    });
});
