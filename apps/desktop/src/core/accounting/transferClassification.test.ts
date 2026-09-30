import { describe, expect, it, vi } from "vitest";

import { computeAccountCurrentBalances } from "@/modules/accounts/utils";
import type { Budget } from "@/modules/budgets/types";
import {
    calculateBudgetSpending,
    type BudgetLedgerEntry,
} from "@/modules/budgets/services/budgetSpending";
import { classifyBudgetTransaction } from "@/modules/budgets/services/budgetTransaction";
import type { Category } from "@/modules/categories/types";
import {
    computeCashFlowSeries,
    computeExpensesByCategory,
    computeTopExpenseTransactions,
    DashboardService,
} from "@/modules/dashboard/services/DashboardService";
import { resolveImportCategoryOptions } from "@/modules/imports/pages/importCategoryOptions";
import { ReconciliationService } from "@/modules/reconciliation/services/ReconciliationService";

import {
    isTransferClassified,
    transferCategoryIdSet,
} from "./transferClassification";

// ---------------------------------------------------------------------
// Transfers are neither Income nor Expense - but still move balances.
//
// Scenario (September 2026):
//   A. ₹1,000 Income   - Salary, into Bank
//   B. ₹500   Expense  - Groceries, from Bank
//   C. ₹2,000 Transfer OUT - Bank -> Savings: a Bank DEBIT categorised
//      "Self Transfer" (a TRANSFER category), exactly how an imported
//      statement row is classified as a transfer
//   D. ₹2,000 Transfer IN  - the Savings CREDIT for the same move
//
// Expected: Income ₹1,000, Expense ₹500, Net ₹500, Transfer ₹2,000;
// Bank balance -2,000 and Savings +2,000 from the transfer.
// ---------------------------------------------------------------------

vi.mock("@/core/database/engine/SQLiteProvider", () => ({
    SQLiteProvider: {
        getInstance: () => ({
            select: async () => [],
            execute: async () => undefined,
        }),
    },
}));

function category(id: string, name: string, categoryType: Category["categoryType"]): Category {
    return {
        id,
        parentId: null,
        name,
        categoryType,
        financeScope: "PERSONAL",
        businessEntityId: null,
        description: null,
        isActive: true,
        createdAt: "",
        updatedAt: "",
    };
}

const categories: Category[] = [
    category("cat-salary", "Salary", "INCOME"),
    category("cat-groceries", "Groceries", "EXPENSE"),
    category("cat-self-transfer", "Self Transfer", "TRANSFER"),
];

const transferIds = transferCategoryIdSet(categories);

function txn(
    id: string,
    accountId: string,
    type: "income" | "expense" | "transfer",
    amount: number,
    categoryId: string | null,
    payee: string
) {
    return {
        id,
        accountId,
        categoryId,
        subcategoryId: null,
        payee,
        counterparty: null,
        branch: null,
        type,
        amount,
        transactionDate: "2026-09-10",
        referenceNumber: null,
        notes: null,
        tags: null,
        status: "CLEARED" as const,
        deletedAt: null,
    };
}

const A = txn("A", "bank", "income", 1000, "cat-salary", "Employer");
const B = txn("B", "bank", "expense", 500, "cat-groceries", "Grocer");
const C = txn("C", "bank", "expense", 2000, "cat-self-transfer", "To Savings");
const D = txn("D", "savings", "income", 2000, "cat-self-transfer", "From Bank");

const transactions = [A, B, C, D];
const september = { start: "2026-09-01", end: "2026-09-30" };

const accounts = [
    { id: "bank", name: "Bank", type: "SAVINGS", openingBalance: 10000, isActive: true, currencyId: "INR" },
    { id: "savings", name: "Savings", type: "SAVINGS", openingBalance: 0, isActive: true, currencyId: "INR" },
];

