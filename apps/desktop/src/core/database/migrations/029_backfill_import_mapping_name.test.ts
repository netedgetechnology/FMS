import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { BackfillImportMappingNameMigration } from "./029_backfill_import_mapping_name";

/** Replicates MigrationEngine's statement splitting. */
function runMigration(db: DatabaseSync): void {
    const statements = BackfillImportMappingNameMigration.sql
        .split(";")
        .map(statement => statement.trim())
        .filter(statement => statement.length > 0)
        .filter(
            statement =>
                !/^PRAGMA\s+foreign_keys\s*=\s*ON\s*$/i.test(statement)
        );

    for (const statement of statements) {
        db.exec(statement);
    }
}

function createDb(): DatabaseSync {
    const db = new DatabaseSync(":memory:");

    db.exec(`
        CREATE TABLE transactions (
            id TEXT PRIMARY KEY,
            payee TEXT NOT NULL,
            source_statement TEXT
        );

        CREATE TABLE import_batches (
            id TEXT PRIMARY KEY,
            import_type TEXT NOT NULL
        );

        CREATE TABLE import_rows (
            id TEXT PRIMARY KEY,
            import_batch_id TEXT NOT NULL,
            transaction_id TEXT,
            status TEXT NOT NULL,
            raw_data TEXT NOT NULL
        );

        CREATE TABLE import_mappings (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            header_signature TEXT NOT NULL
        );
    `);

    return db;
}

function insertTransaction(
    db: DatabaseSync,
    id: string,
    sourceStatement: string | null = null
): void {
    db.prepare(
        `INSERT INTO transactions (id, payee, source_statement) VALUES (?, 'Payee', ?)`
    ).run(id, sourceStatement);
}

function insertBatch(
    db: DatabaseSync,
    id: string,
    importType: string
): void {
    db.prepare(
        `INSERT INTO import_batches (id, import_type) VALUES (?, ?)`
    ).run(id, importType);
}

function insertRow(
    db: DatabaseSync,
    params: {
        id: string;
        batchId: string;
        transactionId: string | null;
        status: string;
        headers: string[];
    }
): void {
    const rawData: Record<string, string> = {};
    params.headers.forEach(header => {
        rawData[header] = "value";
    });

    db.prepare(
        `INSERT INTO import_rows (id, import_batch_id, transaction_id, status, raw_data)
         VALUES (?, ?, ?, ?, ?)`
    ).run(
        params.id,
        params.batchId,
        params.transactionId,
        params.status,
        JSON.stringify(rawData)
    );
}

function insertMapping(
    db: DatabaseSync,
    id: string,
    name: string,
    headerSignature: string
): void {
    db.prepare(
        `INSERT INTO import_mappings (id, name, header_signature) VALUES (?, ?, ?)`
    ).run(id, name, headerSignature);
}

function sourceStatementOf(
    db: DatabaseSync,
    id: string
): string | null {
    const row = db
        .prepare(`SELECT source_statement FROM transactions WHERE id = ?`)
        .get(id) as { source_statement: string | null };

    return row.source_statement;
}

