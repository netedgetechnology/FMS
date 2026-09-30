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
import type { Category, CategoryContextMapping } from "@/modules/categories/types";
import { TransactionService } from "@/modules/transactions/services/TransactionService";

import { decodeDraftPreview, encodeDraftPreview } from "../pages/importDraft";
import type { CustomImportRule } from "../types";

import {
    applyCustomImportRules,
    categoryDirectionLocksFor,
    describeRejectedRuleCategory,
} from "./customImportRules";
import { ImportService, reapplyCustomImportRules } from "./ImportService";

// ---------------------------------------------------------------------
// A Custom Import Rule may only apply a category the row's Credit/Debit
// direction can be saved with. A category an account- or business-
// entity-specific mapping locks to the OTHER direction (e.g. the Expense
// category "Loan Installment" on the Yes Bank 0207 "DOD INT RECOV"
// credits) is not applied: the row keeps its pre-rule category, the rule's
// Payee/Notes/channel still apply, the preview records why, and the row
// imports normally instead of failing validation.
//
// The real ImportService, TransactionService (incl. its unchanged
// category/direction validation) and repositories run against an
// in-memory database built from the app's migrations; only SQLiteProvider,
// the account/category/mapping lookups, custom rules and the learning
// store are stubbed.
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

const ACCOUNT = { id: "acct-0207", businessEntityId: "be-netedge", openingBalance: 0 };
const OTHER_ENTITY_ACCOUNT = { id: "acct-personal", businessEntityId: "be-personal", openingBalance: 0 };

function category(id: string, name: string, categoryType: Category["categoryType"]): Category {
    return {
        id, parentId: null, name, categoryType, financeScope: "BUSINESS",
        businessEntityId: null, description: null, isActive: true, createdAt: "", updatedAt: "",
    } as Category;
}

const CATEGORIES: Category[] = [
    category("cat-loan", "Loan Installment", "EXPENSE"),
    category("cat-interest-income", "Interest Income", "INCOME"),
    // No mapping: its default type is only a soft suggestion, never a lock.
    category("cat-misc", "Miscellaneous", "EXPENSE"),
];

function entityMapping(categoryId: string, categoryType: "INCOME" | "EXPENSE"): CategoryContextMapping {
    return {
        id: `map-${categoryId}`, categoryId, accountId: null, businessEntityId: ACCOUNT.businessEntityId,
        categoryType, isActive: true, createdAt: "", updatedAt: "",
    } as CategoryContextMapping;
}

const MAPPINGS: CategoryContextMapping[] = [
    entityMapping("cat-loan", "EXPENSE"),
    entityMapping("cat-interest-income", "INCOME"),
];

let ruleSeq = 0;

function rule(keyword: string, fields: Partial<CustomImportRule>): CustomImportRule {
    ruleSeq += 1;
    return {
        id: `rule-${ruleSeq}`, accountId: ACCOUNT.id, keyword, payee: null, notes: null,
        categoryId: null, transactionType: null, createdAt: "", updatedAt: "",
        ...fields,
    } as CustomImportRule;
}

// Mirrors the two Yes Bank 0207 rules (Expense category on Credit rows),
// plus the reverse and two compatible ones.
const RULES: CustomImportRule[] = [
    rule("DOD INT RECOV", { payee: "DOD Interest Recovered", notes: "OD interest", categoryId: "cat-loan", transactionType: "EMANDATE" }),
    rule("FD INT", { payee: "FD Interest", notes: "Fixed deposit", categoryId: "cat-interest-income" }),
    rule("INTEREST CREDIT", { payee: "Bank Interest", categoryId: "cat-interest-income" }),
    rule("KOTAKMAHPRIME", { payee: "Kotak Mahindra", notes: "Car loan", categoryId: "cat-loan", transactionType: "EMANDATE" }),
    rule("SUNDRY", { categoryId: "cat-misc" }),
];

const STATEMENT = [
    "Date,Description,Debit,Credit,Balance",
    "01/08/2022,DEBIT INTEREST CAPITALIZED,59614.00,,-6852510.73",
    "06/08/2022,DOD INT RECOV AUG22,,59614.00,-6792896.73",
    "07/08/2022,FD INT REVERSAL,1200.00,,-6794096.73",
    "08/08/2022,INTEREST CREDIT Q2,,450.00,-6793646.73",
    "09/08/2022,KOTAKMAHPRIME EMI,9260.00,,-6802906.73",
    "10/08/2022,SUNDRY RECEIPT,,100.00,-6802806.73",
].join("\n");

