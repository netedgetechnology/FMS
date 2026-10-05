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
import { TransactionService } from "@/modules/transactions/services/TransactionService";

import { ImportService } from "./ImportService";

// ---------------------------------------------------------------------
// transactions.is_imported: true for every transaction an import creates,
// false for manual entries, and never touched on a duplicate row's
// existing transaction. Real ImportService / TransactionService /
// repositories (incl. findDuplicate's SQL) on an in-memory database built
// from the app's migrations - harness as in ImportService.duplicateScope.
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

const ACCOUNT = "acct-test";

function candidate(
    rowNumber: number,
    overrides: Partial<NormalizedTransactionCandidate> = {}
): NormalizedTransactionCandidate {
    return {
        rowNumber,
        transactionDate: "2026-08-01",
        payee: "Test",
        description: "Test",
        amount: 100,
        type: "expense",
        referenceNumber: null,
        externalTransactionId: null,
        balance: null,
        branch: null,
        transactionType: null,
        counterparty: null,
        notes: null,
        rawData: {},
        ...overrides,
    };
}

function transactionService(): TransactionService {
    const service = new TransactionService();

    Object.defineProperty(service, "accountRepository", {
        value: {
            getAll: async () => [{ id: ACCOUNT, businessEntityId: null, openingBalance: 0 }],
            getById: async (id: string) =>
                id === ACCOUNT ? { id, businessEntityId: null, openingBalance: 0 } : null,
        },
    });
    Object.defineProperty(service, "categoryRepository", {
        value: { getAll: async () => [], getById: async () => null },
    });
    Object.defineProperty(service, "categoryContextMappingRepository", {
        value: { getByCategoryId: async () => [] },
    });

    return service;
}

function runImport(candidates: NormalizedTransactionCandidate[]) {
    const service = new ImportService();

    Object.defineProperty(service, "transactionService", { value: transactionService() });
    Object.defineProperty(service, "counterpartyRuleRepository", {
        value: { findByAccountAndPattern: async () => null, upsert: async () => null },
    });
    Object.defineProperty(service, "customRuleRepository", {
        value: { listByAccount: async () => [], listAll: async () => [] },
    });

    return service.importCandidates(
        ACCOUNT,
        "SBI Card Statement.pdf",
        "CREDIT_CARD_PDF",
        candidates,
        "SBI Card Mapping"
    );
}

const allTransactions = () =>
    sqlite.db!.prepare("SELECT * FROM transactions ORDER BY transaction_date, id").all() as Record<string, unknown>[];

const transaction = (id: string) =>
    sqlite.db!.prepare("SELECT * FROM transactions WHERE id = ?").get(id) as Record<string, unknown>;

const importedTransactionId = (batchId: string, rowNumber: number) =>
    (sqlite.db!
        .prepare("SELECT transaction_id FROM import_rows WHERE import_batch_id = ? AND row_number = ?")
        .get(batchId, rowNumber) as { transaction_id: string }).transaction_id;

const rowStatus = (batchId: string, rowNumber: number) =>
    (sqlite.db!
        .prepare("SELECT status, transaction_id FROM import_rows WHERE import_batch_id = ? AND row_number = ?")
        .get(batchId, rowNumber) as { status: string; transaction_id: string | null });

