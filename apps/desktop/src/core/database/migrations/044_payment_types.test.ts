import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import type { TransactionChannel as EngineTransactionChannel } from "@financeos/import-engine";

import { migrations } from "./registry";
import { PaymentTypesMigration, SEEDED_PAYMENT_TYPES } from "./044_payment_types";

function runMigration(db: DatabaseSync): void {
    // Exactly how MigrationEngine runs it: split on ";".
    for (const statement of PaymentTypesMigration.sql
        .split(";")
        .map(part => part.trim())
        .filter(part => part.length > 0)) {
        db.exec(statement);
    }
}

function createDb(): DatabaseSync {
    const db = new DatabaseSync(":memory:");
    runMigration(db);
    return db;
}

const all = (db: DatabaseSync) =>
    db.prepare(`SELECT * FROM payment_types ORDER BY sort_order`).all() as Record<string, unknown>[];

// Every code the import engine can detect from a bank narration. A
// Record over the engine's own type: adding a channel to the engine
// without listing it here fails to compile, so the seed can never miss one.
const ENGINE_DETECTED: Record<EngineTransactionChannel, true> = {
    UPI: true, IMPS: true, NEFT: true, RTGS: true, CASH: true, CHEQUE: true,
    EMANDATE: true, NET_BANKING: true, MOBILE_APP: true, CREDIT_CARD: true,
};

// Every value the Payment Method field accepted before the master list.
const PREVIOUS_PAYMENT_METHODS = [
    "CASH", "CARD", "DEBIT_CARD", "UPI", "BANK_TRANSFER", "DIRECT_DEBIT", "PAYPAL", "OTHER",
];

describe("migration 044 - payment_types master list", () => {
    it("is version 44 (43 is retired) and registered last", () => {
        expect(PaymentTypesMigration.version).toBe(44);
        expect(migrations[migrations.length - 1]).toBe(PaymentTypesMigration);
        expect(migrations.some(migration => migration.version === 43)).toBe(false);
    });

    it("has the required columns", () => {
        const db = createDb();
        const columns = (db.prepare(`PRAGMA table_info(payment_types)`).all() as { name: string }[])
            .map(column => column.name);

        expect(columns).toEqual([
            "id", "code", "label", "is_active", "sort_order", "created_at", "updated_at",
        ]);
    });

    it("seeds exactly the expected types, in order, with their stored codes and labels", () => {
        const rows = all(createDb()).map(row => [row.code, row.label, row.is_active]);

        expect(rows).toEqual([
            ["UPI", "UPI", 1],
            ["IMPS", "IMPS", 1],
            ["NEFT", "NEFT", 1],
            ["RTGS", "RTGS", 1],
            ["CASH", "Cash", 1],
            ["CHEQUE", "Cheque", 1],
            ["EMANDATE", "E-Mandate", 1],
            ["NET_BANKING", "Net Banking", 1],
            ["MOBILE_APP", "Mobile App", 1],
            ["CREDIT_CARD", "Credit Card", 1],
            ["DEBIT_CARD", "Debit Card", 1],
            ["BANK_TRANSFER", "Bank Transfer", 1],
            ["DIRECT_DEBIT", "Direct Debit", 1],
            ["PAYPAL", "PayPal", 1],
            ["OTHER", "Other", 1],
            ["CARD", "Credit Card (legacy)", 0],
        ]);
        expect(rows).toHaveLength(SEEDED_PAYMENT_TYPES.length);
    });

    it("the twelve required types are present and active", () => {
        const active = all(createDb()).filter(row => row.is_active === 1).map(row => row.label);

        for (const label of [
            "UPI", "IMPS", "NEFT", "RTGS", "Cash", "Cheque", "E-Mandate",
            "Net Banking", "Mobile App", "Credit Card", "PayPal", "Other",
        ]) {
            expect(active, label).toContain(label);
        }
    });

    it("omits no previously supported value: every engine-detected and every Payment Method code is seeded", () => {
        const codes = all(createDb()).map(row => row.code);

        for (const code of [...Object.keys(ENGINE_DETECTED), ...PREVIOUS_PAYMENT_METHODS]) {
            expect(codes, code).toContain(code);
        }
    });

    it("rejects a duplicate code or label, case- and whitespace-insensitively", () => {
        const db = createDb();
        const insert = (id: string, code: string, label: string) =>
            db.prepare(`INSERT INTO payment_types (id, code, label) VALUES (?, ?, ?)`).run(id, code, label);

        expect(() => insert("x1", "paypal", "Pay Pal 2")).toThrow(/UNIQUE/);
        expect(() => insert("x2", "PAYPAL_2", " paypal ")).toThrow(/UNIQUE/);
        expect(() => insert("x3", "GOOGLE_PAY", "Google Pay")).not.toThrow();
    });

    it("re-running is a no-op and never overwrites a user's rename or deactivation", () => {
        const db = createDb();
        db.exec(`UPDATE payment_types SET label = 'PayPal (personal)', is_active = 0 WHERE code = 'PAYPAL'`);

        runMigration(db);

        const paypal = all(db).find(row => row.code === "PAYPAL")!;
        expect(paypal.label).toBe("PayPal (personal)");
        expect(paypal.is_active).toBe(0);
        expect(all(db)).toHaveLength(SEEDED_PAYMENT_TYPES.length);
    });

    it("does not read or change any transaction", () => {
        const db = new DatabaseSync(":memory:");
        db.exec(`
            CREATE TABLE transactions (id TEXT PRIMARY KEY, payment_method TEXT, transaction_type TEXT, amount REAL);
            INSERT INTO transactions VALUES ('t1', 'CARD', 'NET_BANKING', 10), ('t2', NULL, 'SOMETHING_OLD', 20), ('t3', 'OTHER', NULL, 30);
        `);
        const before = db.prepare(`SELECT * FROM transactions ORDER BY id`).all();

        runMigration(db);

        expect(db.prepare(`SELECT * FROM transactions ORDER BY id`).all()).toEqual(before);
    });
});
