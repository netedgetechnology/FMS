import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { CounterpartyRulesMigration } from "@/core/database/migrations/026_counterparty_rules";
import { CounterpartyRulesAccountScopeMigration } from "@/core/database/migrations/027_counterparty_rules_account_scope";
import { CounterpartyRulesTypeNotesMigration } from "@/core/database/migrations/028_counterparty_rules_type_notes";

import { isPlaceholderReference } from "./TransactionRepository";

// TransactionRepository extends the app's Repository base class, which
// talks to a live Tauri SQLite connection - unavailable in this test
// environment (see ReconciliationService.test.ts / InvestmentService.test.ts,
// which mock repositories rather than exercise real SQL, and the
// migration test suite, which runs raw SQL against node:sqlite instead).
// Following that same established pattern, this file runs
// TransactionRepository.findDuplicate's and .delete's exact SQL (kept
// in sync with that file - update both together) against a minimal
// in-memory `transactions` table containing only the columns those two
// methods touch.

const TRANSACTIONS_TABLE_SQL = `
CREATE TABLE transactions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    payee TEXT NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    transaction_date TEXT NOT NULL,
    reference_number TEXT,
    original_narration TEXT,
    notes TEXT,
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

// Mirrors TransactionRepository.findDuplicate exactly - a
// priority/fallback chain (reference, then narration, then Payee only
// when narration is absent), never three independent equal-weight
// signals. Update both together.
const FIND_DUPLICATE_SQL = `
    SELECT id
    FROM transactions
    WHERE account_id = ?
      AND transaction_date = ?
      AND type = ?
      AND amount = ?
      AND deleted_at IS NULL
      AND (
          (
              ? = 1
              AND reference_number IS NOT NULL
              AND TRIM(reference_number) <> ''
              AND UPPER(TRIM(reference_number))
                  NOT IN ('NA', 'N/A')
              AND TRIM(TRIM(reference_number), '-') <> ''
              AND LOWER(TRIM(reference_number)) =
                  LOWER(TRIM(?))
          )
          OR
          (
              ? = 1
              AND LOWER(TRIM(original_narration)) =
                  LOWER(TRIM(?))
          )
          OR
          (
              ? = 0
              AND ? <> ''
              AND LOWER(TRIM(payee)) =
                  LOWER(TRIM(?))
          )
      )
    LIMIT 1
`;

// Mirrors TransactionRepository.delete exactly.
const DELETE_SQL = `
    UPDATE transactions
    SET deleted_at = CURRENT_TIMESTAMP
    WHERE id = ?
`;

interface TransactionRow {
    id: string;
    accountId: string;
    payee: string;
    type: string;
    amount: number;
    transactionDate: string;
    referenceNumber: string | null;
    originalNarration: string;
    notes?: string | null;
}

function createDb(): DatabaseSync {
    const db = new DatabaseSync(":memory:");
    db.exec(TRANSACTIONS_TABLE_SQL);
    return db;
}

function insertTransaction(
    db: DatabaseSync,
    row: TransactionRow
): void {
    db.prepare(
        `
        INSERT INTO transactions
        (id, account_id, payee, type, amount, transaction_date, reference_number, original_narration, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
    ).run(
        row.id,
        row.accountId,
        row.payee,
        row.type,
        row.amount,
        row.transactionDate,
        row.referenceNumber,
        row.originalNarration,
        row.notes ?? null
    );
}

function findDuplicate(
    db: DatabaseSync,
    accountId: string,
    transactionDate: string,
    type: string,
    amount: number,
    referenceNumber: string | null,
    payee: string,
    description: string
): { id: string } | null {
    const hasReference = !isPlaceholderReference(referenceNumber);
    const hasNarration = description.trim().length > 0;

    const row = db
        .prepare(FIND_DUPLICATE_SQL)
        .get(
            accountId,
            transactionDate,
            type,
            amount,
            hasReference ? 1 : 0,
            referenceNumber,
            hasNarration ? 1 : 0,
            description,
            hasNarration ? 1 : 0,
            payee,
            payee
        ) as { id: string } | undefined;

    return row ?? null;
}

function softDelete(db: DatabaseSync, id: string): void {
    db.prepare(DELETE_SQL).run(id);
}

