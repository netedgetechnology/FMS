import { DatabaseSync } from "node:sqlite";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NormalizedTransactionCandidate } from "@financeos/import-engine";

import { TransactionSchemaMigration } from "@/core/database/migrations/003_transactions";
import { FinanceFoundationMigration } from "@/core/database/migrations/004_finance_foundation";
import { ImportDuplicateCountMigration } from "@/core/database/migrations/013_import_duplicate_count";
import { TransactionDetailsMigration } from "@/core/database/migrations/014_transaction_details";
import { TransactionChannelTypeMigration } from "@/core/database/migrations/024_transaction_type";
import { TransactionCounterpartyBranchMigration } from "@/core/database/migrations/025_transaction_counterparty_branch";
import { TransactionTransferDirectionMigration } from "@/core/database/migrations/040_transaction_transfer_direction";
import { computeAccountCurrentBalances } from "@/modules/accounts/utils";
import { classifyBudgetTransaction } from "@/modules/budgets/services/budgetTransaction";
import type { Category } from "@/modules/categories/types";
import {
    computeCashFlowSeries,
    computeExpensesByCategory,
} from "@/modules/dashboard/services/DashboardService";
import {
    ImportService,
    enrichCandidatesWithLearnedRulesDetailed,
} from "@/modules/imports/services/ImportService";
import { applyCustomImportRules } from "@/modules/imports/services/customImportRules";
import type { CustomImportRule } from "@/modules/imports/types";
import { computeTransactionSummaryTotals } from "@/modules/transactions/pages/TransactionsPage";
import { TransactionRepository } from "@/modules/transactions/repositories/TransactionRepository";
import { TransactionService } from "@/modules/transactions/services/TransactionService";
import type { Transaction } from "@/modules/transactions/types";

import {
    isTransferClassified,
    transferCategoryIdSet,
} from "./transferClassification";

