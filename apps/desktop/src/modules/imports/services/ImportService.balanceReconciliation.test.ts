import { describe, expect, it } from "vitest";

import type { NormalizedTransactionCandidate } from "@financeos/import-engine";

import type { ImportBatch, ImportRow } from "../types";

import {
    BalanceMismatchImportError,
    ImportService,
} from "./ImportService";

// Service-level enforcement of the PDF running-balance check: even if the
// Import Preview's gate were bypassed, importCandidates refuses a
// statement with an unresolved balance mismatch and writes nothing.

function row(
    rowNumber: number,
    type: NormalizedTransactionCandidate["type"],
    amount: number,
    balance: number | null
): NormalizedTransactionCandidate {
    return {
        rowNumber,
        transactionDate: `2026-01-0${rowNumber}`,
        payee: `Payee ${rowNumber}`,
        description: `Payee ${rowNumber}`,
        amount,
        type,
        referenceNumber: null,
        externalTransactionId: null,
        transactionType: null,
        balance,
        branch: null,
        counterparty: null,
        notes: null,
        rawData: {},
    };
}

function makeService() {
    let batchRow: ImportBatch = {
        id: "batch-1",
        accountId: "account-1",
        importType: "BANK_PDF",
        sourceFileName: "statement.pdf",
        status: "PENDING",
        totalRows: 0,
        importedRows: 0,
        duplicateRows: 0,
        failedRows: 0,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
    };

    const importRows = new Map<string, ImportRow>();
    const created: Array<Record<string, unknown>> = [];
    let batchesCreated = 0;

    const service = new ImportService();

    Object.defineProperty(service, "batchRepository", {
        value: {
            async getById() {
                return batchRow;
            },
            async create(request: Partial<ImportBatch>) {
                batchesCreated += 1;
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
            async create(importRow: ImportRow) {
                importRows.set(importRow.id, importRow);
                return importRow;
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
            async create(request: Record<string, unknown>) {
                created.push(request);
                return `txn-${created.length}`;
            },
        },
    });

    Object.defineProperty(service, "counterpartyRuleRepository", {
        value: {
            async findByAccountAndPattern() {
                return null;
            },
            async upsert() {
                return null;
            },
        },
    });

    return {
        service,
        created,
        batchesCreated: () => batchesCreated,
    };
}

const statement = [
    row(1, "income", 100, 100),
    row(2, "income", 40, 60), // direction mismatch
    row(3, "expense", 10, 50),
];

describe("importCandidates - PDF running-balance enforcement", () => {
    it("refuses an unresolved mismatch and writes nothing", async () => {
        const { service, created, batchesCreated } = makeService();

        const attempt = service.importCandidates(
            "account-1",
            "statement.pdf",
            "BANK_PDF",
            statement,
            null,
            undefined,
            undefined,
            { requireBalanceReconciliation: true }
        );

        await expect(attempt).rejects.toBeInstanceOf(
            BalanceMismatchImportError
        );
        await expect(attempt).rejects.toThrow(
            "1 row does not match the statement's running balance (row 2)."
        );
        expect(created).toEqual([]);
        expect(batchesCreated()).toBe(0);
    });

    it("imports a corrected statement unchanged", async () => {
        const { service, created } = makeService();

        const corrected = statement.map(candidate =>
            candidate.rowNumber === 2
                ? { ...candidate, type: "expense" as const }
                : candidate
        );

        const batch = await service.importCandidates(
            "account-1",
            "statement.pdf",
            "BANK_PDF",
            corrected,
            null,
            undefined,
            undefined,
            { requireBalanceReconciliation: true }
        );

        expect(batch.importedRows).toBe(3);
        expect(
            created.map(request => [request.type, request.amount])
        ).toEqual([
            ["income", 100],
            ["expense", 40],
            ["expense", 10],
        ]);
    });

    it("leaves a skipped row out and still checks its neighbour against the printed balance", async () => {
        const { service, created } = makeService();

        const batch = await service.importCandidates(
            "account-1",
            "statement.pdf",
            "BANK_PDF",
            statement,
            null,
            undefined,
            undefined,
            {
                requireBalanceReconciliation: true,
                skippedRowNumbers: new Set([2]),
            }
        );

        expect(batch.importedRows).toBe(2);
        expect(created.map(request => request.payee)).toEqual([
            "Payee 1",
            "Payee 3",
        ]);
    });

    it("CSV/Excel imports (no reconciliation requested) behave exactly as before", async () => {
        const { service, created } = makeService();

        const batch = await service.importCandidates(
            "account-1",
            "statement.csv",
            "BANK_CSV",
            statement
        );

        expect(batch.importedRows).toBe(3);
        expect(created).toHaveLength(3);
    });
});