describe("isPlaceholderReference", () => {
    it.each([
        null,
        undefined,
        "",
        "   ",
        "-",
        "--",
        "----",
        "na",
        "NA",
        "n/a",
        "N/A",
        " -- ",
    ])("treats %j as a placeholder", value => {
        expect(isPlaceholderReference(value)).toBe(true);
    });

    it.each([
        "UTR12345",
        "REF-001",
        "0000123456",
        "N/A-1",
        "-1",
    ])("treats %j as a real reference", value => {
        expect(isPlaceholderReference(value)).toBe(false);
    });
});

describe("TransactionRepository.findDuplicate", () => {
    it("3. detects an active exact duplicate (same date/type/amount/payee)", () => {
        const db = createDb();

        insertTransaction(db, {
            id: "txn-1",
            accountId: "account-1",
            payee: "Limestone Networks",
            type: "expense",
            amount: 500,
            transactionDate: "2026-08-01",
            referenceNumber: "UTR001",
            originalNarration: "Limestone Networks",
        });

        const duplicate = findDuplicate(
            db,
            "account-1",
            "2026-08-01",
            "expense",
            500,
            "UTR001",
            "Limestone Networks",
            "Limestone Networks"
        );

        expect(duplicate?.id).toBe("txn-1");
    });

    it("4. a soft-deleted transaction is NOT treated as a duplicate", () => {
        const db = createDb();

        insertTransaction(db, {
            id: "txn-1",
            accountId: "account-1",
            payee: "Limestone Networks",
            type: "expense",
            amount: 500,
            transactionDate: "2026-08-01",
            referenceNumber: "UTR001",
            originalNarration: "Limestone Networks",
        });

        softDelete(db, "txn-1");

        const duplicate = findDuplicate(
            db,
            "account-1",
            "2026-08-01",
            "expense",
            500,
            "UTR001",
            "Limestone Networks",
            "Limestone Networks"
        );

        expect(duplicate).toBeNull();
    });

    it("5. multiple soft-deleted rows sharing the same placeholder reference never block a re-import", () => {
        const db = createDb();

        for (let i = 1; i <= 5; i++) {
            insertTransaction(db, {
                id: `txn-${i}`,
                accountId: "account-1",
                payee: `Payee ${i}`,
                type: "expense",
                amount: 100 + i,
                transactionDate: `2026-08-0${i}`,
                referenceNumber: "-",
                originalNarration: `Narration ${i}`,
            });
            softDelete(db, `txn-${i}`);
        }

        const duplicate = findDuplicate(
            db,
            "account-1",
            "2026-08-01",
            "expense",
            101,
            "-",
            "Payee 1",
            "Narration 1"
        );

        expect(duplicate).toBeNull();
    });

    it("6. a shared placeholder reference never collapses genuinely unrelated transactions", () => {
        const db = createDb();

        insertTransaction(db, {
            id: "txn-1",
            accountId: "account-1",
            payee: "Coffee Shop",
            type: "expense",
            amount: 150,
            transactionDate: "2026-08-01",
            referenceNumber: "-",
            originalNarration: "POS PURCHASE COFFEE SHOP",
        });

        // A different transaction on a different day, for a different
        // amount, to a different payee - the only thing it shares with
        // txn-1 is the bank's placeholder "-" reference.
        const duplicate = findDuplicate(
            db,
            "account-1",
            "2026-08-05",
            "expense",
            9999,
            "-",
            "Electricity Board",
            "BILL PAYMENT ELECTRICITY BOARD"
        );

        expect(duplicate).toBeNull();
    });

    it("does not collapse 106 rows sharing a placeholder reference into one duplicate chain (regression for the reported import bug)", () => {
        const db = createDb();

        let firstId: string | null = null;
        let stillNew = 0;

        for (let i = 1; i <= 106; i++) {
            const candidate = {
                accountId: "account-1",
                payee: `Payee ${i}`,
                type: "expense",
                amount: 100 + i,
                transactionDate: `2026-08-${String((i % 28) + 1).padStart(2, "0")}`,
                referenceNumber: "-",
                description: `Narration ${i}`,
            };

            const duplicate = findDuplicate(
                db,
                candidate.accountId,
                candidate.transactionDate,
                candidate.type,
                candidate.amount,
                candidate.referenceNumber,
                candidate.payee,
                candidate.description
            );

            if (!duplicate) {
                stillNew += 1;
                const id = `txn-${i}`;
                if (!firstId) firstId = id;
                insertTransaction(db, {
                    id,
                    accountId: candidate.accountId,
                    payee: candidate.payee,
                    type: candidate.type,
                    amount: candidate.amount,
                    transactionDate: candidate.transactionDate,
                    referenceNumber: candidate.referenceNumber,
                    originalNarration: candidate.description,
                });
            }
        }

        // Every genuinely distinct row (different payee/amount/date) is
        // imported - none of them incorrectly collapse into a single
        // "duplicate" chain just because they share a placeholder
        // reference.
        expect(stillNew).toBe(106);
    });

    it("7. the same real reference on a clearly different transaction is not treated as a duplicate", () => {
        const db = createDb();

        insertTransaction(db, {
            id: "txn-1",
            accountId: "account-1",
            payee: "Merchant A",
            type: "expense",
            amount: 500,
            transactionDate: "2026-08-01",
            referenceNumber: "UTR12345",
            originalNarration: "Merchant A purchase",
        });

        // A different date, different amount, different payee - the
        // bank happens to have reused the reference number, but this is
        // unmistakably a different transaction.
        const duplicate = findDuplicate(
            db,
            "account-1",
            "2026-09-15",
            "income",
            750,
            "UTR12345",
            "Merchant B",
            "Merchant B refund"
        );

        expect(duplicate).toBeNull();
    });

    it("same account/date/type/amount + same Payee + DIFFERENT narration + different real reference => NOT a duplicate (the newly-fixed gap: Payee alone never confirms identity when narration exists to check instead)", () => {
        const db = createDb();

        insertTransaction(db, {
            id: "txn-1",
            accountId: "account-1",
            payee: "Rahul Sharma",
            type: "expense",
            amount: 1000,
            transactionDate: "2026-08-05",
            referenceNumber: "UPI999111",
            originalNarration:
                "UPI/P2A/999111/Rahul Sharma/Sent u/HDFC",
        });

        // A second, genuinely different ₹1,000 transfer to the same
        // person on the same day - same Payee label, but a distinct
        // narration and a distinct real reference number.
        const duplicate = findDuplicate(
            db,
            "account-1",
            "2026-08-05",
            "expense",
            1000,
            "UPI999222",
            "Rahul Sharma",
            "UPI/P2A/999222/Rahul Sharma/Sent u/HDFC"
        );

        expect(duplicate).toBeNull();
    });

    it("same account/date/type/amount + same narration => duplicate, regardless of Payee", () => {
        const db = createDb();

        insertTransaction(db, {
            id: "txn-1",
            accountId: "account-1",
            payee: "SBI Card",
            type: "expense",
            amount: 500,
            transactionDate: "2026-08-01",
            referenceNumber: "-",
            originalNarration:
                "NBSM/146721617/SBI CARD (BILLDESK)/",
        });

        const duplicate = findDuplicate(
            db,
            "account-1",
            "2026-08-01",
            "expense",
            500,
            "-",
            "A Completely Different Payee Label",
            "NBSM/146721617/SBI CARD (BILLDESK)/"
        );

        expect(duplicate?.id).toBe("txn-1");
    });

    it("same account/date/type/amount + no narration + same Payee => duplicate", () => {
        const db = createDb();

        insertTransaction(db, {
            id: "txn-1",
            accountId: "account-1",
            payee: "Cash Withdrawal",
            type: "expense",
            amount: 2000,
            transactionDate: "2026-08-01",
            referenceNumber: "-",
            originalNarration: "",
        });

        const duplicate = findDuplicate(
            db,
            "account-1",
            "2026-08-01",
            "expense",
            2000,
            "-",
            "Cash Withdrawal",
            ""
        );

        expect(duplicate?.id).toBe("txn-1");
    });

    it("same account/date/type/amount + no narration + different Payee => NOT a duplicate", () => {
        const db = createDb();

        insertTransaction(db, {
            id: "txn-1",
            accountId: "account-1",
            payee: "Cash Withdrawal",
            type: "expense",
            amount: 2000,
            transactionDate: "2026-08-01",
            referenceNumber: "-",
            originalNarration: "",
        });

        const duplicate = findDuplicate(
            db,
            "account-1",
            "2026-08-01",
            "expense",
            2000,
            "-",
            "Someone Else",
            ""
        );

        expect(duplicate).toBeNull();
    });

    it("a real matching reference still confirms an exact duplicate alongside matching date/type/amount", () => {
        const db = createDb();

        insertTransaction(db, {
            id: "txn-1",
            accountId: "account-1",
            payee: "",
            type: "expense",
            amount: 500,
            transactionDate: "2026-08-01",
            referenceNumber: "UTR12345",
            originalNarration: "",
        });

        // Payee/description text differs slightly between imports, but
        // the real reference number + date/type/amount together still
        // confirm identity.
        const duplicate = findDuplicate(
            db,
            "account-1",
            "2026-08-01",
            "expense",
            500,
            "UTR12345",
            "Merchant A (renamed)",
            "Merchant A (renamed) purchase"
        );

        expect(duplicate?.id).toBe("txn-1");
    });
});

