import { DatabaseSync } from "node:sqlite";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { TransactionSchemaMigration } from "@/core/database/migrations/003_transactions";
import { TransactionDetailsMigration } from "@/core/database/migrations/014_transaction_details";
import { TransactionChannelTypeMigration } from "@/core/database/migrations/024_transaction_type";
import { TransactionCounterpartyBranchMigration } from "@/core/database/migrations/025_transaction_counterparty_branch";
import { TransactionTransferDirectionMigration } from "@/core/database/migrations/040_transaction_transfer_direction";
import type { Category } from "@/modules/categories/types";
import { resolveImportCategoryOptions } from "@/modules/imports/pages/importCategoryOptions";
import {
    categoryDirectionLocksFor,
    isRuleCategoryAllowed,
    withoutLockedCategories,
} from "@/modules/imports/services/customImportRules";
import { decideOverdraftForTransaction, type OverdraftMatchState, type OverdraftMatchTransaction } from "@/modules/loans/services/overdraftImportMatching";
import { LoanKind, OverdraftEntryKind, type Loan } from "@/modules/loans/types";
import { TransactionRepository } from "@/modules/transactions/repositories/TransactionRepository";
import { bulkDirectionConflictIds, categoriesForBulkChange } from "@/modules/transactions/services/bulkCategoryChange";
import { TransactionService } from "@/modules/transactions/services/TransactionService";
import type { Transaction } from "@/modules/transactions/types";

const learnRuleFromCorrection = vi.fn();

vi.mock("@/modules/imports/services/learningKey", async importOriginal => ({
    ...(await importOriginal<typeof import("@/modules/imports/services/learningKey")>()),
    learnRuleFromCorrection: (...args: unknown[]) => learnRuleFromCorrection(...args),
}));

// ---------------------------------------------------------------------
// One rule set, everywhere a transaction's category and direction meet:
// a Transfer category with a configured direction (migration 049) means
// that side of the account - In = credit (+), Out = debit (-). The bank
// statement's side of an imported transaction is authoritative. Nothing
// silently reverses a transaction's sign.
//
//   - TransactionService (every Add / Edit / import save): refuses a
//     direction that contradicts the category, or a change of side the
//     statement contradicts; never learns a pattern under such a side;
//   - Bulk Change Category: never changes a sign;
//   - Import: rule / learned categories and the preview's options follow
//     the category's direction (In only on credits, Out only on debits);
//   - Overdraft import matching: principal transfers are matched by
//     their money side.
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

function category(id: string, name: string, categoryType: Category["categoryType"], transferDirection: Category["transferDirection"] = null): Category {
    return {
        id, parentId: null, name, categoryType, transferDirection, financeScope: "BOTH",
        businessEntityId: null, description: null, isActive: true, createdAt: "", updatedAt: "",
    };
}

const categories: Category[] = [
    category("cat-drawdown", "Loan Principal Drawdown", "TRANSFER", "IN"),
    category("cat-repayment", "Loan Principal Repayment", "TRANSFER", "OUT"),
    category("cat-bank-transfer", "Bank Transfer", "TRANSFER", null),
    category("cat-interest", "Loan Interest Charge", "EXPENSE"),
    category("cat-recovered", "Loan Interest Recovered", "INCOME"),
];

