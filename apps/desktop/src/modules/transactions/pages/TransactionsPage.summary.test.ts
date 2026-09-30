import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { transferCategoryIdSet } from "@/core/accounting/transferClassification";
import type { Category } from "@/modules/categories/types";

import type { Transaction } from "../types";

import {
    computeFilteredTotals,
    computeTransactionSummaryTotals,
} from "./TransactionsPage";

// ---------------------------------------------------------------------
// Transactions page summary cards: Total Income / Total Expenses / Net.
// Regression: a transaction whose category is a TRANSFER category (e.g.
// after bulk-changing 33 rows to "Bank Transfer") was still counted as
// Income or Expense. The cards now use the shared transfer rule
// (core/accounting/transferClassification.ts).
// ---------------------------------------------------------------------

function category(id: string, name: string, categoryType: Category["categoryType"]): Category {
    return {
        id, parentId: null, name, categoryType, financeScope: "PERSONAL",
        businessEntityId: null, description: null, isActive: true, createdAt: "", updatedAt: "",
    };
}

const categories: Category[] = [
    category("cat-salary", "Salary", "INCOME"),
    category("cat-groceries", "Groceries", "EXPENSE"),
    category("cat-bank-transfer", "Bank Transfer", "TRANSFER"),
];

const transferIds = transferCategoryIdSet(categories);

function txn(
    id: string,
    type: Transaction["type"],
    amount: number,
    categoryId: string | null,
    subcategoryId: string | null = null
): Transaction {
    return {
        id,
        accountId: id.startsWith("in") ? "savings" : "bank",
        categoryId,
        subcategoryId,
        payee: id,
        counterparty: null,
        branch: null,
        type,
        amount,
        transactionDate: "2026-09-10",
        referenceNumber: null,
        notes: null,
        tags: null,
        status: "CLEARED",
    } as Transaction;
}

const income = txn("income", "income", 1000, "cat-salary");
const expense = txn("expense", "expense", 500, "cat-groceries");
const transferDebit = txn("out", "expense", 2000, "cat-bank-transfer");
const transferCredit = txn("in", "income", 2000, "cat-bank-transfer");

const cards = (transactions: Transaction[]) =>
    computeTransactionSummaryTotals(transactions, transferIds);

describe("Transactions summary cards", () => {
    it("Income ₹1,000 / Expenses ₹500 / Net ₹500 - the ₹2,000 transfer pair counts as neither", () => {
        expect(cards([income, expense, transferDebit, transferCredit])).toEqual({
            totalIncome: 1000,
            totalExpense: 500,
            net: 500,
        });
    });

    it("a transfer debit alone contributes ₹0 to Expenses; a transfer credit alone ₹0 to Income", () => {
        expect(cards([transferDebit])).toEqual({ totalIncome: 0, totalExpense: 0, net: 0 });
        expect(cards([transferCredit])).toEqual({ totalIncome: 0, totalExpense: 0, net: 0 });
    });

    it("normal income and expense still count exactly as before", () => {
        expect(cards([income])).toEqual({ totalIncome: 1000, totalExpense: 0, net: 1000 });
        expect(cards([expense])).toEqual({ totalIncome: 0, totalExpense: 500, net: -500 });
        // No Transfer categories at all -> identical to the old type-only sums.
        expect(
            computeTransactionSummaryTotals([income, expense, transferDebit, transferCredit], new Set())
        ).toEqual({ totalIncome: 3000, totalExpense: 2500, net: 500 });
    });

    it("changing a transaction to / from a Transfer category updates the cards", () => {
        const fuel = txn("fuel", "expense", 700, "cat-groceries");
        expect(cards([income, fuel]).totalExpense).toBe(700);

        // Bulk Change Category -> Bank Transfer: only categoryId changes.
        const toTransfer = { ...fuel, categoryId: "cat-bank-transfer" };
        expect(cards([income, toTransfer])).toEqual({ totalIncome: 1000, totalExpense: 0, net: 1000 });

        // ...and back again.
        const back = { ...toTransfer, categoryId: "cat-groceries" };
        expect(cards([income, back]).totalExpense).toBe(700);
    });

    it("recognises a Transfer sub-category too", () => {
        const viaSubcategory = txn("sub", "expense", 900, "cat-groceries", "cat-bank-transfer");

        expect(cards([expense, viaSubcategory]).totalExpense).toBe(500);
    });

    it("type 'transfer' stays excluded", () => {
        expect(cards([income, txn("t", "transfer", 5000, null)])).toEqual({
            totalIncome: 1000,
            totalExpense: 0,
            net: 1000,
        });
    });

    it("the page uses the shared rule - not its own transfer detection", () => {
        const page = readFileSync(path.resolve(__dirname, "TransactionsPage.tsx"), "utf8");

        expect(page).toContain('from "@/core/accounting/transferClassification"');
        expect(page).toMatch(/transferCategoryIdSet\(categories\)/);
        expect(page).toMatch(/computeTransactionSummaryTotals\(\s+transactions,\s+transferCategoryIds\s+\)/);
        expect(page).toMatch(/net: netAmount/);
        // Cards render the computed values.
        expect(page).toContain("{formatAmount(totalIncome)}");
        expect(page).toContain("{formatAmount(totalExpense)}");
        expect(page).toContain("{formatAmount(netAmount)}");
    });

    it("the date-range Debit/Credit totals are unchanged (type-based, as before)", () => {
        expect(computeFilteredTotals([income, expense, transferDebit, transferCredit])).toEqual({
            totalDebit: 2500,
            totalCredit: 3000,
            balance: 500,
        });
    });
});
