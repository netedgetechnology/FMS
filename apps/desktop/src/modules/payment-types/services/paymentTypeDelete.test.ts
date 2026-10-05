import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrations } from "@/core/database/migrations/registry";

import { deleteBlockerFor, deletePaymentType } from "../components/paymentTypeActions";
import { subscribePaymentTypesChanged } from "../hooks";

import {
    PAYMENT_TYPE_IN_USE_MESSAGE,
    PaymentTypeNotDeletableError,
    PaymentTypeService,
} from "./PaymentTypeService";

// ---------------------------------------------------------------------
// Delete Payment Type: only an unused, user-added type is permanently
// deleted. A type any persistent record stores - transactions (deleted
// ones too), import rules, learned rules, import history, unfinished
// imports - or a built-in type is refused with "deactivate instead", and
// nothing else in the database is ever changed. Runs every real FinWea
// migration (as the app does at startup) on an in-memory database.
// ---------------------------------------------------------------------

const sqlite = { db: null as DatabaseSync | null };

vi.mock("@/core/database/engine/SQLiteProvider", () => ({
    SQLiteProvider: {
        getInstance: () => ({
            async select(sql: string, binds: unknown[] = []) {
                return sqlite.db!.prepare(sql).all(...(binds as never[]));
            },
            async execute(sql: string, binds: unknown[] = []) {
                sqlite.db!.prepare(sql).run(...(binds as never[]));
            },
        }),
    },
}));