const accounts = [
    { id: "bank-3999", businessEntityId: null, openingBalance: 0 },
    { id: "bank-2790", businessEntityId: null, openingBalance: 0 },
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

const base = { accountId: "bank-3999", payee: "TATA Capital", amount: 50000, transactionDate: "2026-09-15", originalNarration: "NEFT/IN00000000000011/TATA CAPITAL LIMITED/ICICI BANK LIMITED/NETEDGE TECHNOLOGY" };

async function load(id: string): Promise<Transaction> {
    return (await new TransactionRepository().getById(id))!;
}

// An imported transaction: the batch is for `statementAccount`, the row
// recorded the statement's Debit/Credit side.
async function imported(side: "income" | "expense", overrides: Record<string, unknown> = {}, statementAccount = "bank-3999") {
    const id = await service().create({ ...base, type: side, categoryId: null, ...overrides });
    sqlite.db!.prepare(`INSERT INTO import_batches (id, account_id) VALUES (?, ?)`).run(`b-${id}`, statementAccount);
    sqlite.db!.prepare(`INSERT INTO import_rows (id, import_batch_id, transaction_id, normalized_data, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run(`r-${id}`, `b-${id}`, id, JSON.stringify({ type: side }), "2026-09-26");
    return id;
}

beforeEach(() => {
    learnRuleFromCorrection.mockReset();
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE accounts (id TEXT PRIMARY KEY); INSERT INTO accounts (id) VALUES ('bank-3999'), ('bank-2790');`);
    for (const migration of [
        TransactionSchemaMigration,
        TransactionDetailsMigration,
        TransactionChannelTypeMigration,
        TransactionCounterpartyBranchMigration,
        TransactionTransferDirectionMigration,
    ]) {
        db.exec(migration.sql);
    }
    db.exec(`
        CREATE TABLE import_batches (id TEXT PRIMARY KEY, account_id TEXT);
        CREATE TABLE import_rows (id TEXT PRIMARY KEY, import_batch_id TEXT, transaction_id TEXT, normalized_data TEXT, created_at TEXT);
        CREATE TABLE overdraft_transaction_links (id TEXT PRIMARY KEY, loan_id TEXT, transaction_id TEXT UNIQUE, entry_kind TEXT, link_source TEXT, created_at TEXT);
    `);
    sqlite.db = db;
});

describe("TransactionService - every save follows the category direction and the statement", () => {
    it("Add: a direction that contradicts the category is refused; the configured one is saved", async () => {
        await expect(service().create({ ...base, type: "transfer", transferDirection: "OUT", categoryId: "cat-drawdown" }))
            .rejects.toThrow('"Loan Principal Drawdown" is for Transfer In (money in), but this would be saved as money out (a debit).');
        // Income / Expense on the category: converted by its side - Expense would be Out.
        await expect(service().create({ ...base, type: "expense", categoryId: "cat-drawdown" })).rejects.toThrow("is for Transfer In");

        const id = await service().create({ ...base, type: "transfer", transferDirection: "IN", categoryId: "cat-drawdown" });
        expect(await load(id)).toMatchObject({ type: "transfer", transferDirection: "IN" });
    });

    it("Edit: a statement credit can be corrected to Drawdown / Transfer In (- becomes +)", async () => {
        const id = await imported("income");
        // The stored side was wrong (as for the TATA credits stored as Expense).
        sqlite.db!.prepare(`UPDATE transactions SET type = 'expense' WHERE id = ?`).run(id);

        await service().update({ id, ...base, type: "transfer", transferDirection: "IN", categoryId: "cat-drawdown" });

        expect(await load(id)).toMatchObject({ type: "transfer", transferDirection: "IN", categoryId: "cat-drawdown", amount: 50000 });
    });

    it("Edit: Repayment on a statement credit is refused (category contradicts the statement)", async () => {
        const id = await imported("income");

        await expect(service().update({ id, ...base, type: "transfer", transferDirection: "OUT", categoryId: "cat-repayment" }))
            .rejects.toThrow("but the bank statement shows this transaction as money in (a credit)");
        expect(await load(id)).toMatchObject({ type: "income", categoryId: null });
    });

    it("Edit: turning a statement credit into money out by hand is refused, even on an either-way category", async () => {
        const id = await imported("income");

        await expect(service().update({ id, ...base, type: "expense", categoryId: "cat-interest" }))
            .rejects.toThrow("The bank statement shows this as money in (a credit); it can't be saved as money out (a debit).");
    });

    it("Edit: a mismatch the row already had does not block an unrelated edit", async () => {
        const id = await imported("income");
        sqlite.db!.prepare(`UPDATE transactions SET type = 'expense' WHERE id = ?`).run(id);

        await service().update({ id, ...base, type: "expense", categoryId: null, notes: "to be corrected" });

        expect(await load(id)).toMatchObject({ type: "expense", notes: "to be corrected" });
    });

    it("Move to another account: the old account's statement no longer applies", async () => {
        const id = await imported("income");

        await service().update({ id, ...base, accountId: "bank-2790", type: "expense", categoryId: "cat-interest" });

        expect(await load(id)).toMatchObject({ accountId: "bank-2790", type: "expense" });
    });

    it("Learning: never learns a pattern under a side the statement contradicts", async () => {
        const id = await imported("income");
        sqlite.db!.prepare(`UPDATE transactions SET type = 'expense' WHERE id = ?`).run(id);

        // An unrelated edit (Payee only) keeps the wrong side: nothing is learned.
        await service().update({ id, ...base, type: "expense", categoryId: null, payee: "TATA Capital Ltd" });
        expect(learnRuleFromCorrection).not.toHaveBeenCalled();

        // Re-categorising while keeping the wrong side is refused outright.
        await expect(service().update({ id, ...base, type: "expense", categoryId: "cat-interest" })).rejects.toThrow("The bank statement shows this as money in");

        // Corrected to the statement's side: learned (as a credit).
        await service().update({ id, ...base, type: "transfer", transferDirection: "IN", categoryId: "cat-drawdown", payee: "TATA Capital OD" });
        expect(learnRuleFromCorrection).toHaveBeenCalledTimes(1);
        expect(learnRuleFromCorrection.mock.calls[0]![2]).toMatch(/^CREDIT\|/);
    });
});

