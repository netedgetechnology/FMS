import { describe, expect, it } from "vitest";

import type { Transaction } from "../types";

import { ALL_MAPPING_NAMES, filterTransactionsForList, paginateTransactions } from "./TransactionsPage";

// ---------------------------------------------------------------------
// Transactions search by amount, through the same filter the list uses
// (with Mapping Name, date range and pagination). Synthetic rows only.
// ---------------------------------------------------------------------

function transaction(id: string, overrides: Partial<Transaction> = {}): Transaction {
    return {
        id,
        accountId: "account-1",
        categoryId: null,
        subcategoryId: null,
        payee: "Synthetic Payee",
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

const accounts = new Map([["account-1", "SYN Bank Current"]]);
const categories = new Map([["cat-food", "Food"]]);

const expense = transaction("expense-10004", { type: "expense", amount: 10004, payee: "SYN Grocer", transactionDate: "2026-08-03", sourceStatement: "Axisbank" });
const income = transaction("income-10004", { type: "income", amount: 10004, payee: "SYN Employer", transactionDate: "2026-08-02", sourceStatement: "SBI" });
const negative = transaction("negative-10004", { type: "expense", amount: -10004, payee: "SYN Refund", transactionDate: "2026-08-01", sourceStatement: "Axisbank" });
const bigger = transaction("bigger-110004", { amount: 110004, payee: "SYN Big" });
const paise = transaction("paise-10004.50", { amount: 10004.5, payee: "SYN Paise" });
const near = transaction("near-10005", { amount: 10005, payee: "SYN Near" });
const tenThousand = transaction("ten-thousand", { amount: 10000, payee: "SYN Ten" });
const food = transaction("food", { amount: 250, payee: "SYN Cafe", categoryId: "cat-food", notes: "lunch" });

const all = [expense, income, negative, bigger, paise, near, tenThousand, food];

const search = (text: string, extra: { mappingName?: string; dateRange?: { start: string; end: string } | null } = {}) =>
    filterTransactionsForList(all, { search: text, mappingName: extra.mappingName ?? ALL_MAPPING_NAMES, dateRange: extra.dateRange ?? null }, accounts, categories).map(row => row.id);

describe("Transactions search by amount", () => {
    it.each(["10004", "10,004", "10004.00", "10,004.00", "₹10,004", "₹10,004.00"])("%s finds every 10,004.00 transaction - income, expense and a negative amount - and nothing else", query => {
        expect(search(query)).toEqual(["expense-10004", "income-10004", "negative-10004"]);
    });

    it("never matches longer or nearby amounts", () => {
        const found = search("10,004");
        for (const id of ["bigger-110004", "paise-10004.50", "near-10005", "ten-thousand"]) expect(found).not.toContain(id);
        expect(search("10,004.50")).toEqual(["paise-10004.50"]);
        expect(search("1,10,004")).toEqual(["bigger-110004"]);
        expect(search("110,004")).toEqual(["bigger-110004"]);
    });

    it("works together with the Mapping Name and date range filters", () => {
        expect(search("10,004", { mappingName: "Axisbank" })).toEqual(["expense-10004", "negative-10004"]);
        expect(search("₹10,004.00", { mappingName: "SBI" })).toEqual(["income-10004"]);
        expect(search("10004", { dateRange: { start: "2026-08-02", end: "2026-08-03" } })).toEqual(["expense-10004", "income-10004"]);
        expect(search("10004", { mappingName: "SBI", dateRange: { start: "2026-08-03", end: "2026-08-31" } })).toEqual([]);
    });

    it("keeps the list's order, and pages the result like any search", () => {
        const found = filterTransactionsForList(all, { search: "10,004", mappingName: ALL_MAPPING_NAMES }, accounts, categories);
        expect(paginateTransactions(found, 1, 2).map(row => row.id)).toEqual(["expense-10004", "income-10004"]);
        expect(paginateTransactions(found, 2, 2).map(row => row.id)).toEqual(["negative-10004"]);
        // Reversed input order stays reversed: the filter never re-sorts.
        const reversed = filterTransactionsForList([...all].reverse(), { search: "10004", mappingName: ALL_MAPPING_NAMES }, accounts, categories);
        expect(reversed.map(row => row.id)).toEqual(["negative-10004", "income-10004", "expense-10004"]);
    });

    it("text search is unchanged: payee, notes, category and account still match", () => {
        expect(search("cafe")).toEqual(["food"]);
        expect(search("lunch")).toEqual(["food"]);
        expect(search("food")).toEqual(["food"]);
        expect(search("syn grocer")).toEqual(["expense-10004"]);
        expect(search("SYN Bank Current")).toHaveLength(all.length);
    });

    it("a number that also appears in a text field still finds that text match (existing behaviour)", () => {
        const withReference = transaction("ref", { amount: 55, referenceNumber: "UPI-10004-XYZ" });
        const found = filterTransactionsForList([withReference, expense], { search: "10004", mappingName: ALL_MAPPING_NAMES }, accounts, categories).map(row => row.id);
        expect(found).toEqual(["ref", "expense-10004"]);
    });
});
