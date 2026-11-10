import { describe, expect, it, vi } from "vitest";

import { computeTransactionSummaryTotals, withoutIds } from "../pages/TransactionsPage";
import type { Transaction } from "../types";

import {
    applySavedTransactions,
    removeTransactionsFromList,
    upsertTransactionsInList,
} from "./useTransactions";

// ---------------------------------------------------------------------
// Transactions page - in-place updates after add / delete / bulk change /
// move / link (the edit case is covered by
// pages/TransactionsPage.editInPlace.test.ts). The page applies saved rows
// to its list instead of calling refresh(), so nothing on the page is
// reset; these are the pure functions it uses.
// ---------------------------------------------------------------------

function txn(id: string, date: string, overrides: Partial<Transaction> = {}): Transaction {
    return {
        id,
        accountId: "bank",
        categoryId: null,
        subcategoryId: null,
        payee: id,
        type: "expense",
        transferDirection: null,
        amount: 100,
        transactionDate: date,
        status: "CLEARED",
        createdAt: `${date}T00:00:00.000Z`,
        updatedAt: `${date}T00:00:00.000Z`,
        ...overrides,
    } as Transaction;
}

const list = [txn("c", "2026-09-03"), txn("b", "2026-09-02"), txn("a", "2026-09-01")];

describe("upsertTransactionsInList", () => {
    it("inserts a new transaction where the reloaded list would put it", () => {
        const next = upsertTransactionsInList(list, [txn("new", "2026-09-02", { createdAt: "2026-09-02T09:00:00.000Z" })]);

        expect(next.map(item => item.id)).toEqual(["c", "new", "b", "a"]);
    });

    it("replaces changed rows in place (bulk category change / move) and keeps order", () => {
        const next = upsertTransactionsInList(list, [
            { ...list[0]!, categoryId: "cat-x" },
            { ...list[2]!, accountId: "other-bank" },
        ]);

        expect(next.map(item => item.id)).toEqual(["c", "b", "a"]);
        expect(next[0]!.categoryId).toBe("cat-x");
        expect(next[2]!.accountId).toBe("other-bank");
        expect(next[1]).toBe(list[1]);
    });

    it("never mutates the current list", () => {
        const before = list.map(item => ({ ...item }));

        upsertTransactionsInList(list, [txn("new", "2026-09-09")]);

        expect(list).toEqual(before);
    });
});

describe("removeTransactionsFromList", () => {
    it("drops deleted rows and keeps the rest in order", () => {
        expect(removeTransactionsFromList(list, ["b"]).map(item => item.id)).toEqual(["c", "a"]);
        expect(removeTransactionsFromList(list, ["a", "c"]).map(item => item.id)).toEqual(["b"]);
        expect(removeTransactionsFromList(list, ["zzz"]).map(item => item.id)).toEqual(["c", "b", "a"]);
    });

    it("updates the summary totals with it", () => {
        const withIncome = [...list, txn("pay", "2026-09-04", { type: "income", amount: 1000 })];

        expect(computeTransactionSummaryTotals(withIncome, new Set())).toMatchObject({ totalIncome: 1000, totalExpense: 300 });
        expect(
            computeTransactionSummaryTotals(removeTransactionsFromList(withIncome, ["b", "pay"]), new Set())
        ).toMatchObject({ totalIncome: 0, totalExpense: 200 });
    });
});

describe("withoutIds (selection after a delete)", () => {
    it("removes only the deleted ids from the selection", () => {
        expect([...withoutIds(new Set(["a", "b", "c"]), ["b"])]).toEqual(["a", "c"]);
        expect([...withoutIds(new Set(["a"]), ["zzz"])]).toEqual(["a"]);
    });
});

describe("applySavedTransactions", () => {
    it("reads the saved rows back and applies them - no refresh", async () => {
        const saved = [txn("a", "2026-09-01", { type: "transfer", transferDirection: "OUT" })];
        const service = { getByIds: vi.fn().mockResolvedValue(saved) };
        const upsert = vi.fn();
        const refresh = vi.fn();

        await applySavedTransactions(service, ["a"], upsert, refresh);

        expect(service.getByIds).toHaveBeenCalledWith(["a"]);
        // As stored - the service's transfer typing, not what was submitted.
        expect(upsert).toHaveBeenCalledWith(saved);
        expect(refresh).not.toHaveBeenCalled();
    });

    it("falls back to a background refresh when a saved row can't be found", async () => {
        const upsert = vi.fn();
        const refresh = vi.fn();

        await applySavedTransactions(
            { getByIds: vi.fn().mockResolvedValue([txn("a", "2026-09-01")]) },
            ["a", "b"],
            upsert,
            refresh
        );

        expect(upsert).toHaveBeenCalledTimes(1);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("never throws when reading back fails - the save already succeeded", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const upsert = vi.fn();
        const refresh = vi.fn();

        await expect(
            applySavedTransactions(
                { getByIds: vi.fn().mockRejectedValue(new Error("database is locked")) },
                ["a"],
                upsert,
                refresh
            )
        ).resolves.toBeUndefined();

        expect(upsert).not.toHaveBeenCalled();
        expect(refresh).toHaveBeenCalledTimes(1);
        consoleError.mockRestore();
    });

    it("does nothing for no ids", async () => {
        const service = { getByIds: vi.fn() };
        const refresh = vi.fn();

        await applySavedTransactions(service, [], vi.fn(), refresh);

        expect(service.getByIds).not.toHaveBeenCalled();
        expect(refresh).not.toHaveBeenCalled();
    });
});