describe("Bulk Change Category never changes a sign", () => {
    const rows = [
        { id: "credit", accountId: "bank-3999", type: "income", categoryId: null },
        { id: "debit", accountId: "bank-3999", type: "expense", categoryId: null },
        { id: "in", accountId: "bank-3999", type: "transfer", transferDirection: "IN", categoryId: "cat-bank-transfer" },
    ] as const;

    it("a directional Transfer category refuses rows on the other side (current side or statement)", () => {
        expect(bulkDirectionConflictIds(categories[0]!, rows)).toEqual(["debit"]); // Drawdown (In)
        expect(bulkDirectionConflictIds(categories[1]!, rows)).toEqual(["credit", "in"]); // Repayment (Out)
        expect(bulkDirectionConflictIds(categories[2]!, rows)).toEqual([]); // either way
        expect(bulkDirectionConflictIds(categories[3]!, rows)).toEqual([]); // Expense category
        // A stored Expense whose statement says credit: refused for Repayment too.
        expect(bulkDirectionConflictIds(categories[1]!, [rows[1]], new Map([["debit", "income"]]))).toEqual(["debit"]);
    });

    it("the dropdown only offers categories valid for every selected row", () => {
        const offered = categoriesForBulkChange(categories, [rows[0], rows[2]], [], new Map()).map(c => c.id);

        expect(offered).toContain("cat-drawdown");
        expect(offered).not.toContain("cat-repayment");
    });

    it("Apply refuses, changing nothing, when a row's statement contradicts the category", async () => {
        const id = await imported("income");
        sqlite.db!.prepare(`UPDATE transactions SET type = 'expense' WHERE id = ?`).run(id); // stored wrong side

        await expect(service().changeCategory([id], "cat-repayment")).rejects.toThrow("move money the other way");
        expect(await load(id)).toMatchObject({ type: "expense", categoryId: null });
    });

    it("Apply works for rows already on the category's side", async () => {
        const id = await imported("income");

        await service().changeCategory([id], "cat-drawdown");

        expect(await load(id)).toMatchObject({ type: "transfer", transferDirection: "IN", categoryId: "cat-drawdown" });
    });
});

