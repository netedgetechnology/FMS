import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { transferCategoryIdSet } from "@/core/accounting/transferClassification";
import type { Category } from "@/modules/categories/types";

import { saveTransactionEdit } from "../components/EditTransactionDialog";
import { replaceTransactionInList } from "../hooks/useTransactions";
import type { Transaction } from "../types";
import type { TransactionFormValues } from "../validation";

import {
    ALL_MAPPING_NAMES,
    computeFilteredTotals,
    computeTransactionSummaryTotals,
    filterTransactionsForList,
    paginateTransactions,
} from "./TransactionsPage";

// ---------------------------------------------------------------------
// Transactions page: saving an edit updates the one edited row in place.
// Regression: onSuccess was refresh(), which sets `loading` - the whole
// list, toolbar and pagination unmounted behind "Loading transactions..."
// and the page lost its scroll position after every save.
//
// No component-render setup exists here (vitest environment "node"), so
// the save step, the in-place list update and the derived totals /
// filters / pages are tested through the pure functions the page uses,
// and the page wiring through its source.
// ---------------------------------------------------------------------

function category(id: string, categoryType: Category["categoryType"]): Category {
    return {
        id, parentId: null, name: id, categoryType, financeScope: "BOTH",
        businessEntityId: null, description: null, isActive: true, createdAt: "", updatedAt: "",
    };
}

const categories = [
    category("cat-sales", "INCOME"),
    category("cat-rent", "EXPENSE"),
    category("cat-transfer", "TRANSFER"),
];
const transferIds = transferCategoryIdSet(categories);
const accountMap = new Map([["bank", "Business Current"]]);
const categoryMap = new Map(categories.map(item => [item.id, item.name]));

function txn(id: string, overrides: Partial<Transaction> = {}): Transaction {
    return {
        id,
        accountId: "bank",
        categoryId: "cat-rent",
        subcategoryId: null,
        payee: `Payee ${id}`,
        counterparty: null,
        branch: null,
        type: "expense",
        transferDirection: null,
        amount: 100,
        transactionDate: "2026-09-10",
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
        sourceStatement: "ICICI 3999",
        externalTransactionId: null,
        originalNarration: `Narration ${id}`,
        createdAt: `2026-09-10T00:00:${id.padStart(2, "0").slice(-2)}.000Z`,
        updatedAt: "2026-09-10T00:00:00.000Z",
        ...overrides,
    } as Transaction;
}

function formValues(overrides: Partial<TransactionFormValues> = {}): TransactionFormValues {
    return {
        accountId: "bank",
        categoryId: "cat-rent",
        subcategoryId: "",
        payee: "Landlord",
        description: "Narration 1",
        type: "expense",
        transferDirection: null,
        amount: 250,
        transactionDate: "2026-09-10",
        referenceNumber: "",
        notes: "",
        tags: "",
        status: "CLEARED",
        paymentMethod: null,
        upiReference: "",
        bankTransactionReference: "",
        cardReference: "",
        ...overrides,
    } as TransactionFormValues;
}

describe("saveTransactionEdit", () => {
    it("saves through TransactionService.update and returns the row as stored", async () => {
        const original = txn("1");
        // The service turned the row into a transfer (TRANSFER category)
        // - the list must show that, not the submitted "expense".
        const stored = txn("1", { categoryId: "cat-transfer", type: "transfer", transferDirection: "OUT" });
        const service = {
            update: vi.fn().mockResolvedValue(undefined),
            getById: vi.fn().mockResolvedValue(stored),
        };

        const result = await saveTransactionEdit(
            service,
            original,
            formValues({ categoryId: "cat-transfer", description: "Edited narration" })
        );

        expect(result).toBe(stored);
        expect(service.getById).toHaveBeenCalledWith("1");
        expect(service.update).toHaveBeenCalledTimes(1);
        const request = service.update.mock.calls[0]![0];
        expect(request).toMatchObject({
            id: "1",
            categoryId: "cat-transfer",
            originalNarration: "Edited narration",
            sourceStatement: "ICICI 3999",
        });
        expect(request).not.toHaveProperty("description");
    });

    it("rejects without reading anything back when the save fails", async () => {
        const service = {
            update: vi.fn().mockRejectedValue(new Error("This category is mapped to Expense.")),
            getById: vi.fn(),
        };

        await expect(
            saveTransactionEdit(service, txn("1"), formValues({ type: "income" }))
        ).rejects.toThrow("This category is mapped to Expense.");
        expect(service.getById).not.toHaveBeenCalled();
    });
});