describe("8. learned rules survive transaction deletion", () => {
    function createDbWithBothTables(): DatabaseSync {
        const db = createDb();

        db.exec(`
            CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL);
        `);

        for (const migration of [
            CounterpartyRulesMigration,
            CounterpartyRulesAccountScopeMigration,
            CounterpartyRulesTypeNotesMigration,
        ]) {
            for (const statement of migration.sql
                .split(";")
                .map(part => part.trim())
                .filter(part => part.length > 0)) {
                db.exec(statement);
            }
        }

        return db;
    }

    it("deleting a transaction does not touch counterparty_rules", () => {
        const db = createDbWithBothTables();

        db.prepare(
            `INSERT INTO accounts (id, name) VALUES ('account-1', 'Account 1')`
        ).run();

        insertTransaction(db, {
            id: "txn-1",
            accountId: "account-1",
            payee: "SBI Card",
            type: "expense",
            amount: 500,
            transactionDate: "2026-08-01",
            referenceNumber: "-",
            originalNarration:
                "NBSM/146721617/SBI CARD (BILLDESK)/",
        });

        db.prepare(
            `
            INSERT INTO counterparty_rules
            (id, account_id, pattern, counterparty, type, notes, match_count, created_at, updated_at)
            VALUES ('rule-1', 'account-1', 'NBSM/#/SBI CARD (BILLDESK)/', 'SBI Card', 'NEFT', 'Credit card bill', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `
        ).run();

        softDelete(db, "txn-1");

        const rule = db
            .prepare(
                `SELECT * FROM counterparty_rules WHERE id = 'rule-1'`
            )
            .get() as Record<string, unknown>;

        expect(rule).toBeDefined();
        expect(rule.counterparty).toBe("SBI Card");
        expect(rule.type).toBe("NEFT");
        expect(rule.notes).toBe("Credit card bill");

        const txn = db
            .prepare(`SELECT deleted_at FROM transactions WHERE id = 'txn-1'`)
            .get() as { deleted_at: string | null };

        expect(txn.deleted_at).not.toBeNull();
    });
});

