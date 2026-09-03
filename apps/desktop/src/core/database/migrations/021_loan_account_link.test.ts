import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { LoanAccountLinkMigration } from "./021_loan_account_link";

/**
 * Replicates MigrationEngine's statement splitting. The one-time DDL
 * (ALTER / CREATE INDEX) is filtered out so the DML can be exercised
 * repeatedly for the idempotency checks; the test schema already has the
 * loan_account_id column.
 */
function runMigration(db: DatabaseSync): void {
    const statements = LoanAccountLinkMigration.sql
        .split(";")
        .map(statement => statement.trim())
        .filter(statement => statement.length > 0)
        .filter(
            statement =>
                !/^PRAGMA\s+foreign_keys\s*=\s*ON\s*$/i.test(statement)
        )
        .filter(statement => !/^ALTER\s+TABLE/i.test(statement))
        .filter(statement => !/^CREATE\s+INDEX/i.test(statement));

    for (const statement of statements) {
        db.exec(statement);
    }
}

function createDb(): DatabaseSync {
    const db = new DatabaseSync(":memory:");

    db.exec(`
        CREATE TABLE accounts (
            id TEXT PRIMARY KEY,
            institution_id TEXT,
            currency_id TEXT NOT NULL DEFAULT 'INR',
            name TEXT NOT NULL,
            account_type TEXT NOT NULL,
            opening_balance REAL NOT NULL DEFAULT 0,
            description TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            deleted_at TEXT
        );

        CREATE TABLE loans (
            id TEXT PRIMARY KEY,
            account_id TEXT,
            loan_account_id TEXT,
            lender_institution_id TEXT,
            name TEXT NOT NULL,
            currency_id TEXT NOT NULL DEFAULT 'INR',
            outstanding_principal REAL NOT NULL DEFAULT 0,
            outstanding_interest REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'ACTIVE',
            created_at TEXT NOT NULL DEFAULT '2026-01-01 00:00:00',
            updated_at TEXT NOT NULL DEFAULT '2026-01-01 00:00:00',
            deleted_at TEXT
        );
    `);

    return db;
}

interface LoanRow {
    id: string;
    name?: string;
    lender?: string | null;
    currency?: string;
    principal?: number;
    interest?: number;
    status?: string;
    emiAccount?: string | null;
    loanAccount?: string | null;
    deleted?: string | null;
}