describe("replaceTransactionInList", () => {
    const list = [txn("3"), txn("2"), txn("1")];

    it("swaps the edited row in place and leaves every other row as it was", () => {
        const edited = txn("2", { amount: 999, payee: "Edited" });
        const next = replaceTransactionInList(list, edited);

        expect(next.map(item => item.id)).toEqual(["3", "2", "1"]);
        expect(next[1]).toBe(edited);
        expect(next[0]).toBe(list[0]);
        expect(next[2]).toBe(list[2]);
        expect(list[1]!.amount).toBe(100); // input not mutated
    });

    it("moves a row whose date changed to where the reloaded list would put it", () => {
        const next = replaceTransactionInList(list, txn("1", { transactionDate: "2026-09-20" }));

        expect(next.map(item => item.id)).toEqual(["1", "3", "2"]);
    });

    it("leaves the list unchanged for an id it does not contain", () => {
        expect(replaceTransactionInList(list, txn("9")).map(item => item.id)).toEqual(["3", "2", "1"]);
    });

    it("keeps a transfer's stored direction and loan/OD-relevant fields exactly", () => {
        const stored = txn("2", { categoryId: "cat-transfer", type: "transfer", transferDirection: "IN", accountId: "bank" });
        const row = replaceTransactionInList(list, stored)[1]!;

        expect(row.type).toBe("transfer");
        expect(row.transferDirection).toBe("IN");
        expect(row.id).toBe("2"); // links are keyed by transaction id
    });
});

describe("derived page data after an in-place edit", () => {
    const sale = txn("1", { categoryId: "cat-sales", type: "income", amount: 1000 });
    const rent = txn("2", { amount: 300 });
    const list = [sale, rent];

    it("summary totals follow an amount change", () => {
        const next = replaceTransactionInList(list, { ...rent, amount: 450 });

        expect(computeTransactionSummaryTotals(next, transferIds)).toMatchObject({
            totalIncome: 1000,
            totalExpense: 450,
        });
    });

    it("summary totals follow a type change (Expense -> Income)", () => {
        const next = replaceTransactionInList(list, { ...rent, type: "income", categoryId: "cat-sales" });

        expect(computeTransactionSummaryTotals(next, transferIds)).toMatchObject({
            totalIncome: 1300,
            totalExpense: 0,
        });
    });

    it("a category change to a Transfer category drops it from Income/Expense but keeps its debit/credit side", () => {
        const next = replaceTransactionInList(list, {
            ...rent,
            categoryId: "cat-transfer",
            type: "transfer",
            transferDirection: "OUT",
        });

        expect(computeTransactionSummaryTotals(next, transferIds)).toMatchObject({
            totalIncome: 1000,
            totalExpense: 0,
        });
        // The filtered Debit/Credit totals still count it on its side.
        expect(computeFilteredTotals(next)).toMatchObject({
            totalDebit: 300,
            totalCredit: 1000,
        });
    });

    it("search filter and page position are unaffected - the row stays on the same page", () => {
        const many = Array.from({ length: 30 }, (_, index) =>
            txn(String(30 - index), { payee: index % 2 === 0 ? "Acme Ltd" : "Other" })
        );
        const filter = { search: "acme", mappingName: ALL_MAPPING_NAMES, dateRange: null };
        const before = paginateTransactions(
            filterTransactionsForList(many, filter, accountMap, categoryMap), 2, 10
        );
        const target = before[3]!;
        const next = replaceTransactionInList(many, { ...target, amount: 12345, categoryId: "cat-transfer" });
        const after = paginateTransactions(
            filterTransactionsForList(next, filter, accountMap, categoryMap), 2, 10
        );

        expect(after.map(item => item.id)).toEqual(before.map(item => item.id));
        expect(after[3]!.amount).toBe(12345);
    });
});

describe("page wiring", () => {
    const pageSource = readFileSync(path.join(__dirname, "TransactionsPage.tsx"), "utf8").replace(/\r\n/g, "\n");
    const dialogSource = readFileSync(
        path.join(__dirname, "../components/EditTransactionDialog.tsx"),
        "utf8"
    ).replace(/\r\n/g, "\n");

    it("a saved edit replaces the row instead of reloading the list", () => {
        const editDialog = pageSource.slice(
            pageSource.indexOf("<EditTransactionDialog"),
            pageSource.indexOf("<DeleteTransactionDialog")
        );

        expect(editDialog).toContain("replaceTransaction(updated)");
        expect(editDialog).not.toMatch(/onSuccess=\{refresh\}/);
    });

    it("closes the popup only after a successful save; a failure keeps it open", () => {
        const submit = dialogSource.slice(dialogSource.indexOf("async function handleSubmit"));
        const tryBlock = submit.slice(0, submit.indexOf("} catch"));
        const catchBlock = submit.slice(submit.indexOf("} catch"), submit.indexOf("} finally"));

        expect(tryBlock.indexOf("onOpenChange(false)")).toBeGreaterThan(tryBlock.indexOf("await onSuccess?.(updated)"));
        expect(catchBlock).toContain("toast.error");
        expect(catchBlock).not.toContain("onOpenChange");
    });

    it("the edit form never resets the user's values on re-render", () => {
        const formSource = readFileSync(
            path.join(__dirname, "../components/TransactionForm.tsx"),
            "utf8"
        );

        expect(formSource).not.toMatch(/\breset\(/);
    });
});