// 6. Backfill check for the Transactions page's "Bank Account" filter.
// account_id has been NOT NULL on this table since its foundational
// migration (003_transactions) - every transaction, imported or manual,
// has always required a valid account reference. This proves that at
// the schema level directly (insert-without-accountId is rejected), so
// no transaction can ever exist without one, and no backfill
// migration/script is needed - now or for any future row.
describe("6. no backfill needed for account_id - the schema has always required it", () => {
    it("rejects inserting a transaction with a null account_id", () => {
        const db = createDb();

        expect(() =>
            insertTransaction(db, {
                id: "txn-1",
                accountId: null as unknown as string,
                payee: "Test Payee",
                type: "expense",
                amount: 100,
                transactionDate: "2026-08-01",
                referenceNumber: null,
                originalNarration: "",
            })
        ).toThrow();
    });

    it("every successfully inserted transaction always has a usable account_id", () => {
        const db = createDb();

        insertTransaction(db, {
            id: "txn-1",
            accountId: "account-1",
            payee: "Test Payee",
            type: "expense",
            amount: 100,
            transactionDate: "2026-08-01",
            referenceNumber: null,
            originalNarration: "",
        });

        const row = db
            .prepare(
                `SELECT account_id FROM transactions WHERE id = 'txn-1'`
            )
            .get() as { account_id: string | null };

        expect(row.account_id).toBe("account-1");

        const missing = db
            .prepare(
                `SELECT COUNT(*) AS count FROM transactions WHERE account_id IS NULL OR account_id = ''`
            )
            .get() as { count: number };

        expect(missing.count).toBe(0);
    });
});

