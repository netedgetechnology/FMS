import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { migrations } from "./registry";
import { LoanPaymentLinkSettlementMigration } from "./046_loan_payment_link_settlement";

// Every migration before 046, exactly as MigrationEngine runs them.
function databaseBefore046(): DatabaseSync {
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });

    for (const migration of migrations) {
        if (migration.version >= LoanPaymentLinkSettlementMigration.version) {
            continue;
        }

        for (const statement of migration.sql.split(";").map(part => part.trim()).filter(Boolean)) {
            if (!/^PRAGMA\s+foreign_keys\s*=\s*ON\s*$/i.test(statement)) {
                db.exec(statement);
            }
        }
    }

    return db;
}

function run046(db: DatabaseSync): void {
    for (const statement of LoanPaymentLinkSettlementMigration.sql
        .split(";")
        .map(part => part.trim())
        .filter(Boolean)) {
        db.exec(statement);
    }
}

function seedPayment(db: DatabaseSync, id: string, transactionId: string, imported: boolean): void {
    db.prepare(
        `INSERT INTO transactions (id, account_id, payee, type, amount, transaction_date, is_imported)
         VALUES (?, 'acct', 'Lender', 'expense', 100, '2026-06-05', ?)`
    ).run(transactionId, imported ? 1 : 0);
    db.prepare(
        `INSERT INTO loan_schedule_payments
         (id, loan_id, schedule_id, transaction_id, payment_date, amount, principal_amount, interest_amount)
         VALUES (?, 'loan', 'sch', ?, '2026-06-05', 100, 0, 100)`
    ).run(id, transactionId);
}

describe("migration 046 - loan payment link and settlement", () => {
    it("is registered right after 045", () => {
        const index = migrations.indexOf(LoanPaymentLinkSettlementMigration);
        expect(LoanPaymentLinkSettlementMigration.version).toBe(46);
        expect(migrations[index - 1]!.version).toBe(45);
    });

    it("marks existing payments of imported transactions as linked, and nothing as a settlement", () => {
        const db = databaseBefore046();
        seedPayment(db, "pay-imported", "txn-imported", true);
        seedPayment(db, "pay-manual", "txn-manual", false);

        run046(db);

        expect(
            db.prepare(
                "SELECT id, transaction_linked, settles_installment FROM loan_schedule_payments ORDER BY id"
            ).all()
        ).toEqual([
            { id: "pay-imported", transaction_linked: 1, settles_installment: 0 },
            { id: "pay-manual", transaction_linked: 0, settles_installment: 0 },
        ]);
    });

    it("leaves every other column and row untouched", () => {
        const db = databaseBefore046();
        seedPayment(db, "pay-1", "txn-1", true);
        const before = db.prepare("SELECT * FROM loan_schedule_payments").all();
        const transactionsBefore = db.prepare("SELECT * FROM transactions").all();

        run046(db);

        const after = db.prepare("SELECT * FROM loan_schedule_payments").all() as Record<string, unknown>[];
        expect(after.map(({ transaction_linked: _l, settles_installment: _s, ...rest }) => rest)).toEqual(before);
        expect(db.prepare("SELECT * FROM transactions").all()).toEqual(transactionsBefore);
    });
});
