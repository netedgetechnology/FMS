import { DatabaseSync } from "node:sqlite";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NormalizedTransactionCandidate } from "@financeos/import-engine";

import { CounterpartyRulesMigration } from "@/core/database/migrations/026_counterparty_rules";
import { CounterpartyRulesAccountScopeMigration } from "@/core/database/migrations/027_counterparty_rules_account_scope";
import { CounterpartyRulesTypeNotesMigration } from "@/core/database/migrations/028_counterparty_rules_type_notes";
import { CounterpartyRulesCategoryMigration } from "@/core/database/migrations/039_counterparty_rules_category";
import { TransactionSchemaMigration } from "@/core/database/migrations/003_transactions";
import { TransactionDetailsMigration } from "@/core/database/migrations/014_transaction_details";
import { TransactionChannelTypeMigration } from "@/core/database/migrations/024_transaction_type";
import { TransactionCounterpartyBranchMigration } from "@/core/database/migrations/025_transaction_counterparty_branch";
import { TransactionTransferDirectionMigration } from "@/core/database/migrations/040_transaction_transfer_direction";
import type { Category } from "@/modules/categories/types";
import { TransactionService } from "@/modules/transactions/services/TransactionService";

import {
    applyCategoryToMatchingRows,
    applyNotesToMatchingRows,
    applyPayeeToMatchingRows,
    applyPreviewOverrides,
    applyTransactionTypeToMatchingRows,
    createEmptyPreviewOverrides,
    type PreviewOverrides,
} from "../pages/ImportsPage";
import { withRowCategory } from "../pages/importCategoryOptions";
import { CounterpartyRuleRepository } from "../repositories/CounterpartyRuleRepository";

import {
    enrichCandidatesWithLearnedRulesDetailed,
    learnRuleFromCandidate,
} from "./ImportService";

// ---------------------------------------------------------------------
// Import self-learning - the complete lifecycle, against the REAL
// counterparty_rules table (migrations 026/027/028/039) and
// CounterpartyRuleRepository SQL; SQLiteProvider is mocked to an
// in-memory database.
//
//   import 1: parse -> user corrects in the preview (ImportsPage's own
//             override functions) -> import learns from each row's final
//             values (learnRuleFromCandidate, exactly as
//             ImportService.executeCandidates calls it)
//   re-import: the same statement is parsed again -> learned values are
//             re-applied (enrichCandidatesWithLearnedRulesDetailed)
//
// Narrations are the real ones from the reported statement.
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

const NETEDGE = "acct-netedge";
const OTHER = "acct-other";

const KELIKA_DEBIT = "NEFT/MB/AXOMB25902135240/KELIKA SPORTS/ICICI BANK LIMITED/Others-Transfer";
const KELIKA_DEBIT_REIMPORT = "NEFT/MB/AXOMB26011223344/KELIKA SPORTS/ICICI BANK LIMITED/Others-Transfer";
const MKS_CREDIT = "RTGS/MAHBR52026080324679176/MKS CONSTRO VENTURE PR/BANK OF MAHARASHTRA//URGENT///.//.";
const PAYPAL_CREDIT = "NEFT/CITIN26733891285/PAYPAL PAYMENTS PVT L PACB I/CITI BANK/P0802BUQKTSD75C6U6       -AFN";

function category(id: string, name: string, isActive = true): Category {
    return {
        id, parentId: null, name, categoryType: "INCOME", financeScope: "BUSINESS",
        businessEntityId: null, description: null, isActive, createdAt: "", updatedAt: "",
    };
}

// A freshly parsed statement row: Payee defaults to the narration, no
// notes, no category (exactly what the importer produces).
function parsed(
    rowNumber: number,
    description: string,
    type: "income" | "expense",
    transactionType: NormalizedTransactionCandidate["transactionType"] = "NEFT"
): NormalizedTransactionCandidate {
    return {
        rowNumber, transactionDate: "2026-09-10", payee: description, description,
        amount: 1000 + rowNumber, type, referenceNumber: null, externalTransactionId: null,
        transactionType, balance: null, branch: null, counterparty: null, notes: null,
        categoryId: null, rawData: {},
    };
}

const rules = () => new CounterpartyRuleRepository();

