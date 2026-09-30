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
// Duplicate detection during import must compare each row ONLY with
// transactions that existed before the import batch started. A row
// created earlier in the SAME batch must never make a later row of that
// batch a "duplicate" - a statement can legitimately contain identical
// rows. Re-importing an already-imported statement must still be caught.
//
// The real ImportService, its batch/row repositories, TransactionService
// and TransactionRepository (incl. findDuplicate's real SQL) run against
// an in-memory database built from the app's own migrations; only
// SQLiteProvider, category/account lookups and the learning stores are
// stubbed.
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
const OTHER_ACCOUNT = "acct-other";
const FAIL_PAYEE = "FAIL_ME";

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

function importService(): ImportService {
    const transactionService = new TransactionService();

    Object.defineProperty(transactionService, "accountRepository", {
        value: {
            getAll: async () => [
                { id: ACCOUNT, businessEntityId: null, openingBalance: 0 },
                { id: OTHER_ACCOUNT, businessEntityId: null, openingBalance: 0 },
            ],
            getById: async (id: string) =>
                [ACCOUNT, OTHER_ACCOUNT].includes(id)
                    ? { id, businessEntityId: null, openingBalance: 0 }
                    : null,
        },
    });
    Object.defineProperty(transactionService, "categoryRepository", {
        value: { getAll: async () => [], getById: async () => null },
    });
    Object.defineProperty(transactionService, "categoryContextMappingRepository", {
        value: { getByCategoryId: async () => [] },
    });

    // A row whose Payee is FAIL_PAYEE fails at transaction creation - the
    // same per-row catch path any real create failure takes.
    const create = transactionService.create.bind(transactionService);
    transactionService.create = async request => {
        if (request.payee === FAIL_PAYEE) {
            throw new Error("Simulated create failure.");
        }
        return create(request);
    };

    const service = new ImportService();

    Object.defineProperty(service, "transactionService", {
        value: transactionService,
    });
    Object.defineProperty(service, "counterpartyRuleRepository", {
        value: {
            findByAccountAndPattern: async () => null,
            upsert: async () => null,
        },
    });
    Object.defineProperty(service, "customRuleRepository", {
        value: { listByAccount: async () => [], listAll: async () => [] },
    });

    return service;
}

function runImport(
    candidates: NormalizedTransactionCandidate[],
    accountId = ACCOUNT
) {
    return importService().importCandidates(
        accountId,
        "Test Bank OD Account.pdf",
        "BANK_PDF",
        candidates
    );
}

function transactionCount(accountId = ACCOUNT): number {
    return (
        sqlite.db!
            .prepare(
                "SELECT COUNT(*) AS n FROM transactions WHERE account_id = ? AND deleted_at IS NULL"
            )
            .get(accountId) as { n: number }
    ).n;
}

function rowStatuses(batchId: string): Record<number, string> {
    const rows = sqlite.db!
        .prepare(
            "SELECT row_number, status FROM import_rows WHERE import_batch_id = ? ORDER BY row_number"
        )
        .all(batchId) as Array<{ row_number: number; status: string }>;

    return Object.fromEntries(rows.map(row => [row.row_number, row.status]));
}

