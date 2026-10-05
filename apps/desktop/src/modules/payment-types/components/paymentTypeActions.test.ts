import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PaymentTypesMigration } from "@/core/database/migrations/044_payment_types";

import { subscribePaymentTypesChanged } from "../hooks";
import { PaymentTypeService } from "../services";

import {
    addPaymentType,
    newLabelAfter,
    reactivatePaymentType,
    togglePaymentTypeActive,
} from "./paymentTypeActions";

// ---------------------------------------------------------------------
// The Payment Types page's Add flow, end to end below the click: the
// exact action PaymentTypeManager runs on "Add Payment Type" -> the real
// PaymentTypeService -> the real PaymentTypeRepository SQL -> an
// in-memory database seeded by migration 044 (SQLiteProvider mocked) ->
// every open Payment Type list/selector told to reload.
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

let refreshes = 0;
let unsubscribe: () => void = () => {};

beforeEach(() => {
    const db = new DatabaseSync(":memory:");
    for (const statement of PaymentTypesMigration.sql.split(";").map(s => s.trim()).filter(Boolean)) {
        db.exec(statement);
    }
    sqlite.db = db;
    refreshes = 0;
    // What every mounted usePaymentTypes() does: reload on change.
    unsubscribe = subscribePaymentTypesChanged(() => {
        refreshes += 1;
    });
});

afterEach(() => {
    unsubscribe();
    vi.restoreAllMocks();
});

const rows = () =>
    sqlite.db!.prepare("SELECT code, label, is_active FROM payment_types ORDER BY sort_order").all() as {
        code: string; label: string; is_active: number;
    }[];

describe("Add Payment Type", () => {
    it("a valid name is submitted to the service, the record is created, lists refresh and the input clears", async () => {
        const service = new PaymentTypeService();
        const create = vi.spyOn(service, "create");

        const result = await addPaymentType(service, "Test Payment Type");

        expect(create).toHaveBeenCalledWith({ label: "Test Payment Type" });
        expect(result).toEqual({ ok: true, success: "Payment type added.", error: null, reactivateCandidate: null, createdId: expect.any(String) });
        expect(sqlite.db!.prepare("SELECT code FROM payment_types WHERE id = ?").get(result.createdId)).toEqual({ code: "TEST_PAYMENT_TYPE" });
        expect(rows()).toHaveLength(17);
        expect(rows()[rows().length - 1]).toEqual({ code: "TEST_PAYMENT_TYPE", label: "Test Payment Type", is_active: 1 });
        expect(refreshes).toBe(1);
        // A fresh load (what the refreshed list shows) includes it, active.
        expect((await new PaymentTypeService().getAll()).find(t => t.code === "TEST_PAYMENT_TYPE")).toMatchObject({ isActive: true });
        expect(newLabelAfter(result, "Test Payment Type")).toBe("");
    });

    it("a duplicate is reported, nothing is created, lists are not refreshed and the input is kept", async () => {
        await addPaymentType(new PaymentTypeService(), "Test Payment Type");
        refreshes = 0;
        vi.spyOn(console, "error").mockImplementation(() => {});

        const result = await addPaymentType(new PaymentTypeService(), "  test   PAYMENT type ");

        expect(result).toMatchObject({ ok: false, success: null, error: 'A payment type "Test Payment Type" already exists.', reactivateCandidate: null });
        expect(rows()).toHaveLength(17);
        expect(refreshes).toBe(0);
        expect(newLabelAfter(result, "  test   PAYMENT type ")).toBe("  test   PAYMENT type ");
    });

    it("an inactive duplicate offers Reactivate; Reactivate restores the same record, refreshes lists and clears the input", async () => {
        const service = new PaymentTypeService();
        await addPaymentType(service, "Test Payment Type");
        const created = (await service.getAll()).find(t => t.code === "TEST_PAYMENT_TYPE")!;
        await togglePaymentTypeActive(service, created);
        vi.spyOn(console, "error").mockImplementation(() => {});

        const attempt = await addPaymentType(service, "test payment type");

        expect(attempt.ok).toBe(false);
        expect(attempt.error).toMatch(/already exists but is inactive/);
        expect(attempt.reactivateCandidate).toMatchObject({ id: created.id, isActive: false });
        refreshes = 0;

        const result = await reactivatePaymentType(service, attempt.reactivateCandidate!);

        expect(result).toMatchObject({ ok: true, success: '"Test Payment Type" activated.' });
        expect(rows().filter(r => r.code === "TEST_PAYMENT_TYPE")).toEqual([{ code: "TEST_PAYMENT_TYPE", label: "Test Payment Type", is_active: 1 }]);
        expect(rows()).toHaveLength(17);
        expect(refreshes).toBe(1);
        expect(newLabelAfter(result, "test payment type")).toBe("");
    });

    it("a database failure is shown and logged, never swallowed", async () => {
        const service = new PaymentTypeService();
        // tauri-plugin-sql rejects with a plain string.
        vi.spyOn(service, "create").mockRejectedValue("error returned from database: (code: 5) database is locked");
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});

        const result = await addPaymentType(service, "Test Payment Type");

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/database is busy/);
        expect(logged).toHaveBeenCalledWith("PAYMENT TYPE ACTION ERROR:", "error returned from database: (code: 5) database is locked");
        expect(refreshes).toBe(0);
        expect(newLabelAfter(result, "Test Payment Type")).toBe("Test Payment Type");
    });
});
