import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { TransactionSchemaMigration } from "@/core/database/migrations/003_transactions";
import { TransactionDetailsMigration } from "@/core/database/migrations/014_transaction_details";
import { TransactionChannelTypeMigration } from "@/core/database/migrations/024_transaction_type";
import { TransactionCounterpartyBranchMigration } from "@/core/database/migrations/025_transaction_counterparty_branch";
import { TransactionTransferDirectionMigration } from "@/core/database/migrations/040_transaction_transfer_direction";
import { balanceSide, transferCategoryIdSet } from "@/core/accounting/transferClassification";
import { signedTransactionAmount } from "@/core/formatting/signedTransactionAmount";
import { resolveCategoryTransactionType } from "@/modules/categories/utils/resolveCategoryTransactionType";
import type { Category, CategoryContextMapping } from "@/modules/categories/types";

import { computeTransactionSummaryTotals } from "../pages/TransactionsPage";
import { TransactionRepository } from "../repositories/TransactionRepository";
import { TransactionService } from "../services/TransactionService";
import type { Transaction } from "../types";

import {
    derivationSideFor,
    directionChecks,
    finalTyping,
    initialDebitCreditSide,
    sideOf,
    typeForSelectedCategory,
} from "./transactionFormTyping";

// ---------------------------------------------------------------------
// Add / Edit Transaction: selecting a category sets the Transaction Type
// to the category's type, and a Transfer category with a configured
// direction (categories.transfer_direction, migration 049) sets that
// direction. The bank statement stays authoritative: a category whose
// direction contradicts it blocks saving.
//
// The form's effects can't run here (vitest environment "node", no
// component rendering), so the rules are tested through the pure
// functions the form calls - composed in the same order the form uses
// them - the form's wiring through its source, and saving through
// TransactionService + TransactionRepository against an in-memory
// database built from the app's own migrations.
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

function category(
    id: string,
    name: string,
    categoryType: Category["categoryType"],
    transferDirection: Category["transferDirection"] = null
): Category {
    return {
        id, parentId: null, name, categoryType, transferDirection, financeScope: "BOTH",
        businessEntityId: null, description: null, isActive: true, createdAt: "", updatedAt: "",
    };
}

// Names are only labels - the rules read the configuration.
const categories: Category[] = [
    category("cat-interest", "Loan Interest Charge", "EXPENSE"),
    category("cat-recovered", "Loan Interest Recovered", "INCOME"),
    category("cat-drawdown", "Loan Principal Drawdown", "TRANSFER", "IN"),
    category("cat-repayment", "Loan Principal Repayment", "TRANSFER", "OUT"),
    category("cat-installment", "Loan Installment", "EXPENSE"),
    category("cat-bank-transfer", "Bank Transfer", "TRANSFER", null), // either way
];

const byId = (id: string) => categories.find(item => item.id === id)!;
const directionOf = (id: string) => (byId(id).categoryType === "TRANSFER" ? byId(id).transferDirection ?? null : null);

function mapping(categoryId: string, categoryType: "INCOME" | "EXPENSE"): CategoryContextMapping {
    return {
        id: `m-${categoryId}`, categoryId, accountId: null, businessEntityId: "entity-1",
        categoryType, isActive: true, createdAt: "", updatedAt: "",
    };
}

function typeOnSelecting(categoryId: string, mappings: CategoryContextMapping[] = []) {
    return typeForSelectedCategory(
        resolveCategoryTransactionType({
            categoryId,
            accountId: "bank-3999",
            businessEntityId: "entity-1",
            mappings,
            categories,
        }).categoryType
    );
}