beforeEach(() => {
    const db = new DatabaseSync(":memory:");

    db.exec(
        `CREATE TABLE accounts (id TEXT PRIMARY KEY);
         CREATE TABLE currencies (id TEXT PRIMARY KEY);
         INSERT INTO accounts (id) VALUES ('${ACCOUNT}');`
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

describe("is_imported", () => {
    it("A. every transaction created by an import is saved with is_imported = 1", async () => {
        const batch = await runImport([
            candidate(1, { payee: "Limestone Network", description: "LIMESTONE NETWORK PAYPAL", amount: 1250 }),
            candidate(2, { payee: "Refund", description: "REFUND CREDIT", amount: 300, type: "income", transactionDate: "2026-08-02" }),
        ]);

        expect(batch).toMatchObject({ status: "COMPLETED", importedRows: 2, duplicateRows: 0, failedRows: 0 });
        expect(allTransactions().map(t => t.is_imported)).toEqual([1, 1]);
    });

    it("D. every other column of an imported transaction is exactly what the import produced before this change", async () => {
        const batch = await runImport([
            candidate(7, {
                transactionDate: "2026-08-15",
                payee: "Limestone Network",
                description: "LIMESTONE NETWORK PAYPAL *LIMESTONE",
                amount: 1250,
                type: "expense",
                referenceNumber: "REF-0815",
                externalTransactionId: "EXT-0815",
                branch: "Singapore",
                transactionType: "CREDIT_CARD",
                counterparty: "Limestone Pte Ltd",
                notes: "Hosting",
            }),
        ]);

        const row = transaction(importedTransactionId(batch.id, 7));

        expect(row).toMatchObject({
            account_id: ACCOUNT,
            category_id: null,
            subcategory_id: null,
            payee: "Limestone Network",
            // The import never passes counterparty - unchanged.
            counterparty: null,
            branch: "Singapore",
            type: "expense",
            transfer_direction: null,
            amount: 1250,
            transaction_date: "2026-08-15",
            reference_number: "REF-0815",
            notes: "Hosting",
            tags: null,
            status: "CLEARED",
            payment_method: null,
            upi_reference: null,
            bank_transaction_reference: null,
            card_reference: null,
            transaction_type: "CREDIT_CARD",
            reconciled: 0,
            reconciled_at: null,
            is_imported: 1,
            source_statement: "SBI Card Mapping",
            external_transaction_id: "EXT-0815",
            original_narration: "LIMESTONE NETWORK PAYPAL *LIMESTONE",
            deleted_at: null,
        });
        expect(rowStatus(batch.id, 7)).toMatchObject({ status: "IMPORTED" });
    });

    it("B. a manually created transaction is still saved with is_imported = 0", async () => {
        const id = await transactionService().create({
            accountId: ACCOUNT,
            payee: "Corner Store",
            type: "expense",
            amount: 200,
            transactionDate: "2026-08-20",
        });

        expect(transaction(id).is_imported).toBe(0);
    });

    it("C. a duplicate row leaves an existing MANUAL transaction completely untouched (still is_imported = 0)", async () => {
        const manualId = await transactionService().create({
            accountId: ACCOUNT,
            payee: "Rent",
            type: "expense",
            amount: 15000,
            transactionDate: "2026-08-01",
            referenceNumber: "RENT-AUG",
            originalNarration: "NEFT RENT AUG",
        });
        const before = transaction(manualId);

        const batch = await runImport([
            candidate(1, {
                payee: "Rent",
                description: "NEFT RENT AUG",
                amount: 15000,
                referenceNumber: "RENT-AUG",
                transactionType: "NEFT",
            }),
        ]);

        expect(batch).toMatchObject({ importedRows: 0, duplicateRows: 1 });
        expect(rowStatus(batch.id, 1)).toEqual({ status: "DUPLICATE", transaction_id: manualId });
        expect(transaction(manualId)).toEqual(before);
        expect(allTransactions()).toHaveLength(1);
    });

    it("C. re-importing a statement: duplicates leave the earlier imported transactions untouched", async () => {
        const statement = [
            candidate(1, { payee: "Cafe", description: "UPI CAFE", amount: 120, referenceNumber: "UPI-1" }),
            candidate(2, { payee: "Fuel", description: "UPI FUEL", amount: 900, referenceNumber: "UPI-2" }),
        ];
        await runImport(statement);
        const before = allTransactions();

        const second = await runImport(statement);

        expect(second).toMatchObject({ importedRows: 0, duplicateRows: 2 });
        expect(allTransactions()).toEqual(before);
        expect(before.map(t => t.is_imported)).toEqual([1, 1]);
    });
});
