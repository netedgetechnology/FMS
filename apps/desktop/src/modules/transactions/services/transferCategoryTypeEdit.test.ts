import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { TransactionSchemaMigration } from "@/core/database/migrations/003_transactions";
import { TransactionDetailsMigration } from "@/core/database/migrations/014_transaction_details";
import { TransactionChannelTypeMigration } from "@/core/database/migrations/024_transaction_type";
import { TransactionCounterpartyBranchMigration } from "@/core/database/migrations/025_transaction_counterparty_branch";
import { CounterpartyRulesMigration } from "@/core/database/migrations/026_counterparty_rules";
import { CounterpartyRulesAccountScopeMigration } from "@/core/database/migrations/027_counterparty_rules_account_scope";
import { CounterpartyRulesTypeNotesMigration } from "@/core/database/migrations/028_counterparty_rules_type_notes";
import { CounterpartyRulesCategoryMigration } from "@/core/database/migrations/039_counterparty_rules_category";
import { TransactionTransferDirectionMigration } from "@/core/database/migrations/040_transaction_transfer_direction";
import { AccountType } from "@/modules/accounts/types";

import { getDefaultValues, updatedMessage } from "../components/EditTransactionDialog";
import type { TransactionFormInput } from "../validation";
import { transactionSchema } from "../validation";

import { TransactionService } from "./TransactionService";
import { finalTyping, savedTypeLabel, transferCategoryTypeNotice } from "./transactionTyping";

// ---------------------------------------------------------------------
// Issue 1: a Transfer edited to Expense "stays Transfer". Root cause: its
// category is a TRANSFER category, and the rule (applyTransferCategoryRule
// in TransactionService.update, mirrored by the form's finalTyping) saves
// Income / Expense on a Transfer category as a Transfer - the category
// decides. Nothing failed to save. Fix: the form and the success message
// now say plainly what is saved; the accounting rule is unchanged.
// Real TransactionService + repository SQL on an in-memory database.
// Synthetic data only.
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

const bank = { id: "syn-bank", name: "SYN Bank", type: AccountType.SAVINGS, currencyId: "inr", openingBalance: 0, isActive: true, businessEntityId: null };
const categories = [
    { id: "cat-principal", name: "Loan Principal Repayment", categoryType: "TRANSFER", transferDirection: "OUT" },
    { id: "cat-bank-transfer", name: "Bank Transfer", categoryType: "TRANSFER", transferDirection: null },
    { id: "cat-emi", name: "Loan Instalment", categoryType: "EXPENSE" },
];

function service(): TransactionService {
    const s = new TransactionService();
    Object.defineProperty(s, "accountRepository", { value: { getAll: async () => [bank], getById: async (id: string) => (id === bank.id ? bank : null) } });
    Object.defineProperty(s, "categoryRepository", {
        value: { getAll: async () => categories, getById: async (id: string) => categories.find(c => c.id === id) ?? null },
    });
    Object.defineProperty(s, "categoryContextMappingRepository", { value: { getByCategoryId: async () => [] } });
    return s;
}

const row = (id: string) => sqlite.db!.prepare("SELECT * FROM transactions WHERE id = ?").get(id) as Record<string, unknown>;

function insertTransfer(categoryId: string | null, id = "syn-transfer"): string {
    sqlite.db!.prepare(
        `INSERT INTO transactions (id, account_id, category_id, payee, type, transfer_direction, amount, transaction_date, status, created_at, updated_at)
         VALUES (?, ?, ?, 'SYN Lender', 'transfer', 'OUT', 22842.47, '2026-07-10', 'CLEARED', '2026-07-10', '2026-07-10')`
    ).run(id, bank.id, categoryId);
    return id;
}

// Exactly what EditTransactionDialog submits: the form's values, through
// the form's own finalTyping, then TransactionService.update.
async function editViaForm(id: string, edits: Partial<TransactionFormInput>) {
    const s = service();
    const transaction = (await s.getById(id))!;
    const values = transactionSchema.parse({ ...getDefaultValues(transaction), ...edits });
    const isTransferCategory = categories.find(c => c.id === values.categoryId)?.categoryType === "TRANSFER";
    const typed = finalTyping({ type: values.type, transferDirection: values.transferDirection, isTransferCategory, derivationSide: values.type === "transfer" ? null : values.type });
    const { description, ...rest } = values;
    await s.update({ id, ...rest, ...typed, originalNarration: description, sourceStatement: transaction.sourceStatement });
    return (await s.getById(id))!;
}