describe("Import follows the category direction", () => {
    const locks = categoryDirectionLocksFor([], { id: "bank-3999", businessEntityId: null }, categories);

    it("a directional Transfer category is locked to its statement side", () => {
        expect(locks).toEqual({ "cat-drawdown": "income", "cat-repayment": "expense" });
        expect(isRuleCategoryAllowed("cat-repayment", "income", locks)).toBe(false);
        expect(isRuleCategoryAllowed("cat-drawdown", "income", locks)).toBe(true);
        expect(isRuleCategoryAllowed("cat-bank-transfer", "income", locks)).toBe(true);
    });

    it("a learned category taught under the wrong side is not applied (left Uncategorized)", () => {
        // e.g. CREDIT|NEFT/IN#/TATA CAPITAL... -> Loan Principal Repayment
        const rows = withoutLockedCategories(
            [
                { rowNumber: 1, type: "income" as const, categoryId: "cat-repayment" },
                { rowNumber: 2, type: "income" as const, categoryId: "cat-drawdown" },
                { rowNumber: 3, type: "expense" as const, categoryId: "cat-repayment" },
                { rowNumber: 4, type: "expense" as const, categoryId: "cat-interest" },
            ],
            locks
        );

        expect(rows.map(row => row.categoryId)).toEqual([null, "cat-drawdown", "cat-repayment", "cat-interest"]);
    });

    it("the preview offers Drawdown only on credits and Repayment only on debits", () => {
        const options = (direction: "income" | "expense") =>
            resolveImportCategoryOptions({ categories, mappings: [], account: { id: "bank-3999", businessEntityId: null }, direction, scope: null }).map(o => o.id);

        expect(options("income")).toContain("cat-drawdown");
        expect(options("income")).not.toContain("cat-repayment");
        expect(options("expense")).toContain("cat-repayment");
        expect(options("expense")).not.toContain("cat-drawdown");
        expect(options("income")).toContain("cat-bank-transfer");
    });

    it("an imported credit saved with Drawdown becomes Transfer In; with Repayment the save is refused", async () => {
        const ok = await service().create({ ...base, type: "income", categoryId: "cat-drawdown" });

        expect(await load(ok)).toMatchObject({ type: "transfer", transferDirection: "IN" });
        await expect(service().create({ ...base, type: "income", categoryId: "cat-repayment" })).rejects.toThrow("is for Transfer Out");
    });
});

describe("Overdraft import matching recognises principal transfers", () => {
    function od(): Loan {
        return {
            id: "od-1", accountId: "bank-3999", loanAccountId: "acct-od", lenderInstitutionId: null, loanType: "Overdraft",
            loanKind: LoanKind.OVERDRAFT, creditLimit: 12_500_000, openingUsed: 0, openingUsedAsOf: "2026-01-01",
            linkedAccountIds: ["bank-3999"], name: "TATA Capital (OD)", principalAmount: 0, interestRate: 10.5,
            interestType: "REDUCING", tenureMonths: null, emiAmount: null, startDate: "2026-01-31", maturityDate: null,
            outstandingPrincipal: 0, outstandingInterest: 0, paidInstallments: 0, currencyId: "INR", status: "ACTIVE", createdAt: "", updatedAt: "",
        };
    }

    const drawdownLink = (transaction: Partial<OverdraftMatchTransaction>): OverdraftMatchState => ({
        loan: od(), lenderName: "TATA Capital",
        links: [{
            id: "l1", loanId: "od-1", transactionId: "t1", entryKind: OverdraftEntryKind.DRAWDOWN, linkSource: "MANUAL", createdAt: "",
            transaction: { id: "t1", accountId: "bank-3999", amount: 100000, transactionDate: "2026-09-10", payee: "", originalNarration: "NEFT/IN00000000000012/TATA CAPITAL LIMITED/ICICI BANK LIMITED/NETEDGE TECHNOLOGY", type: "transfer", transferDirection: "IN", ...transaction },
        }],
    });
    const incoming = (overrides: Partial<OverdraftMatchTransaction> = {}): OverdraftMatchTransaction => ({
        id: "new", accountId: "bank-3999", amount: 58000, transactionDate: "2026-09-20", payee: "",
        originalNarration: "NEFT/IN00000000000013/TATA CAPITAL LIMITED/ICICI BANK LIMITED/NETEDGE TECHNOLOGY",
        type: "transfer", transferDirection: "IN", ...overrides,
    });

    it("a Transfer In drawdown matches a pattern the user linked on a Transfer In", () => {
        expect(decideOverdraftForTransaction(incoming(), [drawdownLink({})])).toEqual({ kind: "apply", loanId: "od-1", entryKind: OverdraftEntryKind.DRAWDOWN });
    });

    it("an Income credit and a Transfer In credit are the same side", () => {
        expect(decideOverdraftForTransaction(incoming({ type: "income", transferDirection: null }), [drawdownLink({})]).kind).toBe("apply");
        expect(decideOverdraftForTransaction(incoming(), [drawdownLink({ type: "income", transferDirection: null })]).kind).toBe("apply");
    });

    it("a Transfer Out never matches a drawdown pattern; a transfer with no direction is not matched", () => {
        expect(decideOverdraftForTransaction(incoming({ transferDirection: "OUT" }), [drawdownLink({})]).kind).not.toBe("apply");
        expect(decideOverdraftForTransaction(incoming({ transferDirection: null }), [drawdownLink({})])).toEqual({ kind: "none" });
    });
});