function transactionService(): TransactionService {
    const service = new TransactionService();

    Object.defineProperty(service, "accountRepository", {
        value: {
            getAll: async () => [ACCOUNT, OTHER_ENTITY_ACCOUNT],
            getById: async (id: string) => [ACCOUNT, OTHER_ENTITY_ACCOUNT].find(a => a.id === id) ?? null,
        },
    });
    Object.defineProperty(service, "categoryRepository", {
        value: {
            getAll: async () => CATEGORIES,
            getById: async (id: string) => CATEGORIES.find(c => c.id === id) ?? null,
        },
    });
    Object.defineProperty(service, "categoryContextMappingRepository", {
        value: {
            getAll: async () => MAPPINGS,
            getByCategoryId: async (id: string) => MAPPINGS.filter(m => m.categoryId === id),
        },
    });

    return service;
}

function importService(): ImportService {
    const service = new ImportService();

    Object.defineProperty(service, "transactionService", { value: transactionService() });
    Object.defineProperty(service, "accountRepository", {
        value: { getById: async (id: string) => [ACCOUNT, OTHER_ENTITY_ACCOUNT].find(a => a.id === id) ?? null },
    });
    Object.defineProperty(service, "categoryContextMappingRepository", {
        value: { getAll: async () => MAPPINGS },
    });
    Object.defineProperty(service, "customRuleRepository", {
        value: {
            listByAccount: async (accountId: string) => RULES.filter(r => r.accountId === accountId),
            listAll: async () => RULES,
        },
    });
    Object.defineProperty(service, "counterpartyRuleRepository", {
        value: { findByAccountAndPattern: async () => null, upsert: async () => null },
    });

    return service;
}

function row(candidates: NormalizedTransactionCandidate[], description: string) {
    return candidates.find(candidate => candidate.description.startsWith(description))!;
}

async function preview(accountId = ACCOUNT.id) {
    return await importService().previewCsv(accountId, STATEMENT);
}