function insertLoan(db: DatabaseSync, row: LoanRow): void {
    db.prepare(
        `INSERT INTO loans
         (id, account_id, loan_account_id, lender_institution_id, name,
          currency_id, outstanding_principal, outstanding_interest, status, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
        row.id,
        row.emiAccount ?? null,
        row.loanAccount ?? null,
        row.lender ?? null,
        row.name ?? "loan",
        row.currency ?? "INR",
        row.principal ?? 0,
        row.interest ?? 0,
        row.status ?? "ACTIVE",
        row.deleted ?? null
    );
}

function insertAccount(
    db: DatabaseSync,
    id: string,
    type: string,
    deleted: string | null = null
): void {
    db.prepare(
        `INSERT INTO accounts (id, name, account_type, deleted_at)
         VALUES (?, ?, ?, ?)`
    ).run(id, id, type, deleted);
}

function getAccount(
    db: DatabaseSync,
    id: string
): Record<string, unknown> | undefined {
    return db
        .prepare(`SELECT * FROM accounts WHERE id = ?`)
        .get(id) as Record<string, unknown> | undefined;
}

function getLoan(
    db: DatabaseSync,
    id: string
): Record<string, unknown> {
    return db
        .prepare(`SELECT * FROM loans WHERE id = ?`)
        .get(id) as Record<string, unknown>;
}

describe("migration 021 - loan account link", () => {
    it("is registered with version 21", () => {
        expect(LoanAccountLinkMigration.version).toBe(21);
    });

    it("creates one LOAN account per live loan and links it", () => {
        const db = createDb();

        insertLoan(db, {
            id: "loan-1",
            name: "HDFC Home Loan",
            lender: "inst-hdfc",
            currency: "INR",
            principal: 4500000,
            interest: 158746.29,
            status: "ACTIVE",
            emiAccount: "sav-emi",
        });

        runMigration(db);

        const loan = getLoan(db, "loan-1");
        expect(loan.loan_account_id).toBe("loan-loan-1");
        // EMI/payment account link is preserved, untouched.
        expect(loan.account_id).toBe("sav-emi");

        const account = getAccount(db, "loan-loan-1");
        expect(account).toBeTruthy();
        expect(account?.account_type).toBe("LOAN");
        expect(account?.opening_balance).toBe(0);
        expect(account?.name).toBe("HDFC Home Loan");
        expect(account?.currency_id).toBe("INR");
        expect(account?.institution_id).toBe("inst-hdfc");
        expect(account?.is_active).toBe(1);
        expect(account?.deleted_at).toBeNull();
    });

    it("marks the loan account inactive for a closed loan", () => {
        const db = createDb();

        insertLoan(db, { id: "loan-2", status: "CLOSED" });

        runMigration(db);

        expect(getAccount(db, "loan-loan-2")?.is_active).toBe(0);
    });

    it("does not create an account for a soft-deleted loan", () => {
        const db = createDb();

        insertLoan(db, {
            id: "loan-3",
            deleted: "2026-08-01 10:00:00",
        });

        runMigration(db);

        expect(getAccount(db, "loan-loan-3")).toBeUndefined();
        expect(getLoan(db, "loan-3").loan_account_id).toBeNull();
    });

    it("leaves a loan that already has a loan account untouched", () => {
        const db = createDb();

        insertAccount(db, "existing-loan-acct", "LOAN");
        insertLoan(db, {
            id: "loan-4",
            loanAccount: "existing-loan-acct",
        });

        runMigration(db);

        expect(getLoan(db, "loan-4").loan_account_id).toBe(
            "existing-loan-acct"
        );
        expect(getAccount(db, "loan-loan-4")).toBeUndefined();
    });

    it("leaves legacy soft-deleted account_type='LOAN' rows untouched", () => {
        const db = createDb();

        insertAccount(db, "legacy-uuid-1", "LOAN", "2026-08-23 16:10:24");
        insertLoan(db, { id: "loan-5" });

        runMigration(db);

        expect(getAccount(db, "legacy-uuid-1")?.deleted_at).toBe(
            "2026-08-23 16:10:24"
        );
        // the live loan still gets its own fresh account
        expect(getAccount(db, "loan-loan-5")?.deleted_at).toBeNull();
    });

    it("is idempotent - re-running the DML makes no further changes", () => {
        const db = createDb();

        insertLoan(db, { id: "loan-6", principal: 100, interest: 5 });

        runMigration(db);
        const accountsAfterFirst = db
            .prepare(`SELECT COUNT(*) AS n FROM accounts`)
            .get() as { n: number };
        const linkAfterFirst = getLoan(db, "loan-6").loan_account_id;

        runMigration(db);
        const accountsAfterSecond = db
            .prepare(`SELECT COUNT(*) AS n FROM accounts`)
            .get() as { n: number };

        expect(accountsAfterSecond.n).toBe(accountsAfterFirst.n);
        expect(getLoan(db, "loan-6").loan_account_id).toBe(linkAfterFirst);
    });

    it("backfills multiple loans in one pass", () => {
        const db = createDb();

        for (const n of [1, 2, 3]) {
            insertLoan(db, { id: `bulk-${n}` });
        }

        runMigration(db);

        const loanAccounts = db
            .prepare(
                `SELECT COUNT(*) AS n FROM accounts WHERE account_type = 'LOAN'`
            )
            .get() as { n: number };
        expect(loanAccounts.n).toBe(3);
    });
});
