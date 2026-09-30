import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import type { NormalizedTransactionCandidate } from "@financeos/import-engine";

import { ImportCustomRulesMigration } from "@/core/database/migrations/041_import_custom_rules";

import { CustomImportRuleRepository } from "../repositories/CustomImportRuleRepository";
import type { ImportBatch, ImportRow } from "../types";

import {
    ImportService,
    reapplyCustomImportRules,
    reapplyCustomImportRulesIfChanged,
} from "./ImportService";
import { learningKeyForCandidate } from "./learningKey";

// ---------------------------------------------------------------------
// Custom Import Rules through ImportService, persisted in a real SQLite
// database (node:sqlite, in memory) with the real migration and the real
// CustomImportRuleRepository SQL. Everything else ImportService talks to
// (batches, rows, transactions, the automatic-learning rule store) is an
// in-memory fake, as in ImportService.test.ts.
// ---------------------------------------------------------------------

function createDatabase(): DatabaseSync {
    const db = new DatabaseSync(":memory:");

    db.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL);
        INSERT INTO accounts (id, name) VALUES ('acct-od', 'Yes Bank OD'), ('acct-savings', 'Savings');
    `);

    for (const statement of ImportCustomRulesMigration.sql
        .split(";")
        .map(part => part.trim())
        .filter(Boolean)) {
        db.exec(statement);
    }

    return db;
}

// The two calls Repository makes on SQLiteProvider, backed by node:sqlite.
function sqliteAdapter(db: DatabaseSync) {
    return {
        async execute(sql: string, params: unknown[] = []) {
            db.prepare(sql).run(...(params as never[]));
        },
        async select(sql: string, params: unknown[] = []) {
            return db.prepare(sql).all(...(params as never[]));
        },
    };
}

interface LearnedRule {
    counterparty: string;
    type: string | null;
    notes: string | null;
    categoryId: string | null;
}

function makeService(db: DatabaseSync = createDatabase()) {
    let batchRow: ImportBatch = {
        id: "batch-1",
        accountId: "acct-od",
        importType: "BANK_CSV",
        sourceFileName: "statement.csv",
        status: "PENDING",
        totalRows: 0,
        importedRows: 0,
        duplicateRows: 0,
        failedRows: 0,
        createdAt: "2026-09-27T00:00:00.000Z",
        updatedAt: "2026-09-27T00:00:00.000Z",
    };

    const importRows = new Map<string, ImportRow>();
    const createdTransactions: Array<Record<string, unknown>> = [];
    const learned = new Map<string, LearnedRule>();
    const upserts: Array<{ accountId: string; pattern: string; rule: LearnedRule }> = [];

    const service = new ImportService();

    const customRepository = new CustomImportRuleRepository();
    Object.defineProperty(customRepository, "database", {
        value: sqliteAdapter(db),
    });
    Object.defineProperty(service, "customRuleRepository", {
        value: customRepository,
    });

    Object.defineProperty(service, "counterpartyRuleRepository", {
        value: {
            async findByAccountAndPattern(accountId: string, pattern: string) {
                return learned.get(`${accountId}::${pattern}`) ?? null;
            },
            async upsert(
                accountId: string,
                pattern: string,
                payee: string,
                type: string | null,
                notes: string | null,
                categoryId: string | null = null
            ) {
                const key = `${accountId}::${pattern}`;
                const existing = learned.get(key);
                const rule = {
                    counterparty: payee,
                    type: type ?? existing?.type ?? null,
                    notes: notes ?? existing?.notes ?? null,
                    categoryId: categoryId ?? existing?.categoryId ?? null,
                };
                learned.set(key, rule);
                upserts.push({ accountId, pattern, rule });
                return null;
            },
        },
    });

    Object.defineProperty(service, "batchRepository", {
        value: {
            async getById() {
                return batchRow;
            },
            async create(request: Partial<ImportBatch>) {
                batchRow = { ...batchRow, ...request } as ImportBatch;
            },
            async update(request: Partial<ImportBatch> & { id: string }) {
                batchRow = { ...batchRow, ...request } as ImportBatch;
            },
        },
    });

    Object.defineProperty(service, "rowRepository", {
        value: {
            async getByBatchId() {
                return Array.from(importRows.values());
            },
            async create(row: ImportRow) {
                importRows.set(row.id, row);
                return row;
            },
            async update(request: Partial<ImportRow> & { id: string }) {
                const existing = importRows.get(request.id);
                if (existing) {
                    importRows.set(request.id, { ...existing, ...request });
                }
            },
        },
    });

    Object.defineProperty(service, "transactionRepository", {
        value: {
            async findDuplicate() {
                return null;
            },
        },
    });

    Object.defineProperty(service, "transactionService", {
        value: {
            async findDuplicate() {
                return null;
            },
            async create(request: Record<string, unknown>) {
                createdTransactions.push(request);
                return `txn-${createdTransactions.length}`;
            },
        },
    });

    return { db, service, createdTransactions, learned, upserts };
}

const JUNE_STATEMENT = [
    "Date,Description,Debit,Credit,Balance",
    "30/06/2022,LAP DOD INT JUN22,55711.00,,-6290751.30",
    "02/07/2022,IMPS/NA/XXXX0001/SUPPLIER ONE,5500.00,,-6296251.30",
].join("\n");

const LATER_STATEMENT = [
    "Date,Description,Debit,Credit,Balance",
    "31/07/2022,lap  dod int July22,54120.00,,-6350371.30",
    "31/08/2022,LAP DOD INT AUG22,56010.00,,-6406381.30",
    "01/09/2022,NET TXN: BILLDESK SBICARD,11000.00,,-6417381.30",
].join("\n");

describe("persistence", () => {
    it("saves the rule permanently for the account (trimmed, blanks stored as null) and lists it", async () => {
        const { db, service } = makeService();

        const saved = await service.createCustomRule({
            accountId: "acct-od",
            keyword: "  LAP   DOD INT ",
            payee: "DOD Interest",
            notes: "Overdraft interest",
            categoryId: "",
            transactionType: "   ",
        });

        expect(saved).toMatchObject({
            accountId: "acct-od",
            keyword: "LAP DOD INT",
            payee: "DOD Interest",
            notes: "Overdraft interest",
            categoryId: null,
            transactionType: null,
        });

        expect(db.prepare("SELECT COUNT(*) AS n FROM import_custom_rules").get()).toEqual({ n: 1 });
        expect(await service.listCustomRules("acct-od")).toEqual([saved]);
    });

    it("rejects a rule with no keyword or with no field to set", async () => {
        const { service } = makeService();

        await expect(
            service.createCustomRule({ accountId: "acct-od", keyword: "  ", payee: "X" })
        ).rejects.toThrow("Enter a keyword");

        await expect(
            service.createCustomRule({ accountId: "acct-od", keyword: "LAP DOD INT", payee: " " })
        ).rejects.toThrow("Set at least one of Payee, Notes, Category or Type.");
    });

    it("the table itself refuses an empty rule and an unknown account", () => {
        const db = createDatabase();

        expect(() =>
            db.exec(
                "INSERT INTO import_custom_rules (id, account_id, keyword) VALUES ('r', 'acct-od', 'X')"
            )
        ).toThrow(/CHECK/);

        expect(() =>
            db.exec(
                "INSERT INTO import_custom_rules (id, account_id, keyword, payee) VALUES ('r', 'nope', 'X', 'P')"
            )
        ).toThrow(/FOREIGN KEY/);
    });

    it("creating a rule never touches transactions or automatic learned rules", async () => {
        const { service, createdTransactions, upserts } = makeService();

        await service.createCustomRule({
            accountId: "acct-od",
            keyword: "LAP DOD INT",
            payee: "DOD Interest",
        });

        expect(createdTransactions).toEqual([]);
        expect(upserts).toEqual([]);
    });

    it("deleting a rule removes it", async () => {
        const { service } = makeService();

        const saved = await service.createCustomRule({
            accountId: "acct-od",
            keyword: "LAP DOD INT",
            payee: "DOD Interest",
        });

        await service.deleteCustomRule(saved.id);

        expect(await service.listCustomRules("acct-od")).toEqual([]);
    });
});

describe("automatic application on imports", () => {
    it("applies to the current preview and to every future import for the account", async () => {
        const { service } = makeService();

        await service.createCustomRule({
            accountId: "acct-od",
            keyword: "LAP DOD INT",
            payee: "DOD Interest",
            notes: "Overdraft interest",
        });

        const june = await service.previewCsv("acct-od", JUNE_STATEMENT);

        expect(june.candidates.map(c => [c.description, c.payee, c.notes])).toEqual([
            ["LAP DOD INT JUN22", "DOD Interest", "Overdraft interest"],
            ["IMPS/NA/XXXX0001/SUPPLIER ONE", "IMPS/NA/XXXX0001/SUPPLIER ONE", null],
        ]);
        expect([...june.customRuleState!.applications.keys()]).toEqual([2]);

        // A later statement - nothing recreated.
        const later = await service.previewCsv("acct-od", LATER_STATEMENT);

        expect(later.candidates.map(c => c.payee)).toEqual([
            "DOD Interest",
            "DOD Interest",
            "NET TXN: BILLDESK SBICARD",
        ]);
        // Original Descriptions are untouched.
        expect(later.candidates.map(c => c.description)).toEqual([
            "lap  dod int July22",
            "LAP DOD INT AUG22",
            "NET TXN: BILLDESK SBICARD",
        ]);
        // Shown as learned (permanent rule applied).
        expect([...later.matchedLearnedRuleRowNumbers].sort()).toEqual([2, 3]);
    });

    it("is scoped to its account - another account's import is unaffected", async () => {
        const { service } = makeService();

        await service.createCustomRule({
            accountId: "acct-od",
            keyword: "LAP DOD INT",
            payee: "DOD Interest",
        });

        const other = await service.previewCsv("acct-savings", JUNE_STATEMENT);

        expect(other.candidates[0]!.payee).toBe("LAP DOD INT JUN22");
        expect(other.customRuleState!.applications.size).toBe(0);
        expect(await service.listCustomRules("acct-savings")).toEqual([]);
    });

    it("multiple rules: the most recently created matching rule wins per field (persisted order)", async () => {
        const { service } = makeService();

        const older = await service.createCustomRule({
            accountId: "acct-od",
            keyword: "DOD INT",
            payee: "Interest (old rule)",
            notes: "From the older rule",
        });
        const newer = await service.createCustomRule({
            accountId: "acct-od",
            keyword: "LAP DOD INT",
            payee: "DOD Interest",
        });

        expect((await service.listCustomRules("acct-od")).map(r => r.id)).toEqual([
            newer.id,
            older.id,
        ]);

        const preview = await service.previewCsv("acct-od", JUNE_STATEMENT);

        expect(preview.candidates[0]).toMatchObject({
            payee: "DOD Interest",
            notes: "From the older rule",
        });
    });

    it("Custom Rule overrides automatic Self-Learning; unspecified fields keep the learned values", async () => {
        const { service, learned } = makeService();

        const juneRow = (await service.previewCsv("acct-od", JUNE_STATEMENT)).candidates[0]!;
        learned.set(`acct-od::${learningKeyForCandidate(juneRow)}`, {
            counterparty: "Learned Payee",
            type: "NEFT",
            notes: "Learned notes",
            categoryId: "cat-learned",
        });

        await service.createCustomRule({
            accountId: "acct-od",
            keyword: "LAP DOD INT",
            payee: "DOD Interest",
        });

        const preview = await service.previewCsv("acct-od", JUNE_STATEMENT);

        expect(preview.candidates[0]).toMatchObject({
            payee: "DOD Interest",
            notes: "Learned notes",
            categoryId: "cat-learned",
            transactionType: "NEFT",
            description: "LAP DOD INT JUN22",
        });
    });

    it("an account with no custom rules previews exactly as before", async () => {
        const { service } = makeService();

        const preview = await service.previewCsv("acct-od", JUNE_STATEMENT);

        expect(preview.candidates.map(c => c.payee)).toEqual([
            "LAP DOD INT JUN22",
            "IMPS/NA/XXXX0001/SUPPLIER ONE",
        ]);
        expect(preview.matchedLearnedRuleRowNumbers.size).toBe(0);
        expect(preview.customRuleState!.applications.size).toBe(0);
        preview.candidates.forEach((candidate, index) =>
            expect(candidate).toBe(preview.customRuleState!.candidatesBeforeCustomRules[index])
        );
    });
});

describe("no unwanted automatic Self-Learning", () => {
    async function previewWithRule() {
        const env = makeService();

        await env.service.createCustomRule({
            accountId: "acct-od",
            keyword: "LAP DOD INT",
            payee: "DOD Interest",
            notes: "Overdraft interest",
        });

        const preview = await env.service.previewCsv("acct-od", JUNE_STATEMENT);

        return { ...env, preview };
    }

    const baselines = (candidates: NormalizedTransactionCandidate[]) =>
        new Map(candidates.map(candidate => [candidate.rowNumber, candidate]));

    it("importing custom-rule values writes no automatic learned rule (Import Preview path, with baselines)", async () => {
        const { service, preview, upserts, createdTransactions } = await previewWithRule();

        await service.importCandidates(
            "acct-od",
            "statement.csv",
            "BANK_CSV",
            preview.candidates,
            null,
            undefined,
            baselines(preview.candidates)
        );

        expect(upserts).toEqual([]);
        // The rule's values are what gets imported.
        expect(createdTransactions[0]).toMatchObject({
            payee: "DOD Interest",
            notes: "Overdraft interest",
        });
    });

    it("...and none either when no baselines are supplied", async () => {
        const { service, preview, upserts } = await previewWithRule();

        await service.executeCandidates("batch-1", preview.candidates);

        expect(upserts).toEqual([]);
    });

    it("a genuine edit to a field the rule does NOT set still teaches Self-Learning - without the rule's values", async () => {
        const { service, preview, upserts } = await previewWithRule();

        const edited = preview.candidates.map(candidate =>
            candidate.rowNumber === 2
                ? { ...candidate, categoryId: "cat-interest" }
                : candidate
        );

        await service.importCandidates(
            "acct-od",
            "statement.csv",
            "BANK_CSV",
            edited,
            null,
            undefined,
            baselines(preview.candidates)
        );

        expect(upserts).toHaveLength(1);
        expect(upserts[0]!.rule).toEqual({
            // Raw-narration placeholder (never applied), not "DOD Interest".
            counterparty: "LAP DOD INT JUN22",
            type: null,
            // Rule-owned Notes are not copied into the learned rule.
            notes: null,
            categoryId: "cat-interest",
        });
    });

    it("rows without a custom rule keep learning exactly as before", async () => {
        const { service, preview, upserts } = await previewWithRule();

        const edited = preview.candidates.map(candidate =>
            candidate.rowNumber === 3
                ? { ...candidate, payee: "Supplier One", notes: "Invoice" }
                : candidate
        );

        await service.importCandidates(
            "acct-od",
            "statement.csv",
            "BANK_CSV",
            edited,
            null,
            undefined,
            baselines(preview.candidates)
        );

        expect(upserts).toHaveLength(1);
        expect(upserts[0]!.rule).toMatchObject({
            counterparty: "Supplier One",
            notes: "Invoice",
        });
    });
});

describe("Import Rules management - list all, edit, delete", () => {
    it("lists every account's rules, newest first, without an active import", async () => {
        const { service } = makeService();

        const od = await service.createCustomRule({
            accountId: "acct-od",
            keyword: "LAP DOD INT",
            payee: "DOD Interest",
        });
        const savings = await service.createCustomRule({
            accountId: "acct-savings",
            keyword: "SALARY",
            categoryId: "cat-salary",
        });

        expect(
            (await service.listAllCustomRules()).map(rule => [rule.id, rule.accountId])
        ).toEqual([
            [savings.id, "acct-savings"],
            [od.id, "acct-od"],
        ]);
    });

    it("editing updates the existing rule in place - no duplicate, same id and created date", async () => {
        const { db, service } = makeService();

        const saved = await service.createCustomRule({
            accountId: "acct-od",
            keyword: "LAP DOD INT",
            payee: "DOD Interest",
        });

        const updated = await service.updateCustomRule(saved.id, {
            accountId: "acct-od",
            keyword: "  LAP  DOD ",
            payee: "Overdraft Interest",
            notes: " Monthly ",
            categoryId: "cat-interest",
            transactionType: "NET_BANKING",
        });

        expect(updated).toMatchObject({
            id: saved.id,
            accountId: "acct-od",
            keyword: "LAP DOD",
            payee: "Overdraft Interest",
            notes: "Monthly",
            categoryId: "cat-interest",
            transactionType: "NET_BANKING",
            createdAt: saved.createdAt,
        });
        expect(db.prepare("SELECT COUNT(*) AS n FROM import_custom_rules").get()).toEqual({ n: 1 });
        expect(await service.listAllCustomRules()).toEqual([updated]);
    });

    it("editing can clear a field (stored as null) but not leave the rule empty", async () => {
        const { service } = makeService();

        const saved = await service.createCustomRule({
            accountId: "acct-od",
            keyword: "LAP DOD INT",
            payee: "DOD Interest",
            notes: "Interest",
        });

        expect(
            await service.updateCustomRule(saved.id, {
                accountId: "acct-od",
                keyword: "LAP DOD INT",
                payee: "",
                notes: "Interest",
            })
        ).toMatchObject({ payee: null, notes: "Interest" });

        await expect(
            service.updateCustomRule(saved.id, {
                accountId: "acct-od",
                keyword: "LAP DOD INT",
                payee: " ",
            })
        ).rejects.toThrow("Set at least one of Payee, Notes, Category or Type.");

        await expect(
            service.updateCustomRule(saved.id, {
                accountId: "acct-od",
                keyword: " ",
                payee: "X",
            })
        ).rejects.toThrow("Enter a keyword");
    });

    it("editing keeps the rule's precedence position (newest-first order unchanged)", async () => {
        const { service } = makeService();

        const older = await service.createCustomRule({
            accountId: "acct-od",
            keyword: "DOD INT",
            payee: "Older",
        });
        const newer = await service.createCustomRule({
            accountId: "acct-od",
            keyword: "LAP DOD INT",
            payee: "Newer",
        });

        await service.updateCustomRule(older.id, {
            accountId: "acct-od",
            keyword: "DOD INT",
            payee: "Older (edited)",
        });

        expect((await service.listCustomRules("acct-od")).map(r => r.id)).toEqual([
            newer.id,
            older.id,
        ]);
        expect((await service.previewCsv("acct-od", JUNE_STATEMENT)).candidates[0]!.payee).toBe(
            "Newer"
        );
    });

    it("the updated rule applies to future imports", async () => {
        const { service } = makeService();

        const saved = await service.createCustomRule({
            accountId: "acct-od",
            keyword: "LAP DOD INT",
            payee: "DOD Interest",
        });

        await service.updateCustomRule(saved.id, {
            accountId: "acct-od",
            keyword: "BILLDESK",
            payee: "SBI Card",
            categoryId: "cat-card",
        });

        const later = await service.previewCsv("acct-od", LATER_STATEMENT);

        expect(later.candidates.map(c => [c.payee, c.categoryId ?? null])).toEqual([
            ["lap  dod int July22", null],
            ["LAP DOD INT AUG22", null],
            ["SBI Card", "cat-card"],
        ]);
    });

    it("account scoping: moving a rule to another account moves where it applies", async () => {
        const { service } = makeService();

        const saved = await service.createCustomRule({
            accountId: "acct-od",
            keyword: "LAP DOD INT",
            payee: "DOD Interest",
        });

        await service.updateCustomRule(saved.id, {
            accountId: "acct-savings",
            keyword: "LAP DOD INT",
            payee: "DOD Interest",
        });

        expect(await service.listCustomRules("acct-od")).toEqual([]);
        expect((await service.listCustomRules("acct-savings")).map(r => r.id)).toEqual([saved.id]);
        expect((await service.previewCsv("acct-od", JUNE_STATEMENT)).candidates[0]!.payee).toBe(
            "LAP DOD INT JUN22"
        );
        expect((await service.previewCsv("acct-savings", JUNE_STATEMENT)).candidates[0]!.payee).toBe(
            "DOD Interest"
        );
    });

    it("an edited rule is re-applied to an active preview; unrelated rows keep their values", async () => {
        const { service } = makeService();

        const saved = await service.createCustomRule({
            accountId: "acct-od",
            keyword: "LAP DOD INT",
            payee: "DOD Interest",
        });

        let preview = await service.previewCsv("acct-od", JUNE_STATEMENT);
        expect(preview.candidates[0]!.payee).toBe("DOD Interest");

        await service.updateCustomRule(saved.id, {
            accountId: "acct-od",
            keyword: "LAP DOD INT",
            payee: "Overdraft Interest",
            notes: "Monthly",
        });

        preview = reapplyCustomImportRules(preview, await service.listCustomRules("acct-od"));

        expect(preview.candidates.map(c => [c.payee, c.notes])).toEqual([
            ["Overdraft Interest", "Monthly"],
            ["IMPS/NA/XXXX0001/SUPPLIER ONE", null],
        ]);
        expect(preview.customRuleState!.applications.get(2)!.ruleIds).toEqual([saved.id]);
    });

    it("a deleted rule is removed from an active preview, restoring the Self-Learning values", async () => {
        const { service, learned } = makeService();

        const juneRow = (await service.previewCsv("acct-od", JUNE_STATEMENT)).candidates[0]!;
        learned.set(`acct-od::${learningKeyForCandidate(juneRow)}`, {
            counterparty: "Learned Payee",
            type: "NEFT",
            notes: "Learned notes",
            categoryId: "cat-learned",
        });

        const saved = await service.createCustomRule({
            accountId: "acct-od",
            keyword: "LAP DOD INT",
            payee: "DOD Interest",
            notes: "Rule notes",
        });

        let preview = await service.previewCsv("acct-od", JUNE_STATEMENT);
        expect(preview.candidates[0]).toMatchObject({ payee: "DOD Interest", notes: "Rule notes" });

        await service.deleteCustomRule(saved.id);
        preview = reapplyCustomImportRules(preview, await service.listCustomRules("acct-od"));

        expect(preview.candidates[0]).toMatchObject({
            payee: "Learned Payee",
            notes: "Learned notes",
            categoryId: "cat-learned",
            transactionType: "NEFT",
            description: "LAP DOD INT JUN22",
        });
        expect(preview.customRuleState!.applications.size).toBe(0);
        // Still shown as Self-Learned.
        expect(preview.matchedLearnedRuleRowNumbers.has(2)).toBe(true);
    });

    it("a resumed preview picks up rule edits, and is left as-is when nothing changed", async () => {
        const { service } = makeService();

        const saved = await service.createCustomRule({
            accountId: "acct-od",
            keyword: "LAP DOD INT",
            payee: "DOD Interest",
        });

        const preview = await service.previewCsv("acct-od", JUNE_STATEMENT);

        // Unchanged rules -> the very same preview (nothing to re-save).
        expect(
            reapplyCustomImportRulesIfChanged(preview, await service.listCustomRules("acct-od"))
        ).toBe(preview);

        await service.updateCustomRule(saved.id, {
            accountId: "acct-od",
            keyword: "LAP DOD INT",
            payee: "Overdraft Interest",
        });

        const resumed = reapplyCustomImportRulesIfChanged(
            preview,
            await service.listCustomRules("acct-od")
        );

        expect(resumed).not.toBe(preview);
        expect(resumed.candidates[0]!.payee).toBe("Overdraft Interest");

        await service.deleteCustomRule(saved.id);

        expect(
            reapplyCustomImportRulesIfChanged(resumed, []).candidates[0]!.payee
        ).toBe("LAP DOD INT JUN22");
    });

    it("adding, editing and deleting rules never changes historical transactions or learned rules", async () => {
        const { db, service, createdTransactions, upserts } = makeService();

        db.exec(`
            CREATE TABLE transactions (id TEXT PRIMARY KEY, account_id TEXT, payee TEXT, notes TEXT);
            INSERT INTO transactions VALUES ('t-old', 'acct-od', 'LAP DOD INT MAY22', NULL);
        `);

        const saved = await service.createCustomRule({
            accountId: "acct-od",
            keyword: "LAP DOD INT",
            payee: "DOD Interest",
        });

        const preview = await service.previewCsv("acct-od", JUNE_STATEMENT);
        await service.importCandidates("acct-od", "june.csv", "BANK_CSV", preview.candidates);

        const importedSnapshot = structuredClone(createdTransactions);
        const upsertsSnapshot = structuredClone(upserts);
        const tableSnapshot = db.prepare("SELECT * FROM transactions").all();

        await service.updateCustomRule(saved.id, {
            accountId: "acct-od",
            keyword: "LAP DOD INT",
            payee: "Overdraft Interest",
        });
        await service.createCustomRule({
            accountId: "acct-od",
            keyword: "SUPPLIER",
            payee: "Supplier One",
        });
        await service.deleteCustomRule(saved.id);

        expect(createdTransactions).toEqual(importedSnapshot);
        expect(importedSnapshot[0]).toMatchObject({ payee: "DOD Interest" });
        expect(upserts).toEqual(upsertsSnapshot);
        expect(db.prepare("SELECT * FROM transactions").all()).toEqual(tableSnapshot);
    });
});