beforeEach(() => {
    const db = new DatabaseSync(":memory:");

    db.exec(
        `CREATE TABLE accounts (id TEXT PRIMARY KEY);
         CREATE TABLE currencies (id TEXT PRIMARY KEY);
         INSERT INTO accounts (id) VALUES ('${ACCOUNT.id}'), ('${OTHER_ENTITY_ACCOUNT.id}');`
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

describe("Custom Import Rule category vs. Credit/Debit direction", () => {
    it("the statement parses into the expected directions", async () => {
        const { candidates } = await preview();

        expect(row(candidates, "DOD INT RECOV").type).toBe("income");
        expect(row(candidates, "FD INT").type).toBe("expense");
        expect(row(candidates, "INTEREST CREDIT").type).toBe("income");
        expect(row(candidates, "KOTAKMAHPRIME").type).toBe("expense");
    });

    it("Credit + rule with an Expense-locked category: category not applied, Payee/Notes/channel still applied", async () => {
        const result = await preview();
        const credit = row(result.candidates, "DOD INT RECOV");

        expect(credit).toMatchObject({
            type: "income",
            categoryId: null,
            payee: "DOD Interest Recovered",
            notes: "OD interest",
            transactionType: "EMANDATE",
            description: "DOD INT RECOV AUG22",
        });

        const application = result.customRuleState!.applications.get(credit.rowNumber)!;
        expect(application.rejectedCategory).toEqual({
            categoryId: "cat-loan", ruleId: RULES[0].id, lockedTo: "expense",
        });
        expect(application.ruleIdByField).toEqual({
            payee: RULES[0].id, notes: RULES[0].id, transactionType: RULES[0].id,
        });
        // Still counted as a row a custom rule applied to.
        expect(result.matchedLearnedRuleRowNumbers.has(credit.rowNumber)).toBe(true);
    });

    it("Debit + rule with an Income-locked category: category not applied, Payee/Notes still applied", async () => {
        const result = await preview();
        const debit = row(result.candidates, "FD INT");

        expect(debit).toMatchObject({
            type: "expense", categoryId: null, payee: "FD Interest", notes: "Fixed deposit",
        });
        expect(
            result.customRuleState!.applications.get(debit.rowNumber)!.rejectedCategory
        ).toMatchObject({ categoryId: "cat-interest-income", lockedTo: "income" });
    });

    it("compatible Credit + Income rule and Debit + Expense rule apply exactly as before", async () => {
        const result = await preview();
        const credit = row(result.candidates, "INTEREST CREDIT");
        const debit = row(result.candidates, "KOTAKMAHPRIME");

        expect(credit).toMatchObject({ type: "income", categoryId: "cat-interest-income", payee: "Bank Interest" });
        expect(debit).toMatchObject({
            type: "expense", categoryId: "cat-loan", payee: "Kotak Mahindra", notes: "Car loan", transactionType: "EMANDATE",
        });

        for (const candidate of [credit, debit]) {
            const application = result.customRuleState!.applications.get(candidate.rowNumber)!;
            expect(application.rejectedCategory).toBeUndefined();
            expect(application.ruleIdByField.categoryId).toBeDefined();
        }
    });

    it("a category with no locking mapping (default type only) still applies to either direction", async () => {
        const result = await preview();

        expect(row(result.candidates, "SUNDRY")).toMatchObject({ type: "income", categoryId: "cat-misc" });
    });

    it("locks are per account/business entity: another entity without the mapping gets the rule category", () => {
        const locks = categoryDirectionLocksFor(MAPPINGS, OTHER_ENTITY_ACCOUNT);

        expect(locks).toEqual({});
        expect(categoryDirectionLocksFor(MAPPINGS, ACCOUNT)).toEqual({
            "cat-loan": "expense", "cat-interest-income": "income",
        });
    });

    it("an incompatible rule category no longer makes the import fail; compatible rows import with their category", async () => {
        const { candidates } = await preview();

        const batch = await importService().importCandidates(ACCOUNT.id, "statement.csv", "BANK_CSV", candidates);

        expect(batch).toMatchObject({ status: "COMPLETED", totalRows: 6, importedRows: 6, failedRows: 0, duplicateRows: 0 });

        const stored = sqlite.db!
            .prepare("SELECT original_narration AS d, type, category_id AS c, payee, notes FROM transactions ORDER BY transaction_date")
            .all()
            .map(t => ({ ...t }));

        expect(stored).toContainEqual({ d: "DOD INT RECOV AUG22", type: "income", c: null, payee: "DOD Interest Recovered", notes: "OD interest" });
        expect(stored).toContainEqual({ d: "FD INT REVERSAL", type: "expense", c: null, payee: "FD Interest", notes: "Fixed deposit" });
        expect(stored).toContainEqual({ d: "KOTAKMAHPRIME EMI", type: "expense", c: "cat-loan", payee: "Kotak Mahindra", notes: "Car loan" });
        expect(stored).toContainEqual({ d: "INTEREST CREDIT Q2", type: "income", c: "cat-interest-income", payee: "Bank Interest", notes: null });
    });

    it("the existing save-time category/direction validation is unchanged", async () => {
        await expect(
            transactionService().create({
                accountId: ACCOUNT.id, payee: "X", type: "income", amount: 1,
                transactionDate: "2022-08-06", categoryId: "cat-loan",
            })
        ).rejects.toThrow(/mapped to Expense/);
    });

    it("re-applying rules after a rule change keeps the protection (locks travel with the preview)", async () => {
        const result = await preview();

        const reapplied = reapplyCustomImportRules(result, [...RULES]);
        const credit = row(reapplied.candidates, "DOD INT RECOV");

        expect(credit.categoryId).toBeNull();
        expect(credit.payee).toBe("DOD Interest Recovered");
        expect(reapplied.customRuleState!.applications.get(credit.rowNumber)!.rejectedCategory).toBeDefined();
    });

    it("a saved import draft round-trips the locks and the rejection", async () => {
        const result = await preview();
        const restored = decodeDraftPreview(
            JSON.parse(JSON.stringify(encodeDraftPreview(result as never)))
        );

        expect(restored.customRuleState!.categoryDirectionLocks).toEqual({
            "cat-loan": "expense", "cat-interest-income": "income",
        });

        const reapplied = reapplyCustomImportRules(restored, [...RULES]);
        expect(row(reapplied.candidates, "DOD INT RECOV").categoryId).toBeNull();
    });

    it("keeps the row's pre-rule (Self-Learning) category when the rule's category is rejected", () => {
        const learned = {
            rowNumber: 2, transactionDate: "2022-08-06", payee: "Old", description: "DOD INT RECOV AUG22",
            amount: 59614, type: "income", referenceNumber: null, externalTransactionId: null, balance: null,
            branch: null, transactionType: null, counterparty: null, notes: null, rawData: {},
            categoryId: "cat-interest-income",
        } as NormalizedTransactionCandidate;

        const { candidates } = applyCustomImportRules([learned], RULES, { "cat-loan": "expense" });

        expect(candidates[0]).toMatchObject({ categoryId: "cat-interest-income", payee: "DOD Interest Recovered" });
    });

    it("without locks (e.g. a draft saved before this existed) behavior is exactly as before", () => {
        const credit = {
            rowNumber: 2, transactionDate: "2022-08-06", payee: "", description: "DOD INT RECOV AUG22",
            amount: 59614, type: "income", referenceNumber: null, externalTransactionId: null, balance: null,
            branch: null, transactionType: null, counterparty: null, notes: null, rawData: {},
        } as NormalizedTransactionCandidate;

        const { candidates, applications } = applyCustomImportRules([credit], RULES);

        expect(candidates[0].categoryId).toBe("cat-loan");
        expect(applications.get(2)!.rejectedCategory).toBeUndefined();
    });

    it("the preview note says which rule and category were skipped and why", () => {
        expect(
            describeRejectedRuleCategory({
                keyword: "DOD INT RECOV", categoryName: "Loan Installment", lockedTo: "expense", direction: "income",
            })
        ).toBe(
            'Category "Loan Installment" from rule "DOD INT RECOV" not applied: it is Expense-only for this account and this row is a Credit. Choose a category.'
        );
    });
});