// What the form does when a category is chosen, and what it then saves
// and reports - the same functions, in the same order, as TransactionForm.
function choose(params: {
    categoryId: string;
    shownType: "income" | "expense" | "transfer";
    savedDirection?: "IN" | "OUT" | null;
    statementSide?: "income" | "expense" | null;
    manualSide?: "income" | "expense" | null;
    linkedMovementKind?: string | null;
}) {
    const categoryDirection = directionOf(params.categoryId);
    const type = typeOnSelecting(params.categoryId) ?? params.shownType;
    const derivation = derivationSideFor({
        manualSide: params.manualSide ?? null, // a new category clears it
        categoryDirection,
        statementSide: params.statementSide ?? null,
        shownSide: params.shownType === "transfer" ? null : params.shownType,
    });
    const transferDirection =
        type === "transfer"
            ? categoryDirection ?? params.savedDirection ?? (derivation === "income" ? "IN" : derivation === "expense" ? "OUT" : null)
            : null;
    const saved = finalTyping({
        type,
        transferDirection,
        isTransferCategory: byId(params.categoryId).categoryType === "TRANSFER",
        derivationSide: derivation,
    });
    const checks = directionChecks({
        savedSide: sideOf(saved.type, saved.transferDirection),
        statementSide: params.statementSide ?? null,
        categoryName: byId(params.categoryId).name,
        categoryDirection,
        linkedMovementKind: params.linkedMovementKind ?? null,
    });

    return { type, saved, checks, sign: Math.sign(signedTransactionAmount(100, balanceSide(saved))) };
}

describe("selecting a category sets the Type to the category's type", () => {
    it("Expense -> Expense, Income -> Income, Transfer -> Transfer", () => {
        expect(typeOnSelecting("cat-interest")).toBe("expense");
        expect(typeOnSelecting("cat-installment")).toBe("expense");
        expect(typeOnSelecting("cat-recovered")).toBe("income");
        expect(typeOnSelecting("cat-drawdown")).toBe("transfer");
        expect(typeOnSelecting("cat-repayment")).toBe("transfer");
    });

    it("no category (None) leaves the Type as it is", () => {
        expect(typeForSelectedCategory(null)).toBeNull();
    });

    it("an account / business-entity lock wins over the category's own type", () => {
        expect(typeOnSelecting("cat-installment", [mapping("cat-installment", "EXPENSE")])).toBe("expense");
        expect(typeOnSelecting("cat-drawdown", [mapping("cat-drawdown", "INCOME")])).toBe("income");
    });
});

describe("a principal category sets the intended direction", () => {
    it("Drawdown (configured In) -> Transfer In, positive - whatever the row showed", () => {
        for (const shownType of ["expense", "income"] as const) {
            const result = choose({ categoryId: "cat-drawdown", shownType });

            expect(result.saved).toEqual({ type: "transfer", transferDirection: "IN" });
            expect(result.sign).toBe(1);
            expect(result.checks).toEqual({ blocking: [], warnings: [] });
        }
    });

    it("Repayment (configured Out) -> Transfer Out, negative - whatever the row showed", () => {
        for (const shownType of ["expense", "income"] as const) {
            const result = choose({ categoryId: "cat-repayment", shownType });

            expect(result.saved).toEqual({ type: "transfer", transferDirection: "OUT" });
            expect(result.sign).toBe(-1);
        }
    });

    it("switching straight between the two updates the direction (the Type stays Transfer)", () => {
        expect(choose({ categoryId: "cat-drawdown", shownType: "transfer", savedDirection: "OUT" }).saved.transferDirection).toBe("IN");
        expect(choose({ categoryId: "cat-repayment", shownType: "transfer", savedDirection: "IN" }).saved.transferDirection).toBe("OUT");
    });

    it("a category with no direction (either way) keeps the existing derivation", () => {
        expect(choose({ categoryId: "cat-bank-transfer", shownType: "expense" }).saved).toEqual({ type: "transfer", transferDirection: "OUT" });
        expect(choose({ categoryId: "cat-bank-transfer", shownType: "income" }).saved).toEqual({ type: "transfer", transferDirection: "IN" });
        expect(choose({ categoryId: "cat-bank-transfer", shownType: "expense", statementSide: "income" }).saved).toEqual({ type: "transfer", transferDirection: "IN" });
    });

    it("derivation order: manual pick > category direction > statement > side shown", () => {
        expect(derivationSideFor({ manualSide: "expense", categoryDirection: "IN", statementSide: "income", shownSide: "income" })).toBe("expense");
        expect(derivationSideFor({ manualSide: null, categoryDirection: "OUT", statementSide: "income", shownSide: "income" })).toBe("expense");
        expect(derivationSideFor({ manualSide: null, categoryDirection: null, statementSide: "income", shownSide: "expense" })).toBe("income");
        expect(derivationSideFor({ manualSide: null, categoryDirection: null, statementSide: null, shownSide: "expense" })).toBe("expense");
        expect(initialDebitCreditSide("transfer", null)).toBeNull();
    });
});

