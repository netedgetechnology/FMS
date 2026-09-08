import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { TransactionCounterpartyBranchMigration } from "./025_transaction_counterparty_branch";

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
            original_narration TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            deleted_at TEXT
        );
    `);

    for (const statement of TransactionCounterpartyBranchMigration.sql
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
        payee: string;
        counterparty: string | null;
        branch: string | null;
        referenceNumber: string | null;
        notes?: string | null;
        originalNarration?: string | null;
        transactionDate?: string;
        amount?: number;
    }
): void {
    db.prepare(
        `
        INSERT INTO transactions
        (id, account_id, payee, type, amount, transaction_date, reference_number, counterparty, branch, notes, original_narration)
        VALUES (?, 'acct-1', ?, 'expense', ?, ?, ?, ?, ?, ?, ?)
        `
    ).run(
        row.id,
        row.payee,
        row.amount ?? 100,
        row.transactionDate ?? "2026-08-01",
        row.referenceNumber,
        row.counterparty,
        row.branch,
        row.notes ?? null,
        row.originalNarration ?? null
    );
}

function getTransaction(
    db: DatabaseSync,
    id: string
): Record<string, unknown> {
    return db
        .prepare(`SELECT * FROM transactions WHERE id = ?`)
        .get(id) as Record<string, unknown>;
}

describe("migration 025 - transaction counterparty and branch", () => {
    it("is registered with version 25", () => {
        expect(
            TransactionCounterpartyBranchMigration.version
        ).toBe(25);
    });

    it("adds nullable counterparty and branch columns", () => {
        const db = createDb();

        insertTransaction(db, {
            id: "txn-1",
            payee: "Amazon",
            counterparty: null,
            branch: null,
            referenceNumber: null,
        });

        const row = getTransaction(db, "txn-1");
        expect(row.counterparty).toBeNull();
        expect(row.branch).toBeNull();
    });

    it("persists counterparty, branch, and reference all independently of payee", () => {
        const db = createDb();

        insertTransaction(db, {
            id: "txn-2",
            payee: "ACH-DR-KOTAKMAHPRIMELTKKBK",
            counterparty: "Kotak Mahindra Prime Ltd",
            branch: "BOPAL, AHMEDABAD [GJ]",
            referenceNumber: "CHQ-000123",
        });

        const row = getTransaction(db, "txn-2");
        expect(row.payee).toBe(
            "ACH-DR-KOTAKMAHPRIMELTKKBK"
        );
        expect(row.counterparty).toBe(
            "Kotak Mahindra Prime Ltd"
        );
        expect(row.branch).toBe(
            "BOPAL, AHMEDABAD [GJ]"
        );
        expect(row.reference_number).toBe(
            "CHQ-000123"
        );

        // None of these were merged into one another.
        expect(row.counterparty).not.toBe(
            row.payee
        );
        expect(row.counterparty).not.toBe(
            row.branch
        );
        expect(row.counterparty).not.toBe(
            row.reference_number
        );
    });

    it("persists notes independently of the original narration (description)", () => {
        const db = createDb();

        insertTransaction(db, {
            id: "txn-3",
            payee: "UPI/P2A/1/John Doe",
            counterparty: "John Doe",
            branch: null,
            referenceNumber: null,
            originalNarration:
                "UPI/P2A/1/John Doe/Sent u/HDFC BANK",
            notes: "Reimbursed by employer",
        });

        const row = getTransaction(db, "txn-3");
        expect(row.original_narration).toBe(
            "UPI/P2A/1/John Doe/Sent u/HDFC BANK"
        );
        expect(row.notes).toBe(
            "Reimbursed by employer"
        );
        expect(row.notes).not.toBe(
            row.original_narration
        );
    });

    it("finds a duplicate by matching original_narration (not notes), preserving prior import-duplicate-detection behavior", () => {
        const db = createDb();

        insertTransaction(db, {
            id: "txn-existing",
            payee: "",
            counterparty: null,
            branch: null,
            referenceNumber: null,
            originalNarration:
                "UPI/P2A/1/John Doe/Sent u/HDFC BANK",
            // A free-form note unrelated to the narration - must NOT be
            // what duplicate-matching keys off of.
            notes: "Personal note, nothing to do with matching",
            transactionDate: "2026-08-05",
            amount: 250,
        });

        const candidateDescription =
            "UPI/P2A/1/John Doe/Sent u/HDFC BANK";

        // Mirrors TransactionRepository.findDuplicate's fallback clause.
        const match = db
            .prepare(
                `
                SELECT id FROM transactions
                WHERE account_id = 'acct-1'
                  AND transaction_date = '2026-08-05'
                  AND type = 'expense'
                  AND amount = 250
                  AND deleted_at IS NULL
                  AND (
                      ? <> ''
                      AND LOWER(TRIM(original_narration)) = LOWER(TRIM(?))
                  )
                LIMIT 1
                `
            )
            .get(
                candidateDescription,
                candidateDescription
            ) as { id: string } | undefined;

        expect(match?.id).toBe("txn-existing");
    });
});