describe("migration 029 - backfill import mapping name", () => {
    it("is registered with version 29", () => {
        expect(BackfillImportMappingNameMigration.version).toBe(29);
    });

    it("stamps an old imported transaction with its mapping's name, recomputing the exact same header signature the app uses", () => {
        const db = createDb();

        insertMapping(
            db,
            "map-1",
            "Axis Bank",
            "BANK_CSV::amount(inr)|balance(inr)|branch name|chqno|dr|cr|tran date|transaction particulars|value date"
        );

        insertBatch(db, "batch-1", "BANK_CSV");
        insertTransaction(db, "txn-1", null);
        insertRow(db, {
            id: "row-1",
            batchId: "batch-1",
            transactionId: "txn-1",
            status: "IMPORTED",
            headers: [
                "Tran Date",
                "Value Date",
                "CHQNO",
                "Transaction Particulars",
                "Amount(INR)",
                "DR|CR",
                "Balance(INR)",
                "Branch Name",
            ],
        });

        runMigration(db);

        expect(sourceStatementOf(db, "txn-1")).toBe("Axis Bank");
    });

    it("never touches a manually created transaction (no import_rows at all)", () => {
        const db = createDb();

        insertMapping(
            db,
            "map-1",
            "Axis Bank",
            "BANK_CSV::narration"
        );
        insertTransaction(db, "manual-1", null);

        runMigration(db);

        expect(sourceStatementOf(db, "manual-1")).toBeNull();
    });

    it("never overwrites a transaction that already has a source_statement", () => {
        const db = createDb();

        insertMapping(
            db,
            "map-1",
            "Axis Bank",
            "BANK_CSV::narration"
        );
        insertBatch(db, "batch-1", "BANK_CSV");
        insertTransaction(db, "txn-1", "Already Set");
        insertRow(db, {
            id: "row-1",
            batchId: "batch-1",
            transactionId: "txn-1",
            status: "IMPORTED",
            headers: ["Narration"],
        });

        runMigration(db);

        expect(sourceStatementOf(db, "txn-1")).toBe("Already Set");
    });

    it("does not guess a name for an old import whose header structure was never saved as a mapping", () => {
        const db = createDb();

        // A saved mapping exists, but for a completely different header
        // structure than this batch's rows.
        insertMapping(
            db,
            "map-1",
            "Axis Bank",
            "BANK_CSV::amount(inr)|branch name|tran date"
        );

        insertBatch(db, "batch-2", "BANK_CSV");
        insertTransaction(db, "txn-unmapped", null);
        insertRow(db, {
            id: "row-2",
            batchId: "batch-2",
            transactionId: "txn-unmapped",
            status: "IMPORTED",
            headers: ["Date", "Description", "Amount"],
        });

        runMigration(db);

        expect(sourceStatementOf(db, "txn-unmapped")).toBeNull();
    });

    it("ignores a DUPLICATE-status row's own signature computation but still backfills via its linked transaction's original IMPORTED row", () => {
        const db = createDb();

        insertMapping(
            db,
            "map-1",
            "Axis Bank",
            "BANK_CSV::narration"
        );

        insertBatch(db, "batch-1", "BANK_CSV");
        insertTransaction(db, "txn-1", null);
        insertRow(db, {
            id: "row-1",
            batchId: "batch-1",
            transactionId: "txn-1",
            status: "IMPORTED",
            headers: ["Narration"],
        });

        // A later re-import of the same statement hit this same
        // transaction as a duplicate - same transaction_id, DUPLICATE
        // status, and (in this test) a different header list to prove the
        // migration relies on the IMPORTED row, not this one.
        insertBatch(db, "batch-2", "BANK_CSV");
        insertRow(db, {
            id: "row-2",
            batchId: "batch-2",
            transactionId: "txn-1",
            status: "DUPLICATE",
            headers: ["Something Else Entirely"],
        });

        runMigration(db);

        expect(sourceStatementOf(db, "txn-1")).toBe("Axis Bank");
    });

    it("is idempotent - a second run makes no further changes", () => {
        const db = createDb();

        insertMapping(
            db,
            "map-1",
            "Axis Bank",
            "BANK_CSV::narration"
        );
        insertBatch(db, "batch-1", "BANK_CSV");
        insertTransaction(db, "txn-1", null);
        insertRow(db, {
            id: "row-1",
            batchId: "batch-1",
            transactionId: "txn-1",
            status: "IMPORTED",
            headers: ["Narration"],
        });

        runMigration(db);
        expect(sourceStatementOf(db, "txn-1")).toBe("Axis Bank");

        runMigration(db);
        expect(sourceStatementOf(db, "txn-1")).toBe("Axis Bank");
    });

    it("backfills multiple transactions from the same mapping in one pass", () => {
        const db = createDb();

        insertMapping(
            db,
            "map-1",
            "Axis Bank",
            "BANK_CSV::narration"
        );
        insertBatch(db, "batch-1", "BANK_CSV");

        for (const n of [1, 2, 3]) {
            insertTransaction(db, `txn-${n}`, null);
            insertRow(db, {
                id: `row-${n}`,
                batchId: "batch-1",
                transactionId: `txn-${n}`,
                status: "IMPORTED",
                headers: ["Narration"],
            });
        }

        runMigration(db);

        for (const n of [1, 2, 3]) {
            expect(sourceStatementOf(db, `txn-${n}`)).toBe(
                "Axis Bank"
            );
        }
    });
});