describe("the bank statement is authoritative - a conflicting category blocks saving", () => {
    it("Drawdown + statement credit = Transfer In, no conflict", () => {
        expect(choose({ categoryId: "cat-drawdown", shownType: "expense", statementSide: "income" }).checks).toEqual({ blocking: [], warnings: [] });
    });

    it("Repayment + statement debit = Transfer Out, no conflict", () => {
        expect(choose({ categoryId: "cat-repayment", shownType: "expense", statementSide: "expense", linkedMovementKind: "REPAYMENT" }).checks)
            .toEqual({ blocking: [], warnings: [] });
    });

    it("Repayment + statement credit = blocked, explained", () => {
        const { checks } = choose({ categoryId: "cat-repayment", shownType: "expense", statementSide: "income" });

        expect(checks.blocking).toEqual([
            '"Loan Principal Repayment" is for Transfer Out (money out), but the bank statement shows this transaction as money in (a credit). Choose a category that matches the statement before saving.',
        ]);
    });

    it("Drawdown + statement debit = blocked, explained", () => {
        const { checks } = choose({ categoryId: "cat-drawdown", shownType: "income", statementSide: "expense" });

        expect(checks.blocking[0]).toContain('"Loan Principal Drawdown" is for Transfer In (money in)');
        expect(checks.blocking[0]).toContain("shows this transaction as money out (a debit)");
    });

    it("a manual Income / Expense pick that contradicts the category is blocked", () => {
        // Repayment selected, then Type -> Income by hand.
        const saved = finalTyping({ type: "income", transferDirection: null, isTransferCategory: true, derivationSide: "income" });
        const checks = directionChecks({ savedSide: sideOf(saved.type, saved.transferDirection), statementSide: null, categoryName: "Loan Principal Repayment", categoryDirection: "OUT", linkedMovementKind: null });

        expect(saved).toEqual({ type: "transfer", transferDirection: "IN" });
        expect(checks.blocking[0]).toContain("but this would be saved as money in (a credit). Change the category or the Type before saving.");
    });

    it("a saved transfer opened with a category of the other direction is blocked until resolved", () => {
        // Opening never changes the saved direction (In); the category says Out.
        const checks = directionChecks({ savedSide: sideOf("transfer", "IN"), statementSide: null, categoryName: "Loan Principal Repayment", categoryDirection: "OUT", linkedMovementKind: null });

        expect(checks.blocking).toHaveLength(1);
    });

    it("a manual override never bypasses the statement; a mismatch the row already had only warns", () => {
        // This edit turns a statement credit into money out: blocked.
        const introduced = directionChecks({ savedSide: "expense", statementSide: "income", categoryName: "Bank Transfer", categoryDirection: null, linkedMovementKind: null, originalSide: "income" });
        expect(introduced.blocking).toEqual(["The bank statement shows this as money in (a credit); it can't be saved as money out (a debit). Choose the Type or category that matches the statement."]);

        // Already saved that way (e.g. the TATA credits stored as Expense): an
        // unrelated edit is allowed, with a prompt to correct it.
        const existing = directionChecks({ savedSide: "expense", statementSide: "income", categoryName: "Bank Transfer", categoryDirection: null, linkedMovementKind: null, originalSide: "expense" });
        expect(existing.blocking).toEqual([]);
        expect(existing.warnings[0]).toContain("Correct its Type or category to match the statement.");
    });

    it("a change of sign is always shown before saving", () => {
        expect(directionChecks({ savedSide: "income", statementSide: "income", categoryName: null, categoryDirection: "IN", linkedMovementKind: null, originalSide: "expense" }).warnings)
            .toEqual(["This changes the transaction from money out (-) to money in (+)."]);
        expect(directionChecks({ savedSide: "expense", statementSide: null, categoryName: null, categoryDirection: null, linkedMovementKind: null, originalSide: "income" }).warnings)
            .toEqual(["This changes the transaction from money in (+) to money out (-)."]);
        expect(directionChecks({ savedSide: "income", statementSide: null, categoryName: null, categoryDirection: null, linkedMovementKind: null, originalSide: "income" }).warnings).toEqual([]);
    });

    it("a principal overdraft link follows a corrected direction - shown before saving", () => {
        const toIn = directionChecks({ savedSide: "income", statementSide: null, categoryName: null, categoryDirection: null, linkedMovementKind: "REPAYMENT" });
        expect(toIn.blocking).toEqual([]);
        expect(toIn.warnings).toContain("Its overdraft link will change from Repayment to Drawdown, to match.");

        const toOut = directionChecks({ savedSide: "expense", statementSide: null, categoryName: null, categoryDirection: null, linkedMovementKind: "DRAWDOWN" });
        expect(toOut.warnings).toContain("Its overdraft link will change from Drawdown to Repayment, to match.");

        expect(directionChecks({ savedSide: "income", statementSide: null, categoryName: null, categoryDirection: null, linkedMovementKind: "DRAWDOWN" }).warnings).toEqual([]);
    });

    it("an Interest / Charge link can't become money in - blocked", () => {
        expect(directionChecks({ savedSide: "income", statementSide: null, categoryName: null, categoryDirection: null, linkedMovementKind: "INTEREST_CHARGE" }).blocking[0])
            .toContain("unlink it first");
    });
});