// 8 regression pairs modelled on a real OD-account statement import (an
// account with no transactions before the import) where each FLAGGED row
// was wrongly skipped as a duplicate of the EARLIER row of the same
// statement. Names, references and account identifiers are synthetic;
// dates, amounts, directions, row numbers and which fields match within
// each pair are preserved. Most share a cut-off, non-unique reference
// ("IMPS/TESTCP", "IMPS/NA/XXXX0003/RRN"); the first pair is fully
// identical.
const REGRESSION_PAIRS: Array<{
    earlier: Partial<NormalizedTransactionCandidate>;
    flagged: Partial<NormalizedTransactionCandidate>;
}> = [
    {
        earlier: { rowNumber: 164, transactionDate: "2022-09-27", type: "income", amount: 90000, referenceNumber: "TEST-REF-0001", payee: "Test Company", description: "NET-OAT-TEST COMPANY-" },
        flagged: { rowNumber: 165, transactionDate: "2022-09-27", type: "income", amount: 90000, referenceNumber: "TEST-REF-0001", payee: "Test Company", description: "NET-OAT-TEST COMPANY-" },
    },
    {
        earlier: { rowNumber: 240, transactionDate: "2023-01-02", type: "income", amount: 43500, referenceNumber: "IMPS/TRANSFER/TESTCP", payee: "Test Sports Academy", description: "IMPS/TRANSFER/TEST SPORTS ACA/XXXX0001/RRN:TEST-RRN-0001/TEST BANK" },
        flagged: { rowNumber: 241, transactionDate: "2023-01-02", type: "income", amount: 43500, referenceNumber: "IMPS/TRANSFER/TESTCP", payee: "Test Sports Club", description: "IMPS/TRANSFER/TEST SPORTS CLUB/XXXX0002/RRN:TEST-RRN-0002/TEST BANK" },
    },
    {
        earlier: { rowNumber: 443, transactionDate: "2023-10-24", type: "expense", amount: 9260, referenceNumber: "TEST-CHQ-0001", payee: "Test Finance", description: "CTS CLG NUN TEST FINANCE LTD" },
        flagged: { rowNumber: 444, transactionDate: "2023-10-24", type: "expense", amount: 9260, referenceNumber: "TEST-CHQ-0002", payee: "Test Finance", description: "CTS CLG NUN TEST FINANCE LTD" },
    },
    {
        earlier: { rowNumber: 573, transactionDate: "2024-03-04", type: "expense", amount: 3000, referenceNumber: "IMPS/NA/XXXX0003/RRN", payee: "Test Hosting", description: "IMPS/NA/XXXX0003/RRN: TEST-RRN-0003/TESTTXN001/TEST BANK/TEST HOSTING/PAYMENT A" },
        flagged: { rowNumber: 577, transactionDate: "2024-03-04", type: "expense", amount: 3000, referenceNumber: "IMPS/NA/XXXX0003/RRN", payee: "Test Hosting", description: "IMPS/NA/XXXX0003/RRN: TEST-RRN-0004/TESTTXN002/TEST BANK/TEST HOSTING/PAYMENT B" },
    },
    {
        earlier: { rowNumber: 781, transactionDate: "2024-08-13", type: "expense", amount: 27000, referenceNumber: "IMPS/NA/XXXX0004/RRN", payee: "Test Employee", description: "IMPS/NA/XXXX0004/RRN: TEST-RRN-0005/TESTTXN003/TEST BANK/TESTEMPLOYEE/JULYSALARY" },
        flagged: { rowNumber: 783, transactionDate: "2024-08-13", type: "expense", amount: 27000, referenceNumber: "IMPS/NA/XXXX0004/RRN", payee: "Test Employee", description: "IMPS/NA/XXXX0004/RRN: TEST-RRN-0006/TESTTXN004/TEST BANK/TESTEMPLOYEE/JULYSALARY" },
    },
    {
        earlier: { rowNumber: 905, transactionDate: "2024-11-14", type: "income", amount: 30000, referenceNumber: "IMPS/TESTCP", payee: "Test Sports Academy", description: "IMPS/TEST SPORTS ACA/XXXX0001/RRN:TEST-RRN-0007/TEST BANK LIMITED" },
        flagged: { rowNumber: 907, transactionDate: "2024-11-14", type: "income", amount: 30000, referenceNumber: "IMPS/TESTCP", payee: "Test Sports Club", description: "IMPS/TEST SPORTS CLUB/XXXX0002/RRN: TEST-RRN-0008/TEST BANK LIMITED" },
    },
    {
        earlier: { rowNumber: 932, transactionDate: "2024-12-09", type: "income", amount: 500000, referenceNumber: "IMPS/MR", payee: "Test User", description: "IMPS/MR TEST USER/XXXX0005/RRN: TEST-RRN-0009/TEST BANK" },
        flagged: { rowNumber: 933, transactionDate: "2024-12-09", type: "income", amount: 500000, referenceNumber: "IMPS/MR", payee: "Test User", description: "IMPS/MR TEST USER/XXXX0005/RRN: TEST-RRN-0010/TEST BANK" },
    },
    {
        earlier: { rowNumber: 1076, transactionDate: "2025-04-02", type: "income", amount: 30000, referenceNumber: "IMPS/TESTCP", payee: "Test Sports Academy", description: "IMPS/TEST SPORTS ACA/XXXX0001/RRN:TEST-RRN-0011/TEST BANK LIMITED" },
        flagged: { rowNumber: 1077, transactionDate: "2025-04-02", type: "income", amount: 30000, referenceNumber: "IMPS/TESTCP", payee: "Test Sports Club", description: "IMPS/TEST SPORTS CLUB/XXXX0002/RRN: TEST-RRN-0012/TEST BANK LIMITED" },
    },
];