describe("isTransferClassified", () => {
    it("is a transfer by type or by a TRANSFER category (or sub-category)", () => {
        expect(isTransferClassified({ type: "transfer" })).toBe(true);
        expect(isTransferClassified(C, transferIds)).toBe(true);
        expect(isTransferClassified(D, transferIds)).toBe(true);
        expect(
            isTransferClassified(
                { type: "expense", categoryId: "cat-groceries", subcategoryId: "cat-self-transfer" },
                transferIds
            )
        ).toBe(true);
        expect(isTransferClassified(A, transferIds)).toBe(false);
        expect(isTransferClassified(B, transferIds)).toBe(false);
        // Without the category ids only the type can say "transfer".
        expect(isTransferClassified(C)).toBe(false);
    });

    it("collects only TRANSFER-type category ids", () => {
        expect([...transferIds]).toEqual(["cat-self-transfer"]);
    });
});

describe("Dashboard", () => {
    function service(overrides: { transactions?: unknown[] } = {}) {
        const dashboard = new DashboardService();
        const stub = (value: unknown) => ({ getAll: async () => value });

        for (const [field, value] of Object.entries({
            accountService: stub(accounts),
            transactionService: stub(overrides.transactions ?? transactions),
            loanService: stub([]),
            budgetService: stub([]),
            goalService: stub([]),
            investmentService: stub([]),
            categoryService: stub(categories),
            institutionService: stub([]),
            currencyService: stub([]),
            emiScheduleService: { getInterestByTransactionId: async () => new Map() },
            loanPaymentScheduleRepository: { getAllByLoanId: async () => [] },
        })) {
            Object.defineProperty(dashboard, field, { value });
        }

        return dashboard;
    }

    it("summary: Income ₹1,000, Expense ₹500, net ₹500 - the ₹2,000 transfer counts as neither", async () => {
        const summary = await service().getSummary(september);

        expect(summary.income).toBe(1000);
        expect(summary.expenses).toBe(500);
        expect(summary.income - summary.expenses).toBe(500);
        expect(summary.savingsRate).toBe(50);
    });

    it("summary: account balances still include both sides of the transfer", async () => {
        const summary = await service().getSummary(september);
        const balance = (id: string) =>
            summary.accounts.find(a => a.id === id)?.amount;

        expect(balance("bank")).toBe(10000 + 1000 - 500 - 2000);
        expect(balance("savings")).toBe(2000);
        expect(summary.bankBalance).toBe(10000 + 1000 - 500);
    });

    it("a debit transfer is not Expense and a credit transfer is not Income, each on its own", async () => {
        expect((await service({ transactions: [C] }).getSummary(september)).expenses).toBe(0);
        expect((await service({ transactions: [D] }).getSummary(september)).income).toBe(0);
    });

    it("cash flow chart, spending by category and top expenses exclude the transfer", () => {
        const cashFlow = computeCashFlowSeries(transactions, september, undefined, transferIds);

        expect(cashFlow.reduce((sum, p) => sum + p.income, 0)).toBe(1000);
        expect(cashFlow.reduce((sum, p) => sum + p.expense, 0)).toBe(500);

        const names = new Map(categories.map(c => [c.id, c.name]));
        expect(
            computeExpensesByCategory(transactions, names, september, undefined, transferIds)
        ).toEqual([{ name: "Groceries", value: 500 }]);

        expect(
            computeTopExpenseTransactions(transactions, september, undefined, transferIds)
        ).toEqual([{ name: "Grocer", value: 500 }]);
    });

    it("a type 'transfer' transaction is excluded from every total too", () => {
        const typed = txn("E", "bank", "transfer", 2000, null, "Transfer");
        const cashFlow = computeCashFlowSeries([A, B, typed], september);

        expect(cashFlow.reduce((sum, p) => sum + p.income + p.expense, 0)).toBe(1500);
    });
});

