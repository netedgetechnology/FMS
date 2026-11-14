import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { LoanInterestRateHistoryMigration as migration } from "./054_loan_interest_rate_history";
import { migrations } from "./registry";

function run(db: DatabaseSync, sql: string): void {
    for (const statement of sql.split(";").map(part => part.trim()).filter(Boolean)) {
        if (!/^PRAGMA\s+foreign_keys\s*=\s*ON\s*$/i.test(statement)) db.exec(statement);
    }
}

// In-memory only: this never opens a file, let alone the live database.
function databaseBefore(foreignKeys = false): DatabaseSync {
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: foreignKeys });
    for (const item of migrations) {
        if (item.version < migration.version) run(db, item.sql);
    }
    return db;
}

/** A database with 054 applied and one synthetic loan, "loan-1". */
function withLoan(foreignKeys = true): DatabaseSync {
    const db = databaseBefore(foreignKeys);
    run(db, migration.sql);
    db.exec(`INSERT INTO accounts (id, name, account_type, opening_balance, currency_id) VALUES ('acct-1', 'Synthetic Loan Account', 'LOAN', 0, 'INR')`);
    db.exec(
        `INSERT INTO loans (id, account_id, loan_type, name, principal_amount, interest_rate, interest_type, start_date, outstanding_principal, currency_id, created_at, updated_at)
         VALUES ('loan-1', 'acct-1', 'Term Loan', 'Synthetic Loan', 100000, 10.5, 'REDUCING', '2026-01-31', 100000, 'INR', '2026-01-31', '2026-01-31')`
    );
    return db;
}