// Inserts a row, filling every NOT NULL column without a default with a
// placeholder so a test only states what it is about.
function insert(table: string, values: Record<string, unknown>): void {
    const row: Record<string, unknown> = { ...values };
    for (const column of sqlite.db!.prepare(`PRAGMA table_info(${table})`).all() as {
        name: string; type: string; notnull: number; dflt_value: unknown; pk: number;
    }[]) {
        if (column.name in row || !column.notnull || column.dflt_value !== null) continue;
        row[column.name] = /INT|REAL|NUM/i.test(column.type) ? 0 : `${column.name}-${Math.random().toString(36).slice(2, 8)}`;
    }
    const columns = Object.keys(row);
    sqlite.db!.prepare(
        `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
    ).run(...(Object.values(row) as never[]));
}

const snapshot = () =>
    Object.fromEntries(
        (sqlite.db!.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'payment_types' ORDER BY name").all() as { name: string }[])
            .map(({ name }) => [name, JSON.stringify(sqlite.db!.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all())])
    );

let refreshes = 0;
let unsubscribe: () => void = () => {};

beforeEach(() => {
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
    for (const migration of migrations) {
        for (const statement of migration.sql.split(";").map(s => s.trim()).filter(Boolean)) {
            if (!/^PRAGMA\s+foreign_keys\s*=\s*ON\s*$/i.test(statement)) db.exec(statement);
        }
    }
    sqlite.db = db;
    refreshes = 0;
    unsubscribe = subscribePaymentTypesChanged(() => { refreshes += 1; });
});

afterEach(() => {
    unsubscribe();
    vi.restoreAllMocks();
});

const service = () => new PaymentTypeService();
const exists = (code: string) =>
    (sqlite.db!.prepare("SELECT COUNT(*) AS n FROM payment_types WHERE code = ?").get(code) as { n: number }).n === 1;

async function addUnused(label = "Test Payment Type 2") {
    const id = await service().create({ label });
    return (await service().getAll()).find(t => t.id === id)!;
}

describe("Delete an unused Payment Type", () => {
    it("is permanently removed, lists refresh, and no other table changes", async () => {
        insert("transactions", { id: "t1", payment_method: "UPI", transaction_type: "NEFT", amount: 500 });
        const type = await addUnused();
        const before = snapshot();

        expect(await deleteBlockerFor(service(), type)).toBeNull();
        const result = await deletePaymentType(service(), type);

        expect(result).toMatchObject({ ok: true, success: '"Test Payment Type 2" deleted.' });
        expect(exists("TEST_PAYMENT_TYPE_2")).toBe(false);
        expect((await service().getAll()).some(t => t.id === type.id)).toBe(false);
        expect(refreshes).toBe(1);
        expect(snapshot()).toEqual(before);
    });

    it("an inactive unused type can also be deleted", async () => {
        const type = await addUnused();
        await service().update({ id: type.id, isActive: false });

        await service().delete(type.id);

        expect(exists("TEST_PAYMENT_TYPE_2")).toBe(false);
    });

    it("after deletion the same name can be added again as a new record", async () => {
        const type = await addUnused();
        await service().delete(type.id);

        const again = await addUnused();

        expect(again.id).not.toBe(type.id);
        expect(again).toMatchObject({ code: "TEST_PAYMENT_TYPE_2", isActive: true });
    });
});

describe("Delete is refused for a Payment Type in use - deactivate instead", () => {
    const cases: Array<[string, () => void, RegExp]> = [
        ["a transaction's Payment Method", () => insert("transactions", { id: "t1", payment_method: "TEST_PAYMENT_TYPE_2" }), /1 transaction\b/],
        ["a transaction's Payment Type (import channel)", () => insert("transactions", { id: "t1", transaction_type: "TEST_PAYMENT_TYPE_2" }), /1 transaction\b/],
        ["a soft-deleted transaction", () => insert("transactions", { id: "t1", payment_method: "TEST_PAYMENT_TYPE_2", deleted_at: "2026-10-01" }), /1 transaction\b/],
        ["a Custom Import Rule", () => insert("import_custom_rules", { id: "r1", transaction_type: "TEST_PAYMENT_TYPE_2" }), /1 import rule\b/],
        ["a learned import rule", () => insert("counterparty_rules", { id: "c1", type: "TEST_PAYMENT_TYPE_2" }), /1 learned import rule/],
        ["import history", () => insert("import_rows", { id: "ir1", import_batch_id: "b1", row_number: 1, normalized_data: JSON.stringify({ transactionType: "TEST_PAYMENT_TYPE_2" }) }), /1 import history row/],
        ["an unfinished import", () => insert("import_drafts", { id: "d1", state_json: JSON.stringify({ overrides: { transactionType: [[2, "TEST_PAYMENT_TYPE_2"]] } }), preview_json: "{}" }), /1 unfinished import/],
    ];

    it.each(cases)("used by %s: blocked with the deactivate message; nothing is deleted or changed", async (_label, use, detail) => {
        const type = await addUnused();
        use();
        const before = snapshot();
        vi.spyOn(console, "error").mockImplementation(() => {});

        const blocker = await deleteBlockerFor(service(), type);
        expect(blocker).toContain(PAYMENT_TYPE_IN_USE_MESSAGE);
        expect(blocker).toMatch(detail);

        // The service refuses even if asked directly.
        await expect(service().delete(type.id)).rejects.toBeInstanceOf(PaymentTypeNotDeletableError);
        const result = await deletePaymentType(service(), type);
        expect(result.ok).toBe(false);
        expect(result.error).toContain(PAYMENT_TYPE_IN_USE_MESSAGE);

        expect(exists("TEST_PAYMENT_TYPE_2")).toBe(true);
        expect(snapshot()).toEqual(before);
        expect(refreshes).toBe(0);
    });

    it("a similar but different code does not block deletion", async () => {
        const type = await addUnused();
        insert("transactions", { id: "t1", payment_method: "TEST_PAYMENT_TYPE_20" });
        insert("import_rows", { id: "ir1", import_batch_id: "b1", row_number: 1, normalized_data: JSON.stringify({ transactionType: "TEST_PAYMENT_TYPE_20" }) });

        expect(await deleteBlockerFor(service(), type)).toBeNull();
    });
});

describe("Built-in Payment Types are never deleted", () => {
    it.each(["UPI", "PAYPAL", "OTHER", "CARD"])("%s: refused with deactivate instead, even when unused", async code => {
        const type = (await service().getAll()).find(t => t.code === code)!;

        const blocker = await deleteBlockerFor(service(), type);

        expect(blocker).toMatch(/is a built-in payment type and cannot be deleted\. Deactivate it instead\./);
        await expect(service().delete(type.id)).rejects.toBeInstanceOf(PaymentTypeNotDeletableError);
        expect(exists(code)).toBe(true);
    });
});