describe("Account balances and reconciliation", () => {
    it("the transfer moves money out of Bank and into Savings; net worth is unchanged by it", () => {
        const balances = computeAccountCurrentBalances(accounts, transactions);

        expect(balances.get("bank")).toBe(8500);
        expect(balances.get("savings")).toBe(2000);
        expect((balances.get("bank") ?? 0) + (balances.get("savings") ?? 0)).toBe(10000 + 1000 - 500);
    });

    it("reconciliation's system balance includes the transfer on both accounts", async () => {
        const reconciliation = new ReconciliationService();

        Object.defineProperty(reconciliation, "accountRepository", {
            value: { getById: async (id: string) => accounts.find(a => a.id === id) ?? null },
        });
        Object.defineProperty(reconciliation, "transactionRepository", {
            value: { getAll: async () => transactions },
        });
        Object.defineProperty(reconciliation, "transferRepository", {
            value: { getAllByAccountId: async () => [], getAllByAccountIdUpToDate: async () => [] },
        });

        expect(await reconciliation.calculateAccountBalance("bank")).toBe(8500);
        expect(await reconciliation.calculateAccountBalance("savings")).toBe(2000);
    });
});

describe("Budgets", () => {
    const INR = "INR";

    function budget(overrides: Partial<Budget>): Budget {
        return {
            id: "b",
            name: "b",
            categoryId: null,
            businessEntityId: null,
            amount: 10000,
            periodType: "MONTHLY",
            startDate: "2026-09-01",
            endDate: null,
            currencyId: INR,
            alertThreshold: 80,
            isActive: true,
            createdAt: "",
            updatedAt: "",
            ...overrides,
        };
    }

    const ledger: BudgetLedgerEntry[] = transactions.map(t => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        transactionDate: t.transactionDate,
        categoryId: t.categoryId,
        accountId: t.accountId,
    }));

    it("a transfer never consumes a budget - not even an overall (all-categories) budget", () => {
        const result = calculateBudgetSpending({
            budgets: [
                budget({ id: "overall", categoryId: null }),
                budget({ id: "groceries", categoryId: "cat-groceries", amount: 1000 }),
            ],
            transactions: ledger,
            month: new Date(2026, 8, 15),
            currencyId: INR,
            transferCategoryIds: transferIds,
        });

        expect(result.totalExpense).toBe(500);
        expect(result.lines.find(l => l.budgetId === "overall")?.actualAmount).toBe(500);
        expect(result.lines.find(l => l.budgetId === "groceries")?.actualAmount).toBe(500);
    });

    it("classifies the debit transfer as excluded with reason 'transfer'", () => {
        expect(
            classifyBudgetTransaction(ledger[2], { transferCategoryIds: transferIds })
        ).toEqual({ include: false, amount: 0, reason: "transfer" });
        expect(
            classifyBudgetTransaction(ledger[1], { transferCategoryIds: transferIds }).include
        ).toBe(true);
    });
});

describe("Import", () => {
    it("a Transfer category can be chosen for both Debit and Credit rows in the preview", () => {
        for (const direction of ["expense", "income"] as const) {
            expect(
                resolveImportCategoryOptions({
                    categories,
                    mappings: [],
                    account: { id: "bank", businessEntityId: null },
                    direction,
                    scope: "PERSONAL",
                }).map(option => option.name)
            ).toContain("Self Transfer");
        }
    });

    it("an imported Debit + Credit pair categorised as a transfer adds nothing to Income or Expense", () => {
        // What ImportService books: the direction from Debit/Credit, the
        // category chosen in the preview.
        const importedDebit = txn("I1", "bank", "expense", 750, "cat-self-transfer", "NEFT TO SAVINGS");
        const importedCredit = txn("I2", "savings", "income", 750, "cat-self-transfer", "NEFT FROM BANK");
        const all = [...transactions, importedDebit, importedCredit];

        const cashFlow = computeCashFlowSeries(all, september, undefined, transferIds);

        expect(cashFlow.reduce((sum, p) => sum + p.income, 0)).toBe(1000);
        expect(cashFlow.reduce((sum, p) => sum + p.expense, 0)).toBe(500);

        const balances = computeAccountCurrentBalances(accounts, all);
        expect(balances.get("bank")).toBe(8500 - 750);
        expect(balances.get("savings")).toBe(2000 + 750);
    });
});