const insert = (db: DatabaseSync, values: Record<string, unknown>) => {
    const row = { loan_id: "loan-1", effective_from: "2026-01-31", rate: 10.5, source: "INITIAL", ...values };
    const columns = Object.keys(row);
    db.prepare(`INSERT INTO loan_interest_rate_history (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(...(Object.values(row) as never[]));
};

describe("migration 054 - Loan Interest Rate History", () => {
    it("is registered once, as the last migration (activated 2026-11-13)", () => {
        expect(migrations.filter(item => item.version === migration.version)).toEqual([migration]);
        expect(migrations[migrations.length - 1]).toBe(migration);
        expect(migrations.filter(item => item.version < migration.version).every(item => item !== migration)).toBe(true);
    });

    it("a database built from the whole registry has the table, the tightened index, and no rows", () => {
        const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
        for (const item of migrations) run(db, item.sql);

        expect((db.prepare("PRAGMA index_info('ux_loan_interest_rate_history_live')").all() as Array<{ name: string }>).map(column => column.name)).toEqual(["loan_id", "effective_from"]);
        expect(db.prepare("SELECT COUNT(*) AS n FROM loan_interest_rate_history").get()).toEqual({ n: 0 });
    });

    it("splits into statements the migration engine can run (no ';' inside one)", () => {
        const statements = migration.sql.split(";").map(part => part.trim()).filter(Boolean);
        expect(statements).toHaveLength(3);
        expect(statements[0]).toMatch(/^CREATE TABLE IF NOT EXISTS loan_interest_rate_history/);
    });

    it("adds one empty table, changes no existing table, and writes no row for an existing loan", () => {
        const db = databaseBefore();
        db.exec(`INSERT INTO loans (id, loan_type, name, principal_amount, interest_rate, start_date, currency_id, created_at, updated_at) VALUES ('old', 'Term Loan', 'Existing', 1, 9, '2025-01-01', 'INR', 'x', 'x')`);
        const shape = () => db.prepare("SELECT name, sql FROM sqlite_master WHERE type IN ('table', 'index') AND tbl_name != 'loan_interest_rate_history' ORDER BY name").all();
        const loansBefore = db.prepare("SELECT * FROM loans").all();
        const before = shape();

        run(db, migration.sql);

        expect(shape()).toEqual(before);
        expect(db.prepare("SELECT * FROM loans").all()).toEqual(loansBefore);
        expect(db.prepare("SELECT COUNT(*) AS n FROM loan_interest_rate_history").get()).toEqual({ n: 0 });
    });

    it("can be applied twice without error (IF NOT EXISTS)", () => {
        const db = databaseBefore();
        run(db, migration.sql);
        expect(() => run(db, migration.sql)).not.toThrow();
    });

    it("has every approved column", () => {
        const db = withLoan();
        const columns = (db.prepare("PRAGMA table_info(loan_interest_rate_history)").all() as Array<{ name: string }>).map(c => c.name);

        expect(columns).toEqual([
            "id",
            "loan_id",
            "effective_from",
            "rate",
            "previous_rate",
            "rate_type",
            "source",
            "reference",
            "document_id",
            "notes",
            "applied_from_instalment",
            "created_at",
            "superseded_by",
            "superseded_at",
            "correction_reason",
        ]);
    });

    it("stores a full record, with created_at defaulted", () => {
        const db = withLoan();
        db.exec(`INSERT INTO documents (id, name, document_type, file_path) VALUES ('doc-1', 'Synthetic notice.pdf', 'LENDER_NOTICE', 'x')`);
        insert(db, { id: "r1" });
        insert(db, { id: "r2", effective_from: "2026-07-01", rate: 10.75, previous_rate: 10.5, rate_type: "FLOATING", source: "LENDER_NOTICE", reference: "SYN-REF-1", document_id: "doc-1", notes: "Synthetic", applied_from_instalment: 5 });

        const row = db.prepare("SELECT * FROM loan_interest_rate_history WHERE id = 'r2'").get() as Record<string, unknown>;
        expect(row).toMatchObject({ rate: 10.75, previous_rate: 10.5, rate_type: "FLOATING", source: "LENDER_NOTICE", reference: "SYN-REF-1", document_id: "doc-1", applied_from_instalment: 5, superseded_at: null });
        expect(row.created_at).toEqual(expect.any(String));
    });

    it("refuses a duplicate live entry for the same loan, date and rate", () => {
        const db = withLoan();
        insert(db, { id: "r1" });

        expect(() => insert(db, { id: "r2", source: "MANUAL" })).toThrow(/UNIQUE/);
        // Another date is a different entry.
        expect(() => insert(db, { id: "r4", effective_from: "2026-02-01" })).not.toThrow();
    });

    // Pre-activation audit M2: one live rate per loan and date, whatever the rate.
    it("refuses a second live rate on the same date, even a different one", () => {
        const db = withLoan();
        insert(db, { id: "r1" });

        expect(() => insert(db, { id: "r2", rate: 10.75, source: "MANUAL" })).toThrow(/UNIQUE/);
        expect(() => insert(db, { id: "r3", rate: 0, source: "STATEMENT_IMPORT" })).toThrow(/UNIQUE/);
        expect(db.prepare("SELECT id FROM loan_interest_rate_history").all()).toEqual([{ id: "r1" }]);
    });

    it("the unique index is partial, on (loan_id, effective_from) of live rows only", () => {
        const db = withLoan();
        const index = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'ux_loan_interest_rate_history_live'").get() as { sql: string };
        expect(index.sql).toMatch(/UNIQUE INDEX/);
        expect(index.sql).toMatch(/WHERE superseded_at IS NULL/);
        expect((db.prepare("PRAGMA index_info('ux_loan_interest_rate_history_live')").all() as Array<{ name: string }>).map(column => column.name)).toEqual(["loan_id", "effective_from"]);
    });

    it("keeps valid history: one rate per date across many dates, and the same date on other loans", () => {
        const db = withLoan();
        db.exec(
            `INSERT INTO loans (id, account_id, loan_type, name, principal_amount, interest_rate, interest_type, start_date, outstanding_principal, currency_id, created_at, updated_at)
             VALUES ('loan-2', 'acct-1', 'Term Loan', 'Synthetic Loan 2', 50000, 9, 'REDUCING', '2026-01-31', 50000, 'INR', '2026-01-31', '2026-01-31')`
        );
        insert(db, { id: "a0" });
        insert(db, { id: "a1", effective_from: "2026-04-01", rate: 10.75, previous_rate: 10.5, source: "MANUAL" });
        insert(db, { id: "a2", effective_from: "2026-07-01", rate: 10.5, previous_rate: 10.75, source: "LENDER_NOTICE" });
        insert(db, { id: "b0", loan_id: "loan-2", rate: 9 });
        insert(db, { id: "b1", loan_id: "loan-2", effective_from: "2026-04-01", rate: 10.75, source: "STATEMENT_IMPORT" });

        expect(db.prepare("SELECT COUNT(*) AS n FROM loan_interest_rate_history WHERE superseded_at IS NULL").get()).toEqual({ n: 5 });
    });

    it("a correction on the SAME date: supersede first, then insert the replacement, in one transaction", () => {
        const db = withLoan(true);
        insert(db, { id: "r1" });

        // The order rate_change.rs uses, with superseded_by checked at commit.
        db.exec("BEGIN");
        db.exec("PRAGMA defer_foreign_keys = ON");
        db.exec("UPDATE loan_interest_rate_history SET superseded_by = 'r1b', superseded_at = '2026-02-01', correction_reason = 'Synthetic typo' WHERE id = 'r1'");
        insert(db, { id: "r1b", rate: 10.25 });
        db.exec("COMMIT");

        expect(db.prepare("SELECT id, rate FROM loan_interest_rate_history WHERE superseded_at IS NULL").all()).toEqual([{ id: "r1b", rate: 10.25 }]);
        expect(db.prepare("SELECT superseded_by FROM loan_interest_rate_history WHERE id = 'r1'").get()).toEqual({ superseded_by: "r1b" });
    });

    it("inserting the replacement BEFORE superseding is refused - and a refused correction changes nothing", () => {
        const db = withLoan(true);
        insert(db, { id: "r1" });

        db.exec("BEGIN");
        expect(() => insert(db, { id: "r1b", rate: 10.25 })).toThrow(/UNIQUE/);
        db.exec("ROLLBACK");
        expect(db.prepare("SELECT id, superseded_at FROM loan_interest_rate_history").all()).toEqual([{ id: "r1", superseded_at: null }]);
    });

    it("a correction to ANOTHER date, and corrections of corrections: superseded rows never block", () => {
        const db = withLoan(true);
        insert(db, { id: "r1", effective_from: "2026-04-01", rate: 11, source: "MANUAL" });
        insert(db, { id: "r2", effective_from: "2026-04-15", rate: 11, source: "MANUAL" });
        db.exec("UPDATE loan_interest_rate_history SET superseded_by = 'r2', superseded_at = '2026-05-01', correction_reason = 'Wrong date' WHERE id = 'r1'");
        // The original date is free again, for a later correction back to it.
        insert(db, { id: "r3", effective_from: "2026-04-01", rate: 11.25, source: "MANUAL" });
        db.exec("UPDATE loan_interest_rate_history SET superseded_by = 'r3', superseded_at = '2026-05-02', correction_reason = 'Back to the notice date' WHERE id = 'r2'");
        // Two superseded rows may share a date with the live one.
        db.exec("BEGIN");
        db.exec("PRAGMA defer_foreign_keys = ON");
        db.exec("UPDATE loan_interest_rate_history SET superseded_by = 'r4', superseded_at = '2026-05-03', correction_reason = 'Rate typo' WHERE id = 'r3'");
        insert(db, { id: "r4", effective_from: "2026-04-01", rate: 11.5, source: "MANUAL" });
        db.exec("COMMIT");

        expect(db.prepare("SELECT id FROM loan_interest_rate_history WHERE superseded_at IS NULL").all()).toEqual([{ id: "r4" }]);
        expect(db.prepare("SELECT COUNT(*) AS n FROM loan_interest_rate_history WHERE effective_from = '2026-04-01'").get()).toEqual({ n: 3 });
        expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    });

    it("re-running keeps the rows and the tightened index", () => {
        const db = withLoan();
        insert(db, { id: "r1" });
        run(db, migration.sql);

        expect(db.prepare("SELECT COUNT(*) AS n FROM loan_interest_rate_history").get()).toEqual({ n: 1 });
        expect(() => insert(db, { id: "r2", rate: 11 })).toThrow(/UNIQUE/);
        expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    });

    it("refuses a supersession without its date, its reason, or pointing at itself", () => {
        const db = withLoan();
        insert(db, { id: "r1" });
        insert(db, { id: "r2", effective_from: "2026-02-01", rate: 11 });

        expect(() => db.exec("UPDATE loan_interest_rate_history SET superseded_by = 'r2' WHERE id = 'r1'")).toThrow(/CHECK/);
        expect(() => db.exec("UPDATE loan_interest_rate_history SET superseded_at = '2026-02-01', correction_reason = 'x' WHERE id = 'r1'")).toThrow(/CHECK/);
        expect(() => db.exec("UPDATE loan_interest_rate_history SET superseded_by = 'r2', superseded_at = '2026-02-01' WHERE id = 'r1'")).toThrow(/CHECK/);
        expect(() => db.exec("UPDATE loan_interest_rate_history SET superseded_by = 'r2', superseded_at = '2026-02-01', correction_reason = '  ' WHERE id = 'r1'")).toThrow(/CHECK/);
        expect(() => db.exec("UPDATE loan_interest_rate_history SET superseded_by = 'r1', superseded_at = '2026-02-01', correction_reason = 'x' WHERE id = 'r1'")).toThrow(/CHECK/);
    });

    it("refuses impossible values", () => {
        const db = withLoan();
        const bad: Array<Record<string, unknown>> = [
            { id: "b1", rate: -0.01 },
            { id: "b2", rate: 100.01 },
            { id: "b3", previous_rate: -1 },
            { id: "b4", rate_type: "VARIABLE" },
            { id: "b5", source: "GUESS" },
            { id: "b6", effective_from: "31/01/2026" },
            { id: "b7", effective_from: "2026-1-31" },
            { id: "b8", applied_from_instalment: 0 },
            { id: "b9", effective_from: null },
        ];
        for (const values of bad) expect(() => insert(db, values), JSON.stringify(values)).toThrow(/CHECK|NOT NULL/);
    });

    it("with foreign keys on, refuses an unknown loan, document or superseding row", () => {
        const db = withLoan(true);
        insert(db, { id: "r1" });

        expect(() => insert(db, { id: "x1", loan_id: "no-such-loan" })).toThrow(/FOREIGN KEY/);
        expect(() => insert(db, { id: "x2", effective_from: "2026-02-01", rate: 11, document_id: "no-such-document" })).toThrow(/FOREIGN KEY/);
        expect(() => db.exec("UPDATE loan_interest_rate_history SET superseded_by = 'no-such-row', superseded_at = '2026-02-01', correction_reason = 'x' WHERE id = 'r1'")).toThrow(/FOREIGN KEY/);
    });

    it("a soft-deleted loan keeps its history (loans are never hard-deleted)", () => {
        const db = withLoan(true);
        insert(db, { id: "r1" });
        db.exec("UPDATE loans SET deleted_at = '2026-03-01' WHERE id = 'loan-1'");

        expect(db.prepare("SELECT COUNT(*) AS n FROM loan_interest_rate_history").get()).toEqual({ n: 1 });
    });
});