// TransactionRepository.renameSourceStatement - bulk-updates every
// active transaction's Mapping Name (source_statement) when a Saved
// Mapping is renamed (see ImportService.renameMapping). Self-contained
// table (adds source_statement, which the shared fixture above doesn't
// need) - mirrors renameSourceStatement's exact SQL. Update both
// together.
describe("TransactionRepository.renameSourceStatement", () => {
    const SOURCE_STATEMENT_TABLE_SQL = `
CREATE TABLE transactions (
    id TEXT PRIMARY KEY,
    source_statement TEXT,
    deleted_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

    const RENAME_SOURCE_STATEMENT_SQL = `
        UPDATE transactions
        SET source_statement = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE source_statement = ?
          AND deleted_at IS NULL
    `;

    function createSourceStatementDb(): DatabaseSync {
        const db = new DatabaseSync(":memory:");
        db.exec(SOURCE_STATEMENT_TABLE_SQL);
        return db;
    }

    function insertRow(
        db: DatabaseSync,
        id: string,
        sourceStatement: string | null,
        deletedAt: string | null = null
    ): void {
        db.prepare(
            `INSERT INTO transactions (id, source_statement, deleted_at) VALUES (?, ?, ?)`
        ).run(id, sourceStatement, deletedAt);
    }

    function renameSourceStatement(
        db: DatabaseSync,
        oldName: string,
        newName: string
    ): void {
        db.prepare(RENAME_SOURCE_STATEMENT_SQL).run(
            newName,
            oldName
        );
    }

    function sourceStatementOf(
        db: DatabaseSync,
        id: string
    ): string | null {
        const row = db
            .prepare(
                `SELECT source_statement FROM transactions WHERE id = ?`
            )
            .get(id) as { source_statement: string | null };

        return row.source_statement;
    }

    it("renames every active transaction stamped with the mapping's exact prior name", () => {
        const db = createSourceStatementDb();

        insertRow(db, "txn-1", "Axisbank");
        insertRow(db, "txn-2", "Axisbank");

        renameSourceStatement(
            db,
            "Axisbank",
            "Axis Bank - Savings"
        );

        expect(sourceStatementOf(db, "txn-1")).toBe(
            "Axis Bank - Savings"
        );
        expect(sourceStatementOf(db, "txn-2")).toBe(
            "Axis Bank - Savings"
        );
    });

    it("leaves transactions from a different Mapping Name untouched", () => {
        const db = createSourceStatementDb();

        insertRow(db, "txn-1", "Axisbank");
        insertRow(db, "txn-2", "HDFC Bank");

        renameSourceStatement(
            db,
            "Axisbank",
            "Axis Bank - Savings"
        );

        expect(sourceStatementOf(db, "txn-2")).toBe(
            "HDFC Bank"
        );
    });

    it("never renames a soft-deleted transaction", () => {
        const db = createSourceStatementDb();

        insertRow(
            db,
            "txn-1",
            "Axisbank",
            "2026-08-01T00:00:00.000Z"
        );

        renameSourceStatement(
            db,
            "Axisbank",
            "Axis Bank - Savings"
        );

        expect(sourceStatementOf(db, "txn-1")).toBe(
            "Axisbank"
        );
    });

    it("leaves a manually-added transaction (null sourceStatement) untouched", () => {
        const db = createSourceStatementDb();

        insertRow(db, "txn-1", null);

        renameSourceStatement(
            db,
            "Axisbank",
            "Axis Bank - Savings"
        );

        expect(
            sourceStatementOf(db, "txn-1")
        ).toBeNull();
    });
});