beforeEach(() => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE accounts (id TEXT PRIMARY KEY);");
    db.exec(`INSERT INTO accounts (id) VALUES ('${bank.id}')`);
    for (const migration of [
        TransactionSchemaMigration, TransactionDetailsMigration, TransactionChannelTypeMigration,
        TransactionCounterpartyBranchMigration, TransactionTransferDirectionMigration,
        CounterpartyRulesMigration, CounterpartyRulesAccountScopeMigration,
        CounterpartyRulesTypeNotesMigration, CounterpartyRulesCategoryMigration,
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

describe("Issue 1 - root cause: Type Expense on a TRANSFER category is saved as a Transfer", () => {
    it("the service alone keeps it a Transfer Out when only the Type is changed (the category decides)", async () => {
        const id = insertTransfer("cat-principal");
        await service().update({ id, type: "expense" });

        expect(row(id)).toMatchObject({ type: "transfer", transfer_direction: "OUT", category_id: "cat-principal", amount: 22842.47 });
    });

    it("through the Edit form too - and the same for an either-way Transfer category", async () => {
        for (const category of ["cat-principal", "cat-bank-transfer"]) {
            const id = insertTransfer(category, `syn-${category}`);
            const saved = await editViaForm(id, { type: "expense" });
            expect(saved, category).toMatchObject({ type: "transfer", transferDirection: "OUT" });
        }
    });

    it("changing the category to a non-transfer category saves it as an Expense, keeping amount, date and account", async () => {
        const id = insertTransfer("cat-principal");
        const before = row(id);
        const saved = await editViaForm(id, { type: "expense", categoryId: "cat-emi" });

        expect(saved).toMatchObject({ type: "expense", transferDirection: null, categoryId: "cat-emi" });
        for (const column of ["amount", "transaction_date", "account_id", "payee"]) expect(row(id)[column], column).toEqual(before[column]);
    });

    it("a Transfer typed by hand on a normal category is changed to Expense as asked (nothing forces it back)", async () => {
        const id = insertTransfer("cat-emi");
        const saved = await editViaForm(id, { type: "expense" });
        expect(saved).toMatchObject({ type: "expense", transferDirection: null });
    });
});

describe("Issue 1 - fix: the form and the success message say what is really saved", () => {
    it("Income / Expense chosen on a Transfer category gets a plain notice, with the way to change it", () => {
        expect(transferCategoryTypeNotice({ chosenType: "expense", saved: { type: "transfer", transferDirection: "OUT" }, categoryName: "Loan Principal Repayment" })).toBe(
            "Loan Principal Repayment is a Transfer category, so this is saved as Transfer Out, not Expense. To save it as an Expense, choose an expense category."
        );
        expect(transferCategoryTypeNotice({ chosenType: "income", saved: { type: "transfer", transferDirection: "IN" }, categoryName: "Bank Transfer" })).toBe(
            "Bank Transfer is a Transfer category, so this is saved as Transfer In, not Income. To save it as an Income, choose an income category."
        );
    });

    it("no notice when what is chosen is what is saved", () => {
        expect(transferCategoryTypeNotice({ chosenType: "transfer", saved: { type: "transfer", transferDirection: "OUT" }, categoryName: "Bank Transfer" })).toBeNull();
        expect(transferCategoryTypeNotice({ chosenType: "expense", saved: { type: "expense", transferDirection: null }, categoryName: "Loan Instalment" })).toBeNull();
    });

    it("the success message names the type read back from the record", async () => {
        const id = insertTransfer("cat-principal");
        const saved = await editViaForm(id, { type: "expense" });
        expect(updatedMessage(saved)).toBe("Transaction updated - saved as Transfer Out.");
        expect(updatedMessage({ type: "expense", transferDirection: null })).toBe("Transaction updated - saved as Expense.");
        expect(updatedMessage(null)).toBe("Transaction updated successfully.");
        expect(savedTypeLabel({ type: "transfer", transferDirection: null })).toBe("Transfer");
    });

    it("the form shows the notice (amber, role=status) instead of the old faint hint", () => {
        const source = readFileSync(fileURLToPath(new URL("../components/TransactionForm.tsx", import.meta.url)), "utf8");
        expect(source).toContain("const typeNotice = transferCategoryTypeNotice({");
        expect(source).toContain('data-type-override="true"');
        expect(source).not.toContain("is a Transfer category, so this will be saved as");
    });
});
