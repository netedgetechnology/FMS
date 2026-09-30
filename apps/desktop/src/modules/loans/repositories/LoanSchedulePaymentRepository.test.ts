import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

// LoanSchedulePaymentRepository talks to a live Tauri SQLite
// connection, unavailable here. Following the established
// TransactionRepository.test.ts pattern, the exact query text is
// exercised directly against a real (in-memory) SQLite engine, so this
// verifies the actual ORDER BY clause's behaviour - not a mock that
// would just hand back whatever order it was given.
//
// LoanPaymentService.reversePayment() relies on getAllByScheduleId's
// first row being the genuinely earliest surviving payment, to decide
// which one the recomputed schedule's paidDate/transactionId should
// reference. `created_at` alone is not sufficient: SQLite's
// CURRENT_TIMESTAMP has only whole-second resolution, so two payments
// recorded within the same second would tie - ORDER BY created_at
// gives no guaranteed, reproducible order for ties across SQL engines
// or query plans. Adding `id` as a secondary key makes the order
// deterministic (not necessarily chronologically meaningful under a
// tie, but stable and reproducible every time).

function createDb(): DatabaseSync {
    const db = new DatabaseSync(":memory:");

    db.exec(`
        CREATE TABLE loan_schedule_payments (
            id TEXT PRIMARY KEY,
            loan_id TEXT NOT NULL,
            schedule_id TEXT NOT NULL,
            transaction_id TEXT NOT NULL,
            payment_date TEXT NOT NULL,
            amount REAL NOT NULL,
            principal_amount REAL NOT NULL,
            interest_amount REAL NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    return db;
}

function insertPayment(
    db: DatabaseSync,
    row: {
        id: string;
        transactionId: string;
        createdAt: string;
    }
): void {
    db.prepare(
        `
        INSERT INTO loan_schedule_payments
        (id, loan_id, schedule_id, transaction_id, payment_date, amount, principal_amount, interest_amount, created_at)
        VALUES (?, 'loan-1', 'sch-1', ?, '2026-02-01', 100, 0, 100, ?)
        `
    ).run(row.id, row.transactionId, row.createdAt);
}

// Mirrors LoanSchedulePaymentRepository.getAllByScheduleId's exact
// query text.
function getAllByScheduleId(
    db: DatabaseSync,
    scheduleId: string
): Array<{ id: string; createdAt: string }> {
    return db
        .prepare(
            `
            SELECT
                id,
                loan_id AS loanId,
                schedule_id AS scheduleId,
                transaction_id AS transactionId,
                payment_date AS paymentDate,
                amount,
                principal_amount AS principalAmount,
                interest_amount AS interestAmount,
                created_at AS createdAt
            FROM loan_schedule_payments
            WHERE schedule_id = ?
            ORDER BY created_at ASC, id ASC
            `
        )
        .all(scheduleId) as unknown as Array<{
        id: string;
        createdAt: string;
    }>;
}

// Mirrors LoanSchedulePaymentRepository.getByTransactionIds' exact
// query text.
function getByTransactionIds(
    db: DatabaseSync,
    transactionIds: string[]
): Array<{ id: string; transactionId: string }> {
    if (transactionIds.length === 0) {
        return [];
    }

    const placeholders = transactionIds
        .map(() => "?")
        .join(", ");

    return db
        .prepare(
            `
            SELECT
                id,
                loan_id AS loanId,
                schedule_id AS scheduleId,
                transaction_id AS transactionId,
                payment_date AS paymentDate,
                amount,
                principal_amount AS principalAmount,
                interest_amount AS interestAmount,
                created_at AS createdAt
            FROM loan_schedule_payments
            WHERE transaction_id IN (${placeholders})
            `
        )
        .all(...transactionIds) as unknown as Array<{
        id: string;
        transactionId: string;
    }>;
}

describe("LoanSchedulePaymentRepository.getByTransactionIds - bulk EMI-link lookup", () => {
    it("returns only the rows whose transaction_id is in the given list", () => {
        const db = createDb();

        insertPayment(db, {
            id: "pay-1",
            transactionId: "txn-1",
            createdAt: "2026-02-01T10:00:00",
        });
        insertPayment(db, {
            id: "pay-2",
            transactionId: "txn-2",
            createdAt: "2026-02-01T10:00:00",
        });
        insertPayment(db, {
            id: "pay-3",
            transactionId: "txn-3",
            createdAt: "2026-02-01T10:00:00",
        });

        const rows = getByTransactionIds(db, [
            "txn-1",
            "txn-3",
            "txn-missing",
        ]);

        expect(
            rows.map(row => row.transactionId).sort()
        ).toEqual(["txn-1", "txn-3"]);

        db.close();
    });

    it("returns [] for an empty id list", () => {
        const db = createDb();

        expect(getByTransactionIds(db, [])).toEqual(
            []
        );

        db.close();
    });

    it("returns [] when none of the given ids match any payment (missing/already-deleted transactions)", () => {
        const db = createDb();

        insertPayment(db, {
            id: "pay-1",
            transactionId: "txn-1",
            createdAt: "2026-02-01T10:00:00",
        });

        expect(
            getByTransactionIds(db, ["txn-missing"])
        ).toEqual([]);

        db.close();
    });
});

describe("LoanSchedulePaymentRepository.getAllByScheduleId - deterministic ordering", () => {
    it("orders by id when created_at values are identical (equal-timestamp regression)", () => {
        const db = createDb();

        // Inserted deliberately out of id order, all sharing the same
        // created_at - if the query only sorted by created_at, SQLite
        // would give no guaranteed order for these three rows.
        insertPayment(db, {
            id: "pay-c",
            transactionId: "txn-c",
            createdAt: "2026-02-01T10:00:00",
        });
        insertPayment(db, {
            id: "pay-a",
            transactionId: "txn-a",
            createdAt: "2026-02-01T10:00:00",
        });
        insertPayment(db, {
            id: "pay-b",
            transactionId: "txn-b",
            createdAt: "2026-02-01T10:00:00",
        });

        const rows = getAllByScheduleId(db, "sch-1");

        expect(rows.map(row => row.id)).toEqual([
            "pay-a",
            "pay-b",
            "pay-c",
        ]);

        db.close();
    });

    it("still orders by created_at first when timestamps differ, regardless of id", () => {
        const db = createDb();

        insertPayment(db, {
            id: "pay-z",
            transactionId: "txn-z",
            createdAt: "2026-02-01T10:00:00",
        });
        insertPayment(db, {
            id: "pay-a",
            transactionId: "txn-a",
            createdAt: "2026-03-01T10:00:00",
        });

        const rows = getAllByScheduleId(db, "sch-1");

        // pay-z is chronologically first despite sorting after pay-a
        // alphabetically - created_at must win over id when they
        // actually differ.
        expect(rows.map(row => row.id)).toEqual([
            "pay-z",
            "pay-a",
        ]);

        db.close();
    });

    it("running the query twice against the same data returns the same order both times", () => {
        const db = createDb();

        insertPayment(db, {
            id: "pay-2",
            transactionId: "txn-2",
            createdAt: "2026-02-01T10:00:00",
        });
        insertPayment(db, {
            id: "pay-1",
            transactionId: "txn-1",
            createdAt: "2026-02-01T10:00:00",
        });

        const first = getAllByScheduleId(db, "sch-1").map(
            row => row.id
        );
        const second = getAllByScheduleId(db, "sch-1").map(
            row => row.id
        );

        expect(first).toEqual(second);
        expect(first).toEqual(["pay-1", "pay-2"]);

        db.close();
    });
});