// ---------------------------------------------------------------------
// Category-type transfer accounting. A category whose TYPE is TRANSFER
// makes a transaction a transfer (Debit -> Transfer OUT, Credit ->
// Transfer IN); its NAME never matters. Transfers move account balances
// but are never Income, Expense or budget spending. There is no
// account-to-account linking - the category type is the only mechanism.
//
// The real TransactionService / TransactionRepository / ImportService
// SQL runs against an isolated in-memory database built from the app's
// own migrations - never the production database. Only account and
// category lookups (and the learning stores) are stubbed.
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
            async beginTransaction() {
                sqlite.db!.exec("BEGIN");
            },
            async commit() {
                sqlite.db!.exec("COMMIT");
            },
            async rollback() {
                sqlite.db!.exec("ROLLBACK");
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

// Three TRANSFER categories with unrelated names, and an EXPENSE category
// that happens to be named like a transfer - names must not matter.
const categories: Category[] = [
    category("cat-bank-transfer", "Bank Transfer", "TRANSFER"),
    category("cat-cc-payment", "Credit Card Payment", "TRANSFER"),
    category("cat-xyz", "XYZ Test", "TRANSFER"),
    category("cat-cc-payment-expense", "Credit Card Payment (old)", "EXPENSE"),
    category("cat-shopping", "Shopping", "EXPENSE"),
    category("cat-salary", "Salary", "INCOME"),
];

const TRANSFER_CATEGORY_IDS = ["cat-bank-transfer", "cat-cc-payment", "cat-xyz"] as const;

const accounts = [
    { id: "bank-a", name: "Bank A", businessEntityId: null, openingBalance: 50000, currencyId: "INR", isActive: true },
    { id: "bank-b", name: "Bank B", businessEntityId: null, openingBalance: 0, currencyId: "INR", isActive: true },
    { id: "card", name: "Card", businessEntityId: null, openingBalance: 0, currencyId: "INR", isActive: true },
];

function stubLookups(service: TransactionService): TransactionService {
    Object.defineProperty(service, "accountRepository", {
        value: {
            getAll: async () => accounts,
            getById: async (id: string) => accounts.find(a => a.id === id) ?? null,
        },
    });
    Object.defineProperty(service, "categoryRepository", {
        value: {
            getAll: async () => categories,
            getById: async (id: string) => categories.find(c => c.id === id) ?? null,
        },
    });
    Object.defineProperty(service, "categoryContextMappingRepository", {
        value: { getByCategoryId: async () => [] },
    });
    Object.defineProperty(service, "counterpartyRuleRepository", {
        value: { findByAccountAndPattern: async () => null, upsert: async () => null },
    });
    Object.defineProperty(service, "loanSchedulePaymentRepository", {
        value: { getByTransactionId: async () => null },
    });

    return service;
}

function service(): TransactionService {
    return stubLookups(new TransactionService());
}

function create(overrides: Partial<Parameters<TransactionService["create"]>[0]>) {
    return service().create({
        accountId: "bank-a",
        payee: "Payee",
        type: "expense",
        amount: 10000,
        transactionDate: "2026-09-10",
        ...overrides,
    });
}

async function load(id: string): Promise<Transaction> {
    return (await new TransactionRepository().getById(id))!;
}

async function all(): Promise<Transaction[]> {
    return await new TransactionRepository().getAll();
}

const SEPTEMBER = { start: "2026-09-01", end: "2026-09-30" };

// Income / Expense exactly as the Dashboard, the Transactions page and
// Budgets compute them.
function incomeExpense(ledger: readonly Transaction[]) {
    const transferIds = transferCategoryIdSet(categories);
    const cashFlow = computeCashFlowSeries(ledger, SEPTEMBER, undefined, transferIds);
    const summary = computeTransactionSummaryTotals(ledger, transferIds);
    const budget = ledger.reduce(
        (sum, t) => sum + classifyBudgetTransaction(t, { transferCategoryIds: transferIds }).amount,
        0
    );

    return {
        dashboardIncome: cashFlow.reduce((sum, p) => sum + p.income, 0),
        dashboardExpense: cashFlow.reduce((sum, p) => sum + p.expense, 0),
        totalIncome: summary.totalIncome,
        totalExpense: summary.totalExpense,
        budgetSpending: budget,
    };
}

function balances(ledger: readonly Transaction[]) {
    return computeAccountCurrentBalances(accounts, ledger);
}

beforeEach(() => {
    const db = new DatabaseSync(":memory:");

    db.exec(
        `CREATE TABLE accounts (id TEXT PRIMARY KEY);
         INSERT INTO accounts (id) VALUES ('bank-a'), ('bank-b'), ('card');`
    );

    for (const migration of [
        TransactionSchemaMigration,
        FinanceFoundationMigration,
        ImportDuplicateCountMigration,
        TransactionDetailsMigration,
        TransactionChannelTypeMigration,
        TransactionCounterpartyBranchMigration,
        TransactionTransferDirectionMigration,
    ]) {
        db.exec(migration.sql);
    }

    sqlite.db = db;
});

const ZERO = { dashboardIncome: 0, dashboardExpense: 0, totalIncome: 0, totalExpense: 0, budgetSpending: 0 };

const edit = (id: string, categoryId: string | null, type: Transaction["type"]) =>
    service().update({ id, categoryId, type, accountId: "bank-a", amount: 10000, payee: "Payee", transactionDate: "2026-09-10" });

describe("1-4: Debit/Credit on Expense, Income and Transfer categories", () => {
    it("1. Expense category + debit -> Expense", async () => {
        const id = await create({ type: "expense", categoryId: "cat-shopping" });

        expect(await load(id)).toMatchObject({ type: "expense", transferDirection: null });
        expect(incomeExpense(await all())).toEqual({ ...ZERO, dashboardExpense: 10000, totalExpense: 10000, budgetSpending: 10000 });
    });

    it("2. Transfer category + debit -> Transfer OUT, not Expense", async () => {
        const id = await create({ type: "expense", categoryId: "cat-bank-transfer" });

        expect(await load(id)).toMatchObject({ type: "transfer", transferDirection: "OUT" });
        expect(incomeExpense(await all())).toEqual(ZERO);
    });

    it("3. Income category + credit -> Income", async () => {
        const id = await create({ type: "income", categoryId: "cat-salary" });

        expect(await load(id)).toMatchObject({ type: "income", transferDirection: null });
        expect(incomeExpense(await all())).toEqual({ ...ZERO, dashboardIncome: 10000, totalIncome: 10000 });
    });

    it("4. Transfer category + credit -> Transfer IN, not Income", async () => {
        const id = await create({ type: "income", categoryId: "cat-bank-transfer" });

        expect(await load(id)).toMatchObject({ type: "transfer", transferDirection: "IN" });
        expect(incomeExpense(await all())).toEqual(ZERO);
    });
});

describe("5: category TYPE, never name, decides", () => {
    it.each(TRANSFER_CATEGORY_IDS)("%s: Debit -> Transfer OUT, Credit -> Transfer IN, never Income/Expense", async categoryId => {
        const debit = await create({ type: "expense", categoryId });
        const credit = await create({ type: "income", accountId: "bank-b", categoryId });

        expect(await load(debit)).toMatchObject({ type: "transfer", transferDirection: "OUT", amount: 10000 });
        expect(await load(credit)).toMatchObject({ type: "transfer", transferDirection: "IN", amount: 10000 });
        expect(incomeExpense(await all())).toEqual(ZERO);
    });

    it("Bank Transfer, Credit Card Payment and XYZ Test behave identically", async () => {
        const results = [];

        for (const categoryId of TRANSFER_CATEGORY_IDS) {
            const id = await create({ type: "expense", categoryId });
            const { type, transferDirection } = await load(id);
            results.push({ type, transferDirection });
        }

        expect(new Set(results.map(r => JSON.stringify(r))).size).toBe(1);
        expect(results[0]).toEqual({ type: "transfer", transferDirection: "OUT" });
    });

    it("an EXPENSE category named like a transfer is still a plain Expense", async () => {
        const id = await create({ type: "expense", categoryId: "cat-cc-payment-expense" });

        expect(await load(id)).toMatchObject({ type: "expense", transferDirection: null });
        expect(incomeExpense(await all()).totalExpense).toBe(10000);
    });

    it("a row still typed expense on a TRANSFER category is excluded from totals", () => {
        // e.g. a category whose type was later changed to TRANSFER.
        const transferIds = transferCategoryIdSet(categories);

        expect(isTransferClassified({ type: "expense", categoryId: "cat-xyz" }, transferIds)).toBe(true);
        expect(isTransferClassified({ type: "expense", categoryId: "cat-cc-payment-expense" }, transferIds)).toBe(false);
    });
});

describe("6-9: changing the category moves the row in and out of Income/Expense", () => {
    it("6. Expense -> Transfer removes it from Expense (single edit and bulk change)", async () => {
        const single = await create({ type: "expense", categoryId: "cat-shopping" });
        await edit(single, "cat-cc-payment", "expense");

        expect(await load(single)).toMatchObject({ type: "transfer", transferDirection: "OUT" });
        expect(incomeExpense(await all()).totalExpense).toBe(0);

        const bulk = await create({ type: "expense", categoryId: "cat-shopping" });
        await service().changeCategory([bulk], "cat-xyz");

        expect(await load(bulk)).toMatchObject({ type: "transfer", transferDirection: "OUT" });
        expect(incomeExpense(await all())).toEqual(ZERO);
    });

    it("7. Transfer -> Expense adds it back to Expense (single edit and bulk change)", async () => {
        const single = await create({ type: "expense", categoryId: "cat-cc-payment" });
        // Even when the form still sends type "transfer".
        await edit(single, "cat-shopping", "transfer");

        expect(await load(single)).toMatchObject({ type: "expense", transferDirection: null });
        expect(incomeExpense(await all()).totalExpense).toBe(10000);

        const bulk = await create({ type: "expense", categoryId: "cat-xyz" });
        await service().changeCategory([bulk], "cat-shopping");

        expect(await load(bulk)).toMatchObject({ type: "expense", transferDirection: null });
        expect(incomeExpense(await all()).totalExpense).toBe(20000);
    });

    it("8. Income -> Transfer removes it from Income (single edit and bulk change)", async () => {
        const single = await create({ type: "income", categoryId: "cat-salary" });
        await edit(single, "cat-bank-transfer", "income");

        expect(await load(single)).toMatchObject({ type: "transfer", transferDirection: "IN" });

        const bulk = await create({ type: "income", categoryId: "cat-salary" });
        await service().changeCategory([bulk], "cat-xyz");

        expect(await load(bulk)).toMatchObject({ type: "transfer", transferDirection: "IN" });
        expect(incomeExpense(await all())).toEqual(ZERO);
    });

    it("9. Transfer -> Income adds it back to Income (single edit and bulk change)", async () => {
        const single = await create({ type: "income", categoryId: "cat-xyz" });
        await edit(single, "cat-salary", "transfer");

        expect(await load(single)).toMatchObject({ type: "income", transferDirection: null });

        const bulk = await create({ type: "income", categoryId: "cat-bank-transfer" });
        await service().changeCategory([bulk], "cat-salary");

        expect(await load(bulk)).toMatchObject({ type: "income", transferDirection: null });
        expect(incomeExpense(await all())).toMatchObject({ dashboardIncome: 20000, totalIncome: 20000, totalExpense: 0 });
    });

    it("round-trips never move the account balance", async () => {
        const id = await create({ type: "expense", categoryId: "cat-shopping" });
        const before = balances(await all()).get("bank-a");

        await edit(id, "cat-cc-payment", "expense");
        expect(balances(await all()).get("bank-a")).toBe(before);

        await edit(id, "cat-shopping", "transfer");
        expect(balances(await all()).get("bank-a")).toBe(before);
    });
});

describe("10: imports", () => {
    function candidate(rowNumber: number, overrides: Partial<NormalizedTransactionCandidate> = {}): NormalizedTransactionCandidate {
        return {
            rowNumber, transactionDate: "2026-09-10", payee: "", description: `ROW ${rowNumber}`,
            amount: 10000, type: "expense", referenceNumber: null, externalTransactionId: null,
            balance: null, branch: null, transactionType: null, counterparty: null, notes: null, rawData: {},
            ...overrides,
        };
    }

    function importService(): ImportService {
        const imports = new ImportService();

        Object.defineProperty(imports, "transactionService", { value: service() });
        Object.defineProperty(imports, "counterpartyRuleRepository", {
            value: { findByAccountAndPattern: async () => null, upsert: async () => null },
        });
        Object.defineProperty(imports, "customRuleRepository", {
            value: { listByAccount: async () => [], listAll: async () => [] },
        });

        return imports;
    }

    const runImport = (accountId: string, candidates: NormalizedTransactionCandidate[]) =>
        importService().importCandidates(accountId, "statement.pdf", "BANK_PDF", candidates);

    it("a Transfer category chosen in the preview: Debit -> Transfer OUT, Credit -> Transfer IN, for any Transfer category", async () => {
        const batch = await runImport("bank-a", [
            candidate(1, { type: "expense", categoryId: "cat-bank-transfer", description: "NEFT TO B" }),
            candidate(2, { type: "expense", categoryId: "cat-cc-payment", description: "CARD BILL" }),
            candidate(3, { type: "income", categoryId: "cat-xyz", description: "REFUND FROM WALLET" }),
            candidate(4, { type: "expense", categoryId: "cat-shopping", description: "AMAZON" }),
            candidate(5, { type: "income", categoryId: "cat-salary", description: "SALARY" }),
        ]);

        expect(batch).toMatchObject({ importedRows: 5, duplicateRows: 0, failedRows: 0 });

        const byNarration = new Map((await all()).map(t => [t.originalNarration, t]));
        expect(byNarration.get("NEFT TO B")).toMatchObject({ type: "transfer", transferDirection: "OUT" });
        expect(byNarration.get("CARD BILL")).toMatchObject({ type: "transfer", transferDirection: "OUT" });
        expect(byNarration.get("REFUND FROM WALLET")).toMatchObject({ type: "transfer", transferDirection: "IN" });
        expect(byNarration.get("AMAZON")).toMatchObject({ type: "expense", transferDirection: null });
        expect(byNarration.get("SALARY")).toMatchObject({ type: "income", transferDirection: null });
        expect(incomeExpense(await all())).toMatchObject({ totalIncome: 10000, totalExpense: 10000, budgetSpending: 10000 });
        // 50,000 - 10,000 - 10,000 + 10,000 - 10,000 + 10,000
        expect(balances(await all()).get("bank-a")).toBe(40000);
    });

    it("a learned rule's Transfer category is applied the same way", async () => {
        const rules = {
            findByAccountAndPattern: async () => ({
                counterparty: "Card bill", type: null, notes: null, categoryId: "cat-cc-payment",
            }),
        };
        const { candidates } = await enrichCandidatesWithLearnedRulesDetailed(
            "bank-a",
            [candidate(1, { description: "BILLDESK CARD PAYMENT 123" })],
            rules as never
        );

        expect(candidates[0].categoryId).toBe("cat-cc-payment");

        await runImport("bank-a", candidates);
        expect((await all())[0]).toMatchObject({ type: "transfer", transferDirection: "OUT", categoryId: "cat-cc-payment" });
    });

    it("a custom rule's Transfer category is applied the same way", async () => {
        const rule: CustomImportRule = {
            id: "r1", accountId: "bank-a", keyword: "BILLDESK", categoryId: "cat-xyz",
            payee: null, notes: null, transactionType: null, createdAt: "", updatedAt: "",
        };

        const { candidates } = applyCustomImportRules([candidate(1, { description: "BILLDESK CARD PAYMENT 123" })], [rule]);

        expect(candidates[0].categoryId).toBe("cat-xyz");

        await runImport("bank-a", candidates);
        expect((await all())[0]).toMatchObject({ type: "transfer", transferDirection: "OUT", categoryId: "cat-xyz" });
    });

    it("duplicate detection: identical transfer rows in ONE statement both import; a re-import finds them all", async () => {
        const statement = [
            candidate(1, { categoryId: "cat-cc-payment", description: "CARD BILL", referenceNumber: "R1" }),
            candidate(2, { categoryId: "cat-cc-payment", description: "CARD BILL", referenceNumber: "R1" }),
            candidate(3, { type: "income", categoryId: "cat-bank-transfer", description: "FROM B" }),
        ];

        const first = await runImport("bank-a", statement);
        expect(first).toMatchObject({ importedRows: 3, duplicateRows: 0 });

        const second = await runImport("bank-a", statement);
        expect(second).toMatchObject({ importedRows: 0, duplicateRows: 3 });
        expect(await all()).toHaveLength(3);
    });
});

describe("11: existing Bank Transfer behaviour is unchanged", () => {
    it("Bank A -> Bank B 10,000 on Bank Transfer: Income 0, Expense 0; balances move", async () => {
        await create({ accountId: "bank-a", type: "expense", categoryId: "cat-bank-transfer" });
        await create({ accountId: "bank-b", type: "income", categoryId: "cat-bank-transfer" });

        const ledger = await all();

        expect(incomeExpense(ledger)).toEqual(ZERO);
        expect(balances(ledger).get("bank-a")).toBe(40000);
        expect(balances(ledger).get("bank-b")).toBe(10000);
    });

    it("a transfer typed by hand with no category stays a transfer and is excluded", async () => {
        const id = await create({ type: "transfer", transferDirection: "OUT", categoryId: null });

        expect(await load(id)).toMatchObject({ type: "transfer", transferDirection: "OUT" });
        expect(incomeExpense(await all())).toEqual(ZERO);
        expect(balances(await all()).get("bank-a")).toBe(40000);
    });
});

describe("12: account balances for Transfer OUT / IN", () => {
    it("Transfer OUT decreases and Transfer IN increases the balance, with Income = Expense = 0", async () => {
        await create({ accountId: "bank-a", type: "expense", categoryId: "cat-xyz", amount: 7000 });
        await create({ accountId: "bank-a", type: "income", categoryId: "cat-xyz", amount: 2500 });

        const ledger = await all();

        expect(balances(ledger).get("bank-a")).toBe(50000 - 7000 + 2500);
        expect(incomeExpense(ledger)).toEqual(ZERO);
    });

    it("credit card payment: purchase 10,000 + payment 10,000 is 10,000 of Expense, not 20,000; card ends at 0", async () => {
        await create({ accountId: "card", type: "expense", categoryId: "cat-shopping", payee: "Amazon" });
        await create({ accountId: "bank-a", type: "expense", categoryId: "cat-cc-payment", payee: "Card bill" });
        await create({ accountId: "card", type: "income", categoryId: "cat-cc-payment", payee: "Payment received" });

        const ledger = await all();

        expect(incomeExpense(ledger)).toEqual({ ...ZERO, dashboardExpense: 10000, totalExpense: 10000, budgetSpending: 10000 });
        expect(balances(ledger).get("bank-a")).toBe(40000);
        expect(balances(ledger).get("card")).toBe(0);
        // The category breakdown never lists the transfer category.
        expect(
            computeExpensesByCategory(ledger, new Map(categories.map(c => [c.id, c.name])), SEPTEMBER, undefined, transferCategoryIdSet(categories))
        ).toEqual([{ name: "Shopping", value: 10000 }]);
    });
});
