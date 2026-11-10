import { DatabaseSync } from "node:sqlite";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { migrations } from "@/core/database/migrations/registry";

import { CategoryRepository } from "../repositories/CategoryRepository";
import { CategoryService, transferDirectionFor } from "./CategoryService";

// ---------------------------------------------------------------------
// A Transfer category's configured direction (categories.transfer_direction,
// migration 049): saved from Add / Edit Category, read back on every
// category read, kept when an update doesn't send it, and always NULL for
// an Income / Expense category. Runs CategoryRepository's real SQL
// against an in-memory database built from every app migration.
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
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });

    for (const migration of migrations) {
        for (const statement of migration.sql.split(";").map(part => part.trim()).filter(Boolean)) {
            if (!/^PRAGMA\s+foreign_keys\s*=\s*ON\s*$/i.test(statement)) {
                db.exec(statement);
            }
        }
    }

    sqlite.db = db;
});

async function read(id: string) {
    return (await new CategoryRepository().getById(id))!;
}

function update(id: string, overrides: Partial<Parameters<CategoryService["update"]>[0]>) {
    return new CategoryService().update({
        id, name: "Loan Principal Repayment", categoryType: "TRANSFER", isActive: true, ...overrides,
    });
}

describe("category transfer direction", () => {
    it("is saved on create and read back (In / Out / either way)", async () => {
        const service = new CategoryService();
        const inId = await service.create({ name: "Drawdown", categoryType: "TRANSFER", transferDirection: "IN", financeScope: "BOTH" });
        const outId = await service.create({ name: "Repayment", categoryType: "TRANSFER", transferDirection: "OUT", financeScope: "BOTH" });
        const eitherId = await service.create({ name: "Bank Transfer", categoryType: "TRANSFER", transferDirection: null, financeScope: "BOTH" });

        expect((await read(inId)).transferDirection).toBe("IN");
        expect((await read(outId)).transferDirection).toBe("OUT");
        expect((await read(eitherId)).transferDirection).toBeNull();
        expect((await new CategoryRepository().getAll()).map(c => c.transferDirection).sort()).toEqual(["IN", "OUT", null].sort());
    });

    it("is never stored for an Income / Expense category", async () => {
        const id = await new CategoryService().create({ name: "Interest", categoryType: "EXPENSE", transferDirection: "OUT", financeScope: "BOTH" });

        expect((await read(id)).transferDirection).toBeNull();
    });

    it("an update sets, changes or clears it; one that doesn't send it keeps it", async () => {
        const id = await new CategoryService().create({ name: "Repayment", categoryType: "TRANSFER", financeScope: "BOTH" });

        await update(id, { transferDirection: "OUT" });
        expect((await read(id)).transferDirection).toBe("OUT");

        await update(id, { description: "Principal paid to the lender" });
        expect((await read(id)).transferDirection).toBe("OUT");

        await update(id, { transferDirection: null });
        expect((await read(id)).transferDirection).toBeNull();
    });

    it("changing the category to Income / Expense clears it", async () => {
        const id = await new CategoryService().create({ name: "Repayment", categoryType: "TRANSFER", transferDirection: "OUT", financeScope: "BOTH" });

        await update(id, { categoryType: "EXPENSE" });

        expect((await read(id)).transferDirection).toBeNull();
    });

    it("transferDirectionFor normalises the request", () => {
        expect(transferDirectionFor("TRANSFER", "IN")).toBe("IN");
        expect(transferDirectionFor("TRANSFER", null)).toBeNull();
        expect(transferDirectionFor("TRANSFER", undefined)).toBeUndefined();
        expect(transferDirectionFor("INCOME", "IN")).toBeNull();
    });
});
