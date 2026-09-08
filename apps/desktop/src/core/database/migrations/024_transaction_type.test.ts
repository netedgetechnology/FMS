import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { TransactionChannelTypeMigration } from "./024_transaction_type";

function createDb(): DatabaseSync {
    const db = new DatabaseSync(":memory:");

    db.exec(`
        CREATE TABLE transactions (
            id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL,
            category_id TEXT,
            payee TEXT NOT NULL,
            type TEXT NOT NULL,
            amount REAL NOT NULL,
            transaction_date TEXT NOT NULL,
            reference_number TEXT,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            deleted_at TEXT
        );
    `);

    for (const statement of TransactionChannelTypeMigration.sql
        .split(";")
        .map(part => part.trim())
        .filter(part => part.length > 0)) {
        db.exec(statement);
    }

    return db;
}

function insertTransaction(
    db: DatabaseSync,
    row: {
        id: string;
        type: string;
        transactionType: string | null;
    }
): void {
    db.prepare(
        `
        INSERT INTO transactions
        (id, account_id, payee, type, amount, transaction_date, transaction_type)
        VALUES (?, 'acct-1', 'Test Payee', ?, 100, '2026-08-01', ?)
        `
    ).run(row.id, row.type, row.transactionType);
}

function getTransaction(
    db: DatabaseSync,
    id: string
): Record<string, unknown> {
    return db
        .prepare(`SELECT * FROM transactions WHERE id = ?`)
        .get(id) as Record<string, unknown>;
}

describe("migration 024 - transaction type (channel)", () => {
    it("is registered with version 24", () => {
        expect(
            TransactionChannelTypeMigration.version
        ).toBe(24);
    });

    it("adds a nullable transaction_type column, defaulting existing/omitted rows to NULL", () => {
        const db = createDb();

        insertTransaction(db, {
            id: "txn-1",
            type: "expense",
            transactionType: null,
        });

        expect(
            getTransaction(db, "txn-1")
                .transaction_type
        ).toBeNull();
    });

    it("persists the transaction channel with the canonical transaction", () => {
        const db = createDb();

        insertTransaction(db, {
            id: "txn-upi",
            type: "expense",
            transactionType: "UPI",
        });

        insertTransaction(db, {
            id: "txn-neft",
            type: "income",
            transactionType: "NEFT",
        });

        expect(
            getTransaction(db, "txn-upi")
                .transaction_type
        ).toBe("UPI");

        expect(
            getTransaction(db, "txn-neft")
                .transaction_type
        ).toBe("NEFT");
    });

    it("keeps transaction_type (channel) independent of the type (direction) column", () => {
        const db = createDb();

        // A debit that went out over UPI, and a credit that came in by
        // cheque - direction and channel vary independently.
        insertTransaction(db, {
            id: "txn-dr-upi",
            type: "expense",
            transactionType: "UPI",
        });

        insertTransaction(db, {
            id: "txn-cr-cheque",
            type: "income",
            transactionType: "CHEQUE",
        });

        const drUpi = getTransaction(
            db,
            "txn-dr-upi"
        );
        expect(drUpi.type).toBe("expense");
        expect(drUpi.transaction_type).toBe(
            "UPI"
        );

        const crCheque = getTransaction(
            db,
            "txn-cr-cheque"
        );
        expect(crCheque.type).toBe("income");
        expect(
            crCheque.transaction_type
        ).toBe("CHEQUE");
    });
});
