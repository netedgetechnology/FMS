import { DatabaseSync } from "node:sqlite";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { PaymentTypesMigration } from "@/core/database/migrations/044_payment_types";

import {
    PaymentTypeService,
    normalizePaymentTypeLabel,
    paymentTypeCodeFromLabel,
} from "./PaymentTypeService";

// ---------------------------------------------------------------------
// Settings -> Payment Types CRUD against the REAL PaymentTypeRepository
// SQL on an in-memory SQLite database seeded by migration 044
// (SQLiteProvider mocked, as in the transaction service tests).
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

beforeEach(() => {
    const db = new DatabaseSync(":memory:");
    for (const statement of PaymentTypesMigration.sql.split(";").map(s => s.trim()).filter(Boolean)) {
        db.exec(statement);
    }
    sqlite.db = db;
});

const service = () => new PaymentTypeService();
const byCode = async (code: string) =>
    (await service().getAll()).find(type => type.code === code);

describe("PaymentTypeService - load", () => {
    it("loads every seeded type, active and inactive, in master-list order", async () => {
        const types = await service().getAll();

        expect(types.map(type => type.label)).toEqual([
            "UPI", "IMPS", "NEFT", "RTGS", "Cash", "Cheque", "E-Mandate", "Net Banking",
            "Mobile App", "Credit Card", "Debit Card", "Bank Transfer", "Direct Debit",
            "PayPal", "Other", "Credit Card (legacy)",
        ]);
        expect(types.every(type => typeof type.isActive === "boolean")).toBe(true);
    });

    it("PayPal and Other load, active", async () => {
        expect(await byCode("PAYPAL")).toMatchObject({ label: "PayPal", isActive: true });
        expect(await byCode("OTHER")).toMatchObject({ label: "Other", isActive: true });
    });
});

describe("PaymentTypeService - add", () => {
    it("adds Google Pay with a permanent code derived from its name, active, ordered last", async () => {
        const id = await service().create({ label: "  Google   Pay " });

        const types = await service().getAll();
        const added = types.find(type => type.id === id)!;

        expect(added).toMatchObject({ code: "GOOGLE_PAY", label: "Google Pay", isActive: true });
        expect(types[types.length - 1]!.id).toBe(id);
    });

    it("derives codes from names", () => {
        expect(paymentTypeCodeFromLabel("Google Pay")).toBe("GOOGLE_PAY");
        expect(paymentTypeCodeFromLabel("Amazon Pay / Wallet")).toBe("AMAZON_PAY_WALLET");
        expect(paymentTypeCodeFromLabel("  -PhonePe- ")).toBe("PHONEPE");
        expect(normalizePaymentTypeLabel("  a   b ")).toBe("a b");
    });

    it("rejects a blank name or one with no letters/digits", async () => {
        await expect(service().create({ label: "   " })).rejects.toThrow(/letter or number/);
        await expect(service().create({ label: "---" })).rejects.toThrow(/letter or number/);
        expect(await service().getAll()).toHaveLength(16);
    });
});

describe("PaymentTypeService - duplicate prevention", () => {
    it("rejects an existing name regardless of case or spacing", async () => {
        await expect(service().create({ label: "paypal" })).rejects.toThrow('A payment type "PayPal" already exists.');
        await expect(service().create({ label: " NET   banking " })).rejects.toThrow(/"Net Banking" already exists/);
    });

    it("rejects a name whose code would clash with an existing one", async () => {
        await service().create({ label: "Google Pay" });

        await expect(service().create({ label: "Google-Pay" })).rejects.toThrow(/"Google Pay" already exists/);
    });

    it("an inactive duplicate is reported, not silently reactivated or copied", async () => {
        await expect(service().create({ label: "Credit Card (legacy)" })).rejects.toThrow(
            /already exists but is inactive\. Activate it instead/
        );

        expect((await byCode("CARD"))!.isActive).toBe(false);
        expect(await service().getAll()).toHaveLength(16);
    });

    it("rejects renaming to another type's name", async () => {
        const upi = (await byCode("UPI"))!;

        await expect(service().update({ id: upi.id, label: "paypal" })).rejects.toThrow(/"PayPal" already exists/);
        expect((await byCode("UPI"))!.label).toBe("UPI");
    });
});

describe("PaymentTypeService - rename / activate / deactivate", () => {
    it("rename changes only the label; the stored code is permanent", async () => {
        const paypal = (await byCode("PAYPAL"))!;

        await service().update({ id: paypal.id, label: "PayPal (Business)" });

        expect(await byCode("PAYPAL")).toMatchObject({ id: paypal.id, label: "PayPal (Business)", isActive: true });
    });

    it("renaming a type to a new casing of its own name is allowed", async () => {
        const upi = (await byCode("UPI"))!;

        await service().update({ id: upi.id, label: "Upi" });

        expect((await byCode("UPI"))!.label).toBe("Upi");
    });

    it("deactivates and reactivates without changing label or code", async () => {
        const id = await service().create({ label: "Google Pay" });

        await service().update({ id, isActive: false });
        expect(await byCode("GOOGLE_PAY")).toMatchObject({ isActive: false, label: "Google Pay" });

        await service().update({ id, isActive: true });
        expect(await byCode("GOOGLE_PAY")).toMatchObject({ isActive: true, label: "Google Pay" });
    });

    it("a rename never changes the active state, and a toggle never changes the label", async () => {
        const card = (await byCode("CARD"))!;

        await service().update({ id: card.id, label: "Card (old)" });
        expect(await byCode("CARD")).toMatchObject({ label: "Card (old)", isActive: false });
    });

    it("rejects an unknown id or a blank rename", async () => {
        await expect(service().update({ id: "nope", label: "X" })).rejects.toThrow("Payment type not found.");

        const upi = (await byCode("UPI"))!;
        await expect(service().update({ id: upi.id, label: "  " })).rejects.toThrow("Enter a payment type name.");
    });
});