function regressionStatement(): NormalizedTransactionCandidate[] {
    return REGRESSION_PAIRS.flatMap(pair => [
        candidate(pair.earlier.rowNumber!, pair.earlier),
        candidate(pair.flagged.rowNumber!, pair.flagged),
    ]);
}

beforeEach(() => {
    const db = new DatabaseSync(":memory:");

    db.exec(
        `CREATE TABLE accounts (id TEXT PRIMARY KEY);
         CREATE TABLE currencies (id TEXT PRIMARY KEY);
         INSERT INTO accounts (id) VALUES ('${ACCOUNT}'), ('${OTHER_ACCOUNT}');`
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

describe("Import duplicate detection is scoped to transactions that existed before the batch", () => {
    it("1. two identical-looking legitimate rows in one batch both import", async () => {
        const batch = await runImport([
            candidate(1, { payee: "ATM", description: "" }),
            candidate(2, { payee: "ATM", description: "" }),
        ]);

        expect(batch).toMatchObject({ status: "COMPLETED", totalRows: 2, importedRows: 2, duplicateRows: 0, failedRows: 0 });
        expect(transactionCount()).toBe(2);
    });

    it("2. same date + amount + direction + identical narration: both import", async () => {
        const row = { description: "NEFT/UPI/RENT PAYMENT/HDFC", payee: "Landlord" };

        const batch = await runImport([candidate(1, row), candidate(2, row)]);

        expect(batch).toMatchObject({ importedRows: 2, duplicateRows: 0 });
        expect(rowStatuses(batch.id)).toEqual({ 1: "IMPORTED", 2: "IMPORTED" });
    });

    it("3. same date + amount + direction + same reference: both import", async () => {
        const batch = await runImport([
            candidate(1, { referenceNumber: "IMPS/TESTCP", description: "IMPS/TESTCP A/RRN:1" }),
            candidate(2, { referenceNumber: "IMPS/TESTCP", description: "IMPS/TESTCP B/RRN:2" }),
            // Identical reference AND narration too.
            candidate(3, { referenceNumber: "UTR999", description: "SAME" }),
            candidate(4, { referenceNumber: "UTR999", description: "SAME" }),
        ]);

        expect(batch).toMatchObject({ importedRows: 4, duplicateRows: 0 });
        expect(transactionCount()).toBe(4);
    });

    it("4 + 5. a statement imports fully once; importing it again creates no copies", async () => {
        const statement = [
            candidate(1, { description: "SAME", referenceNumber: "R1" }),
            candidate(2, { description: "SAME", referenceNumber: "R1" }),
            candidate(3, { description: "OTHER", amount: 250 }),
            candidate(4, { description: "INCOME", type: "income", amount: 5000 }),
        ];

        const first = await runImport(statement);

        expect(first).toMatchObject({ status: "COMPLETED", totalRows: 4, importedRows: 4, duplicateRows: 0, failedRows: 0 });
        expect(transactionCount()).toBe(4);

        const second = await runImport(statement);

        expect(second).toMatchObject({ status: "COMPLETED", totalRows: 4, importedRows: 0, duplicateRows: 4, failedRows: 0 });
        expect(rowStatuses(second.id)).toEqual({ 1: "DUPLICATE", 2: "DUPLICATE", 3: "DUPLICATE", 4: "DUPLICATE" });
        expect(transactionCount()).toBe(4);
    });

    it("6. the 8 regression false positives now import; a re-import still finds all 16 as duplicates", async () => {
        const first = await runImport(regressionStatement());

        expect(first).toMatchObject({ totalRows: 16, importedRows: 16, duplicateRows: 0, failedRows: 0 });
        for (const pair of REGRESSION_PAIRS) {
            expect(rowStatuses(first.id)[pair.flagged.rowNumber!]).toBe("IMPORTED");
        }
        expect(transactionCount()).toBe(16);

        const second = await runImport(regressionStatement());

        expect(second).toMatchObject({ totalRows: 16, importedRows: 0, duplicateRows: 16, failedRows: 0 });
        expect(transactionCount()).toBe(16);
    });

    it("7. a genuinely pre-existing transaction is still detected, even alongside an in-batch twin", async () => {
        await runImport([candidate(1, { description: "SALARY", type: "income", amount: 50000 })]);

        const batch = await runImport([
            candidate(1, { description: "SALARY", type: "income", amount: 50000 }),
            candidate(2, { description: "NEW ROW" }),
            candidate(3, { description: "NEW ROW" }),
        ]);

        expect(rowStatuses(batch.id)).toEqual({ 1: "DUPLICATE", 2: "IMPORTED", 3: "IMPORTED" });
        expect(batch).toMatchObject({ importedRows: 2, duplicateRows: 1 });
    });

    it("8. transactions in another account never affect duplicate detection", async () => {
        const statement = [candidate(1, { description: "SAME" }), candidate(2, { description: "SAME" })];

        await runImport(statement, OTHER_ACCOUNT);
        const batch = await runImport(statement);

        expect(batch).toMatchObject({ importedRows: 2, duplicateRows: 0 });
        expect(transactionCount(ACCOUNT)).toBe(2);
        expect(transactionCount(OTHER_ACCOUNT)).toBe(2);
    });

    it("9. a failed row creates nothing and never becomes a duplicate match", async () => {
        const batch = await runImport([
            candidate(1, { description: "SAME", payee: FAIL_PAYEE }),
            candidate(2, { description: "SAME" }),
            candidate(3, { description: "SAME" }),
        ]);

        expect(rowStatuses(batch.id)).toEqual({ 1: "FAILED", 2: "IMPORTED", 3: "IMPORTED" });
        expect(batch).toMatchObject({ status: "COMPLETED_WITH_ERRORS", totalRows: 3, importedRows: 2, duplicateRows: 0, failedRows: 1 });
        expect(transactionCount()).toBe(2);
    });

    it("10. import history counts match the persisted rows", async () => {
        await runImport([candidate(1, { description: "EXISTING" })]);

        const batch = await runImport([
            candidate(1, { description: "EXISTING" }),
            candidate(2, { description: "TWIN" }),
            candidate(3, { description: "TWIN" }),
            candidate(4, { description: "BAD", payee: FAIL_PAYEE }),
        ]);

        const stored = sqlite.db!
            .prepare("SELECT total_rows, imported_rows, duplicate_rows, failed_rows, status FROM import_batches WHERE id = ?")
            .get(batch.id);

        expect({ ...stored }).toEqual({ total_rows: 4, imported_rows: 2, duplicate_rows: 1, failed_rows: 1, status: "COMPLETED_WITH_ERRORS" });
        expect(rowStatuses(batch.id)).toEqual({ 1: "DUPLICATE", 2: "IMPORTED", 3: "IMPORTED", 4: "FAILED" });
    });
});
