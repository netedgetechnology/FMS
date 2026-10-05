import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { TransactionSchemaMigration } from "@/core/database/migrations/003_transactions";
import { TransactionDetailsMigration } from "@/core/database/migrations/014_transaction_details";
import { TransactionChannelTypeMigration } from "@/core/database/migrations/024_transaction_type";
import { TransactionCounterpartyBranchMigration } from "@/core/database/migrations/025_transaction_counterparty_branch";
import { TransactionTransferDirectionMigration } from "@/core/database/migrations/040_transaction_transfer_direction";
import { computeAccountCurrentBalances } from "@/modules/accounts/utils";
import { classifyBudgetTransaction } from "@/modules/budgets/services/budgetTransaction";
import { computeCashFlowSeries } from "@/modules/dashboard/services/DashboardService";
import type { Category } from "@/modules/categories/types";
import { ImportPreviewRow } from "@/modules/imports/pages/ImportPreviewRow";
import { learningKeyForCandidate } from "@/modules/imports/services/learningKey";
import { ReconciliationService } from "@/modules/reconciliation/services/ReconciliationService";
import { computeFilteredTotals, computeTransactionSummaryTotals } from "@/modules/transactions/pages/TransactionsPage";
import { TransactionService } from "@/modules/transactions/services/TransactionService";
import { TransactionRepository } from "@/modules/transactions/repositories/TransactionRepository";
import type { Transaction } from "@/modules/transactions/types";
import { transactionSchema } from "@/modules/transactions/validation/transactionSchema";

import {
    applyTransferCategoryRule,
    balanceSide,
    transferCategoryIdSet,
    transferDirectionForType,
} from "./transferClassification";
import {
    SEEDED_ACTIVE_PAYMENT_TYPE_OPTIONS,
    SEEDED_PAYMENT_TYPE_LIST,
} from "@/modules/payment-types/testing/seededPaymentTypes";

// ---------------------------------------------------------------------
// Choosing a Transfer category makes a transaction a Transfer. Its
// direction is never entered: it is the Debit/Credit the row had
// (Expense -> OUT, Income -> IN). Amounts are never signed, so an
// income/expense row's direction is its type and a transfer's is
// transfer_direction - exactly one source of direction per row.
//
// TransactionRepository's real SQL runs against an in-memory database
// built from the app's own transactions migrations (003/014/024/025/040);
// SQLiteProvider is mocked to it. Category/account/mapping lookups are
// stubbed on the service.
// ---------------------------------------------------------------------

const sqlite = { db: null as DatabaseSync | null };

vi.mock("@/core/database/engine/SQLiteProvider", () => ({
    SQLiteProvider: {
        getInstance: () => ({
            async select(sql: string, binds: unknown[] = []) {
                return sqlite.db!.prepare(sql).all(...(binds as never[]));
            },
            async execute(sql: string, binds: unknown[] = []) {
                sqlite.db!.prepare(sql).run(...(binds as never[]));
            },
        }),
    },
}));

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
    category("cat-inter-account", "Inter-account Transfer", "TRANSFER"),
];

const accounts = [
    { id: "bank", businessEntityId: null, openingBalance: 10000 },
    { id: "savings", businessEntityId: null, openingBalance: 0 },
];

function service(): TransactionService {
    const s = new TransactionService();

    Object.defineProperty(s, "accountRepository", {
        value: {
            getAll: async () => accounts,
            getById: async (id: string) => accounts.find(a => a.id === id) ?? null,
        },
    });
    Object.defineProperty(s, "categoryRepository", {
        value: {
            getAll: async () => categories,
            getById: async (id: string) => categories.find(c => c.id === id) ?? null,
        },
    });
    Object.defineProperty(s, "categoryContextMappingRepository", {
        value: { getByCategoryId: async () => [] },
    });

    return s;
}

function create(overrides: Partial<Parameters<TransactionService["create"]>[0]>) {
    return service().create({
        accountId: "bank",
        payee: "Payee",
        type: "expense",
        amount: 2000,
        transactionDate: "2026-09-10",
        ...overrides,
    });
}

async function load(id: string): Promise<Transaction> {
    // A fresh repository - i.e. what the app reads after a reload.
    return (await new TransactionRepository().getById(id))!;
}