// Import 1: preview edits -> import (learning from every final row).
async function importWithEdits(
    accountId: string,
    rows: NormalizedTransactionCandidate[],
    edit: (overrides: PreviewOverrides) => PreviewOverrides
): Promise<NormalizedTransactionCandidate[]> {
    const { candidates: enriched } = await enrichCandidatesWithLearnedRulesDetailed(accountId, rows, rules());
    const finals = applyPreviewOverrides(enriched, edit(createEmptyPreviewOverrides()));

    // Exactly as ImportsPage -> executeCandidates: each final row is
    // compared against the row as previewed (enriched, before edits).
    for (const [index, candidate] of finals.entries()) {
        await learnRuleFromCandidate(accountId, candidate, rules(), enriched[index]);
    }

    return finals;
}

// Re-import: a fresh parse of the same statement, enriched from rules.
async function reimport(accountId: string, rows: NormalizedTransactionCandidate[]) {
    return enrichCandidatesWithLearnedRulesDetailed(accountId, rows, rules());
}

beforeEach(() => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE accounts (id TEXT PRIMARY KEY); INSERT INTO accounts (id) VALUES ('${NETEDGE}'), ('${OTHER}');`);
    for (const migration of [
        CounterpartyRulesMigration,
        CounterpartyRulesAccountScopeMigration,
        CounterpartyRulesTypeNotesMigration,
        CounterpartyRulesCategoryMigration,
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

describe("reported failures - learned values are restored on re-import", () => {
    it("1. Payee 'Kelika Sports' is restored", async () => {
        const base = [parsed(2, KELIKA_DEBIT, "expense")];
        await importWithEdits(NETEDGE, base, o => applyPayeeToMatchingRows(base, o, 2, "Kelika Sports"));

        const { candidates, matchedRowNumbers } = await reimport(NETEDGE, [parsed(7, KELIKA_DEBIT_REIMPORT, "expense")]);

        expect(candidates[0].payee).toBe("Kelika Sports");
        expect(matchedRowNumbers.has(7)).toBe(true);
    });

    it("2. Payee 'MKS Constro Venture', Category 'Hosting Revenue' and Notes are all restored", async () => {
        const base = [parsed(2, MKS_CREDIT, "income", "RTGS")];
        await importWithEdits(NETEDGE, base, o => {
            let next = applyPayeeToMatchingRows(base, o, 2, "MKS Constro Venture");
            next = applyCategoryToMatchingRows(base, next, 2, "cat-hosting-revenue");
            return applyNotesToMatchingRows(base, next, 2, "Payment of hosting services for HostInstance");
        });

        const { candidates } = await reimport(NETEDGE, [parsed(4, MKS_CREDIT, "income", "RTGS")]);

        expect(candidates[0]).toMatchObject({
            payee: "MKS Constro Venture",
            categoryId: "cat-hosting-revenue",
            notes: "Payment of hosting services for HostInstance",
            transactionType: "RTGS",
        });
    });

    it("3. Payee 'Paypal Payments' and Category 'Payment Gateway' are restored", async () => {
        const base = [parsed(2, PAYPAL_CREDIT, "income")];
        await importWithEdits(NETEDGE, base, o =>
            applyCategoryToMatchingRows(base, applyPayeeToMatchingRows(base, o, 2, "Paypal Payments"), 2, "cat-payment-gateway")
        );

        const { candidates } = await reimport(NETEDGE, [parsed(9, PAYPAL_CREDIT, "income")]);

        expect(candidates[0]).toMatchObject({ payee: "Paypal Payments", categoryId: "cat-payment-gateway" });
    });

    it("stores exactly the corrected values under the direction-aware key, scoped to the account", async () => {
        const base = [parsed(2, MKS_CREDIT, "income", "RTGS")];
        await importWithEdits(NETEDGE, base, o =>
            applyNotesToMatchingRows(base, applyPayeeToMatchingRows(base, o, 2, "MKS Constro Venture"), 2, "Hosting")
        );

        expect(
            sqlite.db!.prepare("SELECT account_id, pattern, counterparty, type, notes FROM counterparty_rules").all()
        ).toEqual([
            {
                account_id: NETEDGE,
                pattern: "CREDIT|RTGS/MAHBR#/MKS CONSTRO VENTURE PR/BANK OF MAHARASHTRA//URGENT///.//.",
                counterparty: "MKS Constro Venture",
                type: "RTGS",
                notes: "Hosting",
            },
        ]);
    });
});

describe("matching rules", () => {
    it("4 / 10. Debit and Credit versions of the same narration are independent - a different direction never matches", async () => {
        const base = [parsed(2, KELIKA_DEBIT, "expense")];
        await importWithEdits(NETEDGE, base, o => applyPayeeToMatchingRows(base, o, 2, "Kelika Sports"));

        const { candidates, matchedRowNumbers } = await reimport(NETEDGE, [parsed(3, KELIKA_DEBIT, "income")]);

        expect(candidates[0].payee).toBe(KELIKA_DEBIT);
        expect(matchedRowNumbers.size).toBe(0);
    });

    it("5. Account A's learned rule never applies to Account B", async () => {
        const base = [parsed(2, KELIKA_DEBIT, "expense")];
        await importWithEdits(NETEDGE, base, o => applyPayeeToMatchingRows(base, o, 2, "Kelika Sports"));

        const { candidates, matchedRowNumbers } = await reimport(OTHER, [parsed(3, KELIKA_DEBIT, "expense")]);

        expect(candidates[0].payee).toBe(KELIKA_DEBIT);
        expect(matchedRowNumbers.size).toBe(0);
    });

    it("ignores case/whitespace differences in the narration; only the reference digits vary", async () => {
        const base = [parsed(2, KELIKA_DEBIT, "expense")];
        await importWithEdits(NETEDGE, base, o => applyPayeeToMatchingRows(base, o, 2, "Kelika Sports"));

        const { candidates } = await reimport(NETEDGE, [
            parsed(3, "  neft/mb/AXOMB11111111111/Kelika Sports/ICICI BANK LIMITED/Others-Transfer ", "expense"),
        ]);

        expect(candidates[0].payee).toBe("Kelika Sports");
    });
});

describe("application", () => {
    it("6. a learned category is applied, and shown as '(unavailable)' if later deactivated", async () => {
        const base = [parsed(2, PAYPAL_CREDIT, "income")];
        await importWithEdits(NETEDGE, base, o => applyCategoryToMatchingRows(base, o, 2, "cat-payment-gateway"));

        const { candidates } = await reimport(NETEDGE, [parsed(3, PAYPAL_CREDIT, "income")]);
        expect(candidates[0].categoryId).toBe("cat-payment-gateway");

        // Category deactivated since: the rule's category id is kept and
        // shown as unavailable rather than silently dropped.
        const options = withRowCategory([], candidates[0].categoryId, [category("cat-payment-gateway", "Payment Gateway", false)], false);
        expect(options).toEqual([expect.objectContaining({ id: "cat-payment-gateway", unavailable: true })]);
    });

    it("7. learned Notes are restored even though the statement has no notes", async () => {
        const base = [parsed(2, MKS_CREDIT, "income", "RTGS")];
        await importWithEdits(NETEDGE, base, o => applyNotesToMatchingRows(base, o, 2, "Hosting for HostInstance"));

        const fresh = parsed(3, MKS_CREDIT, "income", "RTGS");
        expect(fresh.notes).toBeNull();

        const { candidates } = await reimport(NETEDGE, [fresh]);
        expect(candidates[0].notes).toBe("Hosting for HostInstance");
    });

    it("8. a manual edit during the current import overrides the learned value - and is learned next", async () => {
        const base = [parsed(2, KELIKA_DEBIT, "expense")];
        await importWithEdits(NETEDGE, base, o => applyPayeeToMatchingRows(base, o, 2, "Kelika Sports"));

        // Re-import: learned "Kelika Sports" applied, user changes it.
        const second = [parsed(3, KELIKA_DEBIT_REIMPORT, "expense")];
        const finals = await importWithEdits(NETEDGE, second, o =>
            applyPayeeToMatchingRows(second, o, 3, "Kelika Sports Pvt Ltd")
        );
        expect(finals[0].payee).toBe("Kelika Sports Pvt Ltd");

        const { candidates } = await reimport(NETEDGE, [parsed(4, KELIKA_DEBIT, "expense")]);
        expect(candidates[0].payee).toBe("Kelika Sports Pvt Ltd");
    });

    it("9. latest-edit propagation across matching rows in the same import still works", async () => {
        const base = [parsed(2, KELIKA_DEBIT, "expense"), parsed(3, KELIKA_DEBIT_REIMPORT, "expense")];

        let overrides = applyPayeeToMatchingRows(base, createEmptyPreviewOverrides(), 2, "Kelika");
        overrides = applyPayeeToMatchingRows(base, overrides, 3, "Kelika Sports");

        expect(applyPreviewOverrides(base, overrides).map(c => c.payee)).toEqual(["Kelika Sports", "Kelika Sports"]);
    });
});

describe("no fake 'learned' rules from uncorrected rows", () => {
    it("an uncorrected row (Payee = its narration, no notes/category) creates no rule", async () => {
        await importWithEdits(NETEDGE, [parsed(2, KELIKA_DEBIT, "expense")], o => o);

        expect(sqlite.db!.prepare("SELECT COUNT(*) AS n FROM counterparty_rules").get()).toEqual({ n: 0 });
    });

    it("an uncorrected row never overwrites a learned Payee on re-import", async () => {
        const base = [parsed(2, KELIKA_DEBIT, "expense")];
        await importWithEdits(NETEDGE, base, o => applyPayeeToMatchingRows(base, o, 2, "Kelika Sports"));

        // Re-import without touching it: the learned value is applied and kept.
        await importWithEdits(NETEDGE, [parsed(3, KELIKA_DEBIT_REIMPORT, "expense")], o => o);

        expect(sqlite.db!.prepare("SELECT counterparty FROM counterparty_rules").all()).toEqual([{ counterparty: "Kelika Sports" }]);
    });

    it("an existing rule holding only the raw narration is applied but not shown as learned (existing rules untouched)", async () => {
        // Like the rules in the reported database: Payee = raw narration.
        await rules().upsert(NETEDGE, "DEBIT|NEFT/MB/AXOMB#/KELIKA SPORTS/ICICI BANK LIMITED/OTHERS-TRANSFER", KELIKA_DEBIT, "NEFT", null, null);
        const before = sqlite.db!.prepare("SELECT * FROM counterparty_rules").all();

        const { candidates, matchedRowNumbers } = await reimport(NETEDGE, [parsed(3, KELIKA_DEBIT, "expense")]);

        expect(candidates[0].payee).toBe(KELIKA_DEBIT);
        expect(matchedRowNumbers.size).toBe(0);
        expect(sqlite.db!.prepare("SELECT * FROM counterparty_rules").all()).toEqual(before);
    });
});

describe("Transactions-page edits teach the same rule", () => {
    function service(): TransactionService {
        const s = new TransactionService();
        const categories = [category("cat-hosting-revenue", "Hosting Revenue")];

        Object.defineProperty(s, "accountRepository", {
            value: { getAll: async () => [], getById: async () => ({ id: NETEDGE, businessEntityId: null }) },
        });
        Object.defineProperty(s, "categoryRepository", {
            value: {
                getAll: async () => categories,
                getById: async (id: string) => categories.find(c => c.id === id) ?? null,
            },
        });
        Object.defineProperty(s, "categoryContextMappingRepository", { value: { getByCategoryId: async () => [] } });

        return s;
    }

    async function importedTransaction(description: string, type: "income" | "expense") {
        return service().create({
            accountId: NETEDGE, payee: description, type, amount: 5000, transactionDate: "2026-09-10",
            originalNarration: description, transactionType: "RTGS",
        });
    }

    const edit = (id: string, description: string, type: "income" | "expense", changes: Record<string, unknown>) =>
        service().update({
            id, accountId: NETEDGE, payee: description, type, amount: 5000, transactionDate: "2026-09-10",
            originalNarration: description, transactionType: "RTGS", ...changes,
        });

    it("editing Payee, Category and Notes in the Edit dialog is learned for the next import", async () => {
        const id = await importedTransaction(MKS_CREDIT, "income");

        await edit(id, MKS_CREDIT, "income", {
            payee: "MKS Constro Venture",
            categoryId: "cat-hosting-revenue",
            notes: "Hosting",
        });

        const { candidates, matchedRowNumbers } = await reimport(NETEDGE, [parsed(5, MKS_CREDIT, "income", "RTGS")]);

        expect(candidates[0]).toMatchObject({ payee: "MKS Constro Venture", categoryId: "cat-hosting-revenue", notes: "Hosting" });
        expect(matchedRowNumbers.has(5)).toBe(true);
    });

    it("an edit that doesn't touch Payee/Category/Notes teaches nothing", async () => {
        const id = await importedTransaction(KELIKA_DEBIT, "expense");

        await edit(id, KELIKA_DEBIT, "expense", { amount: 5000, transactionDate: "2026-09-11" });

        expect(sqlite.db!.prepare("SELECT COUNT(*) AS n FROM counterparty_rules").get()).toEqual({ n: 0 });
    });

    it("bulk Change Category never teaches rules", async () => {
        const id = await importedTransaction(PAYPAL_CREDIT, "income");

        await service().changeCategory([id], "cat-hosting-revenue");

        expect(sqlite.db!.prepare("SELECT COUNT(*) AS n FROM counterparty_rules").get()).toEqual({ n: 0 });
    });
});

describe("only genuine corrections are learned, and only learned values show as learned", () => {
    const KELIKA_KEY = "DEBIT|NEFT/MB/AXOMB#/KELIKA SPORTS/ICICI BANK LIMITED/OTHERS-TRANSFER";
    const ruleRows = () =>
        sqlite.db!.prepare("SELECT counterparty, type, notes, category_id, match_count FROM counterparty_rules").all();

    it("a raw-only rule stored from a SIBLING row (different reference number) is not learned: no green, row keeps its own narration", async () => {
        // The reported database: the Kelika rule held another row's raw narration.
        await rules().upsert(NETEDGE, KELIKA_KEY, KELIKA_DEBIT_REIMPORT, "NEFT", null, null);

        const { candidates, matchedRowNumbers } = await reimport(NETEDGE, [parsed(3, KELIKA_DEBIT, "expense")]);

        expect(candidates[0].payee).toBe(KELIKA_DEBIT);
        expect(candidates[0].transactionType).toBe("NEFT");
        expect(matchedRowNumbers.size).toBe(0);
    });

    it("uncorrected rows never create rules, even across many sibling narrations", async () => {
        await importWithEdits(NETEDGE, [
            parsed(2, KELIKA_DEBIT, "expense"),
            parsed(3, KELIKA_DEBIT_REIMPORT, "expense"),
            parsed(4, MKS_CREDIT, "income", "RTGS"),
        ], o => o);

        expect(ruleRows()).toEqual([]);
    });

    it("an uncorrected row never updates an existing raw-only rule (not even match_count)", async () => {
        await rules().upsert(NETEDGE, KELIKA_KEY, KELIKA_DEBIT_REIMPORT, "NEFT", null, null);
        const before = ruleRows();

        await importWithEdits(NETEDGE, [parsed(3, KELIKA_DEBIT, "expense")], o => o);

        expect(ruleRows()).toEqual(before);
    });

    it("an uncorrected row never updates a learned rule, with or without a preview baseline", async () => {
        const base = [parsed(2, KELIKA_DEBIT, "expense")];
        await importWithEdits(NETEDGE, base, o => applyPayeeToMatchingRows(base, o, 2, "Kelika Sports"));
        const before = ruleRows();

        await importWithEdits(NETEDGE, [parsed(3, KELIKA_DEBIT_REIMPORT, "expense")], o => o);
        // A caller with no baseline passing the raw parsed row, or the rule-applied row.
        await learnRuleFromCandidate(NETEDGE, parsed(4, KELIKA_DEBIT_REIMPORT, "expense"), rules());
        await learnRuleFromCandidate(NETEDGE, { ...parsed(5, KELIKA_DEBIT, "expense"), payee: "Kelika Sports" }, rules());

        expect(ruleRows()).toEqual(before);
        expect(before).toEqual([expect.objectContaining({ counterparty: "Kelika Sports", match_count: 1 })]);
    });

    it("correcting only Notes on a row with a learned Payee keeps the learned Payee", async () => {
        const base = [parsed(2, KELIKA_DEBIT, "expense")];
        await importWithEdits(NETEDGE, base, o => applyPayeeToMatchingRows(base, o, 2, "Kelika Sports"));

        const second = [parsed(3, KELIKA_DEBIT_REIMPORT, "expense")];
        await importWithEdits(NETEDGE, second, o => applyNotesToMatchingRows(second, o, 3, "Court rent"));

        expect(ruleRows()).toEqual([expect.objectContaining({ counterparty: "Kelika Sports", notes: "Court rent" })]);
    });

    it("a Notes-only correction on a never-learned row does not turn the raw narration into a learned Payee", async () => {
        const base = [parsed(2, KELIKA_DEBIT, "expense")];
        await importWithEdits(NETEDGE, base, o => applyNotesToMatchingRows(base, o, 2, "Court rent"));

        const { candidates, matchedRowNumbers } = await reimport(NETEDGE, [parsed(9, KELIKA_DEBIT_REIMPORT, "expense")]);

        expect(candidates[0]).toMatchObject({ payee: KELIKA_DEBIT_REIMPORT, notes: "Court rent" });
        expect(matchedRowNumbers.has(9)).toBe(true);
    });

    it("a genuine Type correction is learned, reapplied and shown as learned", async () => {
        const base = [parsed(2, KELIKA_DEBIT, "expense", "NEFT")];
        await importWithEdits(NETEDGE, base, o => applyTransactionTypeToMatchingRows(base, o, 2, "IMPS"));

        const { candidates, matchedRowNumbers } = await reimport(NETEDGE, [parsed(6, KELIKA_DEBIT_REIMPORT, "expense", "NEFT")]);

        expect(candidates[0]).toMatchObject({ transactionType: "IMPS", payee: KELIKA_DEBIT_REIMPORT });
        expect(matchedRowNumbers.has(6)).toBe(true);
    });

    it("a rule whose Type only equals the row's own detected Type is not shown as learned", async () => {
        await rules().upsert(NETEDGE, KELIKA_KEY, KELIKA_DEBIT, "NEFT", null, null);

        const { matchedRowNumbers } = await reimport(NETEDGE, [parsed(6, KELIKA_DEBIT_REIMPORT, "expense", "NEFT")]);

        expect(matchedRowNumbers.size).toBe(0);
    });

    it("a learned Payee on the Debit side never leaks to the Credit side of the same narration", async () => {
        const base = [parsed(2, KELIKA_DEBIT, "expense"), parsed(3, KELIKA_DEBIT, "income")];
        await importWithEdits(NETEDGE, base, o => applyPayeeToMatchingRows(base, o, 2, "Kelika Sports"));

        const { candidates, matchedRowNumbers } = await reimport(NETEDGE, [
            parsed(4, KELIKA_DEBIT_REIMPORT, "expense"),
            parsed(5, KELIKA_DEBIT_REIMPORT, "income"),
        ]);

        expect(candidates.map(c => c.payee)).toEqual(["Kelika Sports", KELIKA_DEBIT_REIMPORT]);
        expect([...matchedRowNumbers]).toEqual([4]);
    });
});

describe("Transactions-page edit never overwrites a learned Payee with the narration", () => {
    it("a Category-only edit on a transaction still showing its narration keeps the rule's learned Payee", async () => {
        const base = [parsed(2, KELIKA_DEBIT, "expense")];
        await importWithEdits(NETEDGE, base, o => applyPayeeToMatchingRows(base, o, 2, "Kelika Sports"));

        const s = new TransactionService();
        const categories = [{ ...category("cat-sports", "Sports"), categoryType: "EXPENSE" as const }];
        Object.defineProperty(s, "accountRepository", {
            value: { getAll: async () => [], getById: async () => ({ id: NETEDGE, businessEntityId: null }) },
        });
        Object.defineProperty(s, "categoryRepository", {
            value: { getAll: async () => categories, getById: async (id: string) => categories.find(c => c.id === id) ?? null },
        });
        Object.defineProperty(s, "categoryContextMappingRepository", { value: { getByCategoryId: async () => [] } });

        const txn = {
            accountId: NETEDGE, payee: KELIKA_DEBIT_REIMPORT, type: "expense" as const, amount: 700,
            transactionDate: "2026-09-10", originalNarration: KELIKA_DEBIT_REIMPORT, transactionType: "NEFT" as const,
        };
        const id = await s.create(txn);
        await s.update({ id, ...txn, categoryId: "cat-sports" });

        expect(sqlite.db!.prepare("SELECT counterparty, category_id FROM counterparty_rules").all()).toEqual([
            { counterparty: "Kelika Sports", category_id: "cat-sports" },
        ]);
    });
});