describe("TransactionForm wiring (shared by Add and Edit Transaction)", () => {
    const form = readFileSync(path.resolve(__dirname, "TransactionForm.tsx"), "utf8").replace(/\r\n/g, "\n");
    const edit = readFileSync(path.resolve(__dirname, "EditTransactionDialog.tsx"), "utf8").replace(/\r\n/g, "\n");

    it("reads the selected Transfer category's configured direction (never its name)", () => {
        expect(form).toMatch(/selectedCategoryForType\?\.categoryType === "TRANSFER"\s+\? selectedCategoryForType\.transferDirection \?\? null\s+: null;/);
        expect(form).not.toMatch(/Principal|Drawdown|Repayment/);
    });

    it("a category change clears a manual pick and sets the category's direction at once", () => {
        expect(form).toMatch(/if \(previous\.categoryId !== \(categoryId \?\? ""\)\) \{\s+manualSideRef\.current = null;\s+if \(\(selectedType \?\? getValues\("type"\)\) === "transfer"\) \{\s+if \(categoryDirection\) \{\s+directionDerivedRef\.current = true;\s+setValue\("transferDirection", categoryDirection\);/);
    });

    it("an either-way Transfer category re-derives the direction (statement first) instead of keeping the saved one", () => {
        // The 2026-10-12 bug: a saved Transfer Out re-categorised to an
        // either-way Drawdown kept Out although the statement says credit.
        expect(form).toMatch(/\} else \{[\s\S]{0,800}?directionDerivedRef\.current = true;\s+deriveDirection\(\);\s+\}/);
        expect(form).not.toMatch(/\} else if \(\s+directionDerivedRef\.current \|\|\s+!getValues\("transferDirection"\)\s+\) \{/);
        // ...and the derivation puts the statement before the side shown.
        expect(derivationSideFor({ manualSide: null, categoryDirection: null, statementSide: "income", shownSide: null })).toBe("income");
    });

    it("an existing mismatch is only tolerated when the edit leaves category, Type and direction unchanged", () => {
        expect(form).toMatch(/const typingUnchanged =\s+\(categoryId \?\? ""\) === \(defaultValues\?\.categoryId \?\? ""\) &&/);
        const recategorised = directionChecks({ savedSide: "expense", statementSide: "income", categoryName: "Loan Principal Drawdown", categoryDirection: null, linkedMovementKind: null, originalSide: "expense", typingUnchanged: false });
        expect(recategorised.blocking[0]).toContain("it can't be saved as money out");
    });

    it("only a real category / account change does this - never opening the form", () => {
        expect(form).toMatch(/if \(\s+!previous \|\|\s+\(previous\.accountId === \(accountId \?\? ""\) &&\s+previous\.categoryId === \(categoryId \?\? ""\)\)\s+\) \{\s+return;\s+\}/);
        expect(form).toMatch(/const changed = previousTypeRef\.current !== transactionType;/);
    });

    it("submits exactly the typing it shows, and never while a conflict is blocking", () => {
        expect(form).toMatch(/const saved = finalTyping\(\{/);
        expect(form).toMatch(/if \(blocked\) \{\s+return;\s+\}\s+return onSubmit\(\{\s+\.\.\.values,\s+\.\.\.finalTyping\(\{/);
        expect(form).toMatch(/disabled=\{loading \|\| blocked\}/);
        expect(form).toContain("{checks.blocking.map(problem => (");
        expect(form).toContain("{checks.warnings.map(warning => (");
    });

    it("Edit never applies facts read for a previously edited transaction", () => {
        expect(edit).toMatch(/facts && transaction && facts\.transactionId === transaction\.id/);
        expect(edit).toContain("key={transaction.id}");
        expect(edit).toContain("statementSide={currentFacts?.statementSide ?? null}");
    });

    it("still has no Direction field on the transaction - it comes from the category or the money", () => {
        expect(form).not.toMatch(/label="Direction"/);
        expect(form).not.toMatch(/name="transferDirection"/);
    });
});

// ---------------------------------------------------------------------
// Saving and reopening.
// ---------------------------------------------------------------------

const accounts = [{ id: "bank-3999", businessEntityId: null, openingBalance: 0 }];

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

const base = { accountId: "bank-3999", payee: "TATA Capital", amount: 50000, transactionDate: "2026-09-15" };

async function load(id: string): Promise<Transaction> {
    return (await new TransactionRepository().getById(id))!;
}

beforeEach(() => {
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
    // Only the columns getStatementSide reads.
    db.exec(`
        CREATE TABLE import_batches (id TEXT PRIMARY KEY, account_id TEXT);
        CREATE TABLE import_rows (id TEXT PRIMARY KEY, import_batch_id TEXT, transaction_id TEXT, normalized_data TEXT, created_at TEXT);
        CREATE TABLE overdraft_transaction_links (id TEXT PRIMARY KEY, loan_id TEXT, transaction_id TEXT UNIQUE, entry_kind TEXT, link_source TEXT, created_at TEXT);
    `);
    sqlite.db = db;
});

describe("what the form submits is what is saved and shown after reopening", () => {
    it("Expense row -> Drawdown: saved Transfer In, + sign, 'In' label", async () => {
        const id = await service().create({ ...base, type: "expense", categoryId: "cat-interest" });
        const { saved } = choose({ categoryId: "cat-drawdown", shownType: "expense", statementSide: "income" });

        await service().update({ id, ...base, categoryId: "cat-drawdown", ...saved });

        const reopened = await load(id);
        expect(reopened).toMatchObject({ type: "transfer", transferDirection: "IN", categoryId: "cat-drawdown", amount: 50000, transactionDate: "2026-09-15" });
        expect(signedTransactionAmount(reopened.amount, balanceSide(reopened))).toBe(50000);
    });

    it("Expense row -> Repayment: saved Transfer Out, - sign", async () => {
        const id = await service().create({ ...base, type: "expense", categoryId: "cat-interest" });
        const { saved } = choose({ categoryId: "cat-repayment", shownType: "expense", statementSide: "expense" });

        await service().update({ id, ...base, categoryId: "cat-repayment", ...saved });

        const reopened = await load(id);
        expect(reopened).toMatchObject({ type: "transfer", transferDirection: "OUT" });
        expect(signedTransactionAmount(reopened.amount, balanceSide(reopened))).toBe(-50000);
    });

    it("Transfer In / Out survive an unrelated edit and reload", async () => {
        const inId = await service().create({ ...base, type: "transfer", transferDirection: "IN", categoryId: "cat-drawdown" });
        const outId = await service().create({ ...base, type: "transfer", transferDirection: "OUT", categoryId: "cat-repayment" });

        await service().update({ id: inId, ...base, type: "transfer", transferDirection: "IN", categoryId: "cat-drawdown", notes: "OD" });
        await service().update({ id: outId, ...base, type: "transfer", transferDirection: "OUT", categoryId: "cat-repayment", notes: "OD" });

        expect(await load(inId)).toMatchObject({ type: "transfer", transferDirection: "IN", notes: "OD" });
        expect(await load(outId)).toMatchObject({ type: "transfer", transferDirection: "OUT", notes: "OD" });
    });
});

describe("getStatementSide", () => {
    async function imported(side: "income" | "expense", batchAccount: string, txnAccount = "bank-3999") {
        const id = await service().create({ ...base, accountId: txnAccount, type: "expense", categoryId: "cat-interest" });
        sqlite.db!.prepare(`INSERT INTO import_batches (id, account_id) VALUES (?, ?)`).run(`b-${id}`, batchAccount);
        sqlite.db!.prepare(`INSERT INTO import_rows (id, import_batch_id, transaction_id, normalized_data, created_at) VALUES (?, ?, ?, ?, ?)`)
            .run(`r-${id}`, `b-${id}`, id, JSON.stringify({ type: side }), "2026-09-26");
        return id;
    }

    it("returns the statement's side for an imported transaction on its statement's account", async () => {
        expect(await service().getStatementSide(await imported("income", "bank-3999"))).toBe("income");
        expect(await service().getStatementSide(await imported("expense", "bank-3999"))).toBe("expense");
    });

    it("returns null for a manual transaction", async () => {
        const id = await service().create({ ...base, type: "expense", categoryId: "cat-interest" });

        expect(await service().getStatementSide(id)).toBeNull();
    });

    it("returns null once the transaction is on another account than its statement's (no stale side)", async () => {
        expect(await service().getStatementSide(await imported("expense", "bank-3999", "bank-2790"))).toBeNull();
    });
});

describe("principal transfers are not income or expense", () => {
    it("summary totals leave out transfers and Transfer-category rows, keep interest as expense", () => {
        const rows = [
            { id: "drawdown", type: "transfer", transferDirection: "IN", amount: 500000, categoryId: "cat-drawdown" },
            { id: "repayment", type: "transfer", transferDirection: "OUT", amount: 150000, categoryId: "cat-repayment" },
            { id: "legacy", type: "expense", amount: 50000, categoryId: "cat-drawdown" },
            { id: "interest", type: "expense", amount: 41870, categoryId: "cat-interest" },
            { id: "recovered", type: "income", amount: 1000, categoryId: "cat-recovered" },
        ] as Transaction[];

        expect(computeTransactionSummaryTotals(rows, transferCategoryIdSet(categories))).toMatchObject({
            totalIncome: 1000,
            totalExpense: 41870,
        });
    });
});