beforeEach(() => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE accounts (id TEXT PRIMARY KEY); INSERT INTO accounts (id) VALUES ('bank'), ('savings');`);
    for (const migration of [
        TransactionSchemaMigration,
        TransactionDetailsMigration,
        TransactionChannelTypeMigration,
        TransactionCounterpartyBranchMigration,
        TransactionTransferDirectionMigration,
    ]) {
        db.exec(migration.sql);
    }
    sqlite.db = db;
});

describe("the shared rule", () => {
    it("a Transfer category makes a transfer, keeping the Debit/Credit side as its direction", () => {
        expect(applyTransferCategoryRule({ type: "expense" }, true)).toEqual({ type: "transfer", transferDirection: "OUT" });
        expect(applyTransferCategoryRule({ type: "income" }, true)).toEqual({ type: "transfer", transferDirection: "IN" });
        expect(applyTransferCategoryRule({ type: "transfer", transferDirection: "IN" }, true)).toEqual({ type: "transfer", transferDirection: "IN" });
    });

    it("a normal category never changes the type, and never un-does a standalone transfer", () => {
        expect(applyTransferCategoryRule({ type: "expense" }, false)).toEqual({ type: "expense", transferDirection: null });
        expect(applyTransferCategoryRule({ type: "transfer", transferDirection: "OUT" }, false)).toEqual({ type: "transfer", transferDirection: "OUT" });
    });

    it("leaving a Transfer category restores Income/Expense from the direction", () => {
        expect(applyTransferCategoryRule({ type: "transfer", transferDirection: "OUT" }, false, true)).toEqual({ type: "expense", transferDirection: null });
        expect(applyTransferCategoryRule({ type: "transfer", transferDirection: "IN" }, false, true)).toEqual({ type: "income", transferDirection: null });
        // Legacy transfer with no direction: nothing to restore - stays a transfer.
        expect(applyTransferCategoryRule({ type: "transfer", transferDirection: null }, false, true)).toEqual({ type: "transfer", transferDirection: null });
        // Transfer category -> another Transfer category: still a transfer.
        expect(applyTransferCategoryRule({ type: "transfer", transferDirection: "OUT" }, true, true)).toEqual({ type: "transfer", transferDirection: "OUT" });
    });

    it("balance side: income +, expense -, transfer by direction, legacy transfer none", () => {
        expect(balanceSide({ type: "income" })).toBe("income");
        expect(balanceSide({ type: "expense" })).toBe("expense");
        expect(balanceSide({ type: "transfer", transferDirection: "IN" })).toBe("income");
        expect(balanceSide({ type: "transfer", transferDirection: "OUT" })).toBe("expense");
        expect(balanceSide({ type: "transfer", transferDirection: null })).toBeNull();
        expect(transferDirectionForType("expense")).toBe("OUT");
        expect(transferDirectionForType("income")).toBe("IN");
    });
});

describe("Add Transaction", () => {
    it("normal category -> type unchanged", async () => {
        const id = await create({ type: "expense", categoryId: "cat-groceries" });

        expect(await load(id)).toMatchObject({ type: "expense", transferDirection: null });
    });

    it("Transfer category -> saved as Transfer (any Transfer category, not a name)", async () => {
        const out = await create({ type: "expense", categoryId: "cat-bank-transfer" });
        const inn = await create({ type: "income", accountId: "savings", categoryId: "cat-inter-account" });

        expect(await load(out)).toMatchObject({ type: "transfer", transferDirection: "OUT", categoryId: "cat-bank-transfer" });
        expect(await load(inn)).toMatchObject({ type: "transfer", transferDirection: "IN", categoryId: "cat-inter-account" });
    });

    it("the direction the form derived (from Income) is saved", async () => {
        // The form derives IN when the Type goes Income -> Transfer.
        const id = await create({ type: "transfer", transferDirection: "IN", categoryId: "cat-bank-transfer" });

        expect(await load(id)).toMatchObject({ type: "transfer", transferDirection: "IN" });
    });

    it("there is NO user-facing Direction field - the form derives it from the last Income/Expense", () => {
        const form = readFileSync(path.resolve(__dirname, "../../modules/transactions/components/TransactionForm.tsx"), "utf8");

        expect(form).not.toContain("Money out of this account");
        expect(form).not.toContain("Money into this account");
        expect(form).not.toMatch(/label="Direction"/);
        expect(form).not.toMatch(/name="transferDirection"/);
        // Derived: remembered Income/Expense -> OUT/IN when Type becomes Transfer.
        expect(form).toMatch(/lastDebitCreditRef\.current = transactionType;/);
        expect(form).toMatch(/transferDirectionForType\(lastDebitCreditRef\.current\)/);
        // Income/Expense never carries a transfer direction.
        expect(form).toMatch(/if \(getValues\("transferDirection"\) != null\) \{\s+setValue\("transferDirection", null\);/);
    });

    it("the form schema never requires a direction (it is not user input)", () => {
        const base = {
            accountId: "bank", payee: "x", amount: 10, transactionDate: "2026-09-10", status: "CLEARED",
        };

        // e.g. a legacy transfer saved before directions were recorded.
        expect(transactionSchema.safeParse({ ...base, type: "transfer" }).success).toBe(true);
        expect(transactionSchema.safeParse({ ...base, type: "expense" }).success).toBe(true);
    });
});

describe("Edit Transaction", () => {
    it("changing the category to a Transfer category makes it a Transfer - persisted after reload", async () => {
        const id = await create({ type: "expense", categoryId: "cat-groceries" });

        await service().update({ id, categoryId: "cat-bank-transfer", type: "expense", accountId: "bank", amount: 2000, payee: "Payee", transactionDate: "2026-09-10" });

        expect(await load(id)).toMatchObject({ type: "transfer", transferDirection: "OUT", categoryId: "cat-bank-transfer", amount: 2000 });
    });

    it("Transfer category -> normal category restores Income/Expense from the transfer's direction", async () => {
        const credit = await create({ type: "income", categoryId: "cat-bank-transfer" });
        const debit = await create({ type: "expense", categoryId: "cat-bank-transfer" });

        // Even when the caller still sends type "transfer".
        await service().update({ id: credit, categoryId: "cat-salary", type: "transfer", accountId: "bank", amount: 2000, payee: "Payee", transactionDate: "2026-09-10" });
        await service().update({ id: debit, categoryId: "cat-groceries", type: "transfer", accountId: "bank", amount: 2000, payee: "Payee", transactionDate: "2026-09-10" });

        expect(await load(credit)).toMatchObject({ type: "income", transferDirection: null, categoryId: "cat-salary" });
        expect(await load(debit)).toMatchObject({ type: "expense", transferDirection: null, categoryId: "cat-groceries" });
    });

    it("a standalone transfer (typed by hand on a normal category) stays a transfer when the category changes", async () => {
        const id = await create({ type: "transfer", transferDirection: "OUT", categoryId: "cat-groceries" });

        await service().update({ id, categoryId: "cat-salary", type: "transfer", accountId: "bank", amount: 2000, payee: "Payee", transactionDate: "2026-09-10" });

        expect(await load(id)).toMatchObject({ type: "transfer", transferDirection: "OUT", categoryId: "cat-salary" });
    });

    it("switching Type to Transfer without a direction derives it from the row's Debit/Credit", async () => {
        const credit = await create({ type: "income", accountId: "savings", categoryId: "cat-salary" });

        await service().update({ id: credit, type: "transfer", accountId: "savings", amount: 2000, payee: "Payee", transactionDate: "2026-09-10", categoryId: "cat-salary" });

        expect(await load(credit)).toMatchObject({ type: "transfer", transferDirection: "IN" });
    });

    it("editing unrelated fields preserves Type = Transfer and its direction", async () => {
        const id = await create({ type: "expense", categoryId: "cat-bank-transfer" });

        await service().update({ id, type: "transfer", notes: "moved to savings", payee: "To Savings", accountId: "bank", amount: 2000, transactionDate: "2026-09-10", categoryId: "cat-bank-transfer" });

        expect(await load(id)).toMatchObject({ type: "transfer", transferDirection: "OUT", notes: "moved to savings", payee: "To Savings" });
    });

    it("the form keeps a standalone Transfer when a normal category is picked (unless a mapping locks the type)", () => {
        const form = readFileSync(path.resolve(__dirname, "../../modules/transactions/components/TransactionForm.tsx"), "utf8");

        expect(form).toMatch(
            /currentType === "transfer" &&\s+suggestedType !== "transfer" &&\s+!isLockedResolution\(typeResolution\)\s+\) \{\s+return;/
        );
    });

    it("the form restores Income/Expense from the direction when leaving a Transfer category (by type, not name)", () => {
        const form = readFileSync(path.resolve(__dirname, "../../modules/transactions/components/TransactionForm.tsx"), "utf8");

        expect(form).toMatch(/previousCategory\?\.categoryType === "TRANSFER" &&\s+typeResolution\.categoryType !== "TRANSFER"/);
        expect(form).toMatch(/debitCreditTypeForDirection\(\s+getValues\("transferDirection"\)\s+\)/);
    });
});

describe("no conflicting direction state", () => {
    it("an income/expense row never stores a transfer direction, even if one is passed", async () => {
        const id = await create({ type: "expense", transferDirection: "IN", categoryId: "cat-groceries" });

        expect(await load(id)).toMatchObject({ type: "expense", transferDirection: null });
    });

    it("turning a transfer back into Income/Expense clears its direction", async () => {
        const id = await create({ type: "expense", categoryId: "cat-bank-transfer" });
        expect(await load(id)).toMatchObject({ type: "transfer", transferDirection: "OUT" });

        await service().update({ id, type: "income", categoryId: "cat-salary", accountId: "bank", amount: 2000, payee: "Payee", transactionDate: "2026-09-10" });

        expect(await load(id)).toMatchObject({ type: "income", transferDirection: null });
    });

    it("across every stored row, only transfers have a direction", async () => {
        await create({ type: "expense", categoryId: "cat-bank-transfer" });
        await create({ type: "income", categoryId: "cat-bank-transfer" });
        await create({ type: "income", categoryId: "cat-salary", transferDirection: "OUT" });

        expect(
            sqlite.db!.prepare("SELECT COUNT(*) AS n FROM transactions WHERE type <> 'transfer' AND transfer_direction IS NOT NULL").get()
        ).toEqual({ n: 0 });
    });
});

describe("Import", () => {
    it("an imported Debit row with a Transfer category is saved as Transfer OUT; a Credit row as Transfer IN", async () => {
        // What ImportService.executeCandidates passes: the row's Debit/Credit
        // (as expense/income) + the chosen category - no direction input.
        const debit = await create({ type: "expense", categoryId: "cat-bank-transfer", isImported: true, originalNarration: "NEFT TO SAVINGS" });
        const credit = await create({ type: "income", accountId: "savings", categoryId: "cat-bank-transfer", isImported: true, originalNarration: "NEFT FROM BANK" });

        expect(await load(debit)).toMatchObject({ type: "transfer", transferDirection: "OUT", isImported: 1 });
        expect(await load(credit)).toMatchObject({ type: "transfer", transferDirection: "IN", isImported: 1 });
    });

    it("the preview shows the row as a Transfer, keeping its Debit/Credit side", () => {
        const noop = () => {};
        const html = renderToStaticMarkup(
            createElement("table", null, createElement("tbody", null,
                createElement(ImportPreviewRow, {
                    candidate: {
                        rowNumber: 2, transactionDate: "2026-09-10", payee: "To Savings",
                        description: "NEFT/DR/1/SAVINGS/", amount: 2000, type: "expense",
                        referenceNumber: null, externalTransactionId: null, transactionType: null,
                        balance: null, branch: null, counterparty: null, notes: null,
                        categoryId: "cat-bank-transfer", rawData: {},
                    },
                    displayNumber: 1, hasErrors: false, isDuplicate: false, isTransfer: true,
                    indicatorState: "blank", indicatorClickable: false, hasMatchedLearnedRule: false,
                    importing: false, directionCategoryOptions: [], categories, categoriesLoading: false, paymentTypeOptions: SEEDED_ACTIVE_PAYMENT_TYPE_OPTIONS, paymentTypes: SEEDED_PAYMENT_TYPE_LIST,
                    onToggleSelfLearning: noop, onPayeeCommit: noop, onTransactionTypeChange: noop,
                    onCategoryChange: noop, onNotesCommit: noop, onViewDescription: noop,
                })
            ))
        );

        expect(html).toContain("Transfer · Out");
    });

    it("self-learning is unaffected: the learning key still uses the row's Debit/Credit direction", () => {
        const row = { description: "NEFT/DR/1/SAVINGS ACCOUNT TRANSFER/", type: "expense" as const };

        expect(learningKeyForCandidate(row)).toMatch(/^DEBIT\|/);
        // Nothing in the preview changes candidate.type.
        const page = readFileSync(path.resolve(__dirname, "../../modules/imports/pages/ImportsPage.tsx"), "utf8");
        expect(page).toMatch(/isTransfer=\{isTransferClassified\(\s+candidate,\s+transferCategoryIds\s+\)\}/);
    });

    it("a converted transfer is still recognised as a duplicate on re-import", async () => {
        const id = await create({ type: "expense", categoryId: "cat-bank-transfer", referenceNumber: "UTR123", originalNarration: "NEFT TO SAVINGS" });

        const match = await new TransactionRepository().findDuplicate(
            "bank", "2026-09-10", "expense", 2000, "UTR123", "Payee", "NEFT TO SAVINGS"
        );

        expect(match?.id).toBe(id);
        // Wrong direction never matches.
        expect(
            await new TransactionRepository().findDuplicate("bank", "2026-09-10", "income", 2000, "UTR123", "Payee", "NEFT TO SAVINGS")
        ).toBeNull();
    });
});

describe("Summary, balances and reconciliation", () => {
    const tx = (id: string, accountId: string, type: Transaction["type"], amount: number, categoryId: string | null, transferDirection: Transaction["transferDirection"] = null) =>
        ({ id, accountId, type, amount, categoryId, subcategoryId: null, transferDirection, transactionDate: "2026-09-10", status: "CLEARED" }) as Transaction;

    const ledger = [
        tx("A", "bank", "income", 1000, "cat-salary"),
        tx("B", "bank", "expense", 500, "cat-groceries"),
        tx("C", "bank", "transfer", 2000, "cat-bank-transfer", "OUT"),
        tx("D", "savings", "transfer", 2000, "cat-bank-transfer", "IN"),
    ];

    it("Dashboard cash flow and Budgets give a transfer zero Income/Expense", () => {
        const cashFlow = computeCashFlowSeries(ledger, { start: "2026-09-01", end: "2026-09-30" });

        expect(cashFlow.reduce((sum, p) => sum + p.income, 0)).toBe(1000);
        expect(cashFlow.reduce((sum, p) => sum + p.expense, 0)).toBe(500);
        expect(classifyBudgetTransaction({ type: "transfer", amount: 2000, transactionDate: "2026-09-10", categoryId: "cat-bank-transfer", transferDirection: "OUT" }))
            .toEqual({ include: false, amount: 0, reason: "not-an-expense" });
    });

    it("existing Income/Expense transactions are unchanged by any of this", async () => {
        const income = await create({ type: "income", categoryId: "cat-salary", amount: 1000 });
        const expense = await create({ type: "expense", categoryId: "cat-groceries", amount: 500 });

        expect(await load(income)).toMatchObject({ type: "income", transferDirection: null, amount: 1000 });
        expect(await load(expense)).toMatchObject({ type: "expense", transferDirection: null, amount: 500 });
    });

    it("Transfers stay out of Total Income / Expenses / Net", () => {
        expect(computeTransactionSummaryTotals(ledger, transferCategoryIdSet(categories))).toEqual({
            totalIncome: 1000, totalExpense: 500, net: 500,
        });
    });

    it("account balances: the transfer still moves Bank -2,000 and Savings +2,000", () => {
        const balances = computeAccountCurrentBalances(accounts, ledger);

        expect(balances.get("bank")).toBe(10000 + 1000 - 500 - 2000);
        expect(balances.get("savings")).toBe(2000);
    });

    it("converting Debit/Credit rows to transfers leaves every balance exactly as it was", () => {
        const before = [
            tx("C", "bank", "expense", 2000, "cat-bank-transfer"),
            tx("D", "savings", "income", 2000, "cat-bank-transfer"),
        ];
        const after = before.map(t => ({
            ...t,
            ...applyTransferCategoryRule(t, true),
        })) as Transaction[];

        expect(computeAccountCurrentBalances(accounts, after)).toEqual(computeAccountCurrentBalances(accounts, before));
    });

    it("the date-range Debit/Credit totals count transfers by direction, as before", () => {
        expect(computeFilteredTotals(ledger)).toEqual({ totalDebit: 2500, totalCredit: 3000, balance: 500 });
    });

    it("reconciliation's system balance includes the transfers", async () => {
        const reconciliation = new ReconciliationService();
        Object.defineProperty(reconciliation, "accountRepository", {
            value: { getById: async (id: string) => accounts.find(a => a.id === id) ?? null },
        });
        Object.defineProperty(reconciliation, "transactionRepository", { value: { getAll: async () => ledger } });
        Object.defineProperty(reconciliation, "transferRepository", {
            value: { getAllByAccountId: async () => [], getAllByAccountIdUpToDate: async () => [] },
        });

        expect(await reconciliation.calculateAccountBalance("bank")).toBe(8500);
        expect(await reconciliation.calculateAccountBalance("savings")).toBe(2000);
    });

    it("a legacy transfer with no recorded direction still moves no balance (unchanged)", () => {
        const balances = computeAccountCurrentBalances(accounts, [tx("L", "bank", "transfer", 999, null, null)]);

        expect(balances.get("bank")).toBe(10000);
    });
});
