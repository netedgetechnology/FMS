import { DatabaseSync } from "node:sqlite";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DroplineDrawingPowerScheduleMigration } from "@/core/database/migrations/053_dropline_drawing_power_schedule";
import { migrations } from "@/core/database/migrations/registry";

import { LoanRepository } from "../repositories/LoanRepository";
import { buildOverdraftViewModel } from "../components/ViewLoanDialog";
import { overdraftRequestFromValues, type OverdraftFormValues } from "../validation";
import { LoanService } from "./LoanService";
import { OverdraftService } from "./OverdraftService";

// ---------------------------------------------------------------------
// Editing a Dropline Overdraft's drawing-power steps after it is created:
// the real LoanService, OverdraftService and repositories against an
// in-memory database built from every registered migration PLUS 053 -
// applied here in memory only, never to a file, so this says nothing
// about the live database (where 053 is still unapplied). Only the Tauri
// command is replaced; its SQL and refusals are tested in Rust
// (src-tauri/src/overdraft_update.rs).
// ---------------------------------------------------------------------

const sqlite = { db: null as DatabaseSync | null };
const feature = vi.hoisted(() => ({ enabled: true }));

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

// "Is 053 registered?" - switchable, so both sides of the gate are tested.
vi.mock("../setup/droplineSchedule", async importOriginal => {
    const actual = await importOriginal<typeof import("../setup/droplineSchedule")>();

    return {
        ...actual,
        get DROPLINE_OVERDRAFT_ENABLED() {
            return feature.enabled;
        },
    };
});

const invoke = vi.fn(async (command: string, args: { request: Record<string, any> }) => {
    const request = args.request;

    if (command !== "update_overdraft_atomic") throw new Error(`Unexpected command ${command}`);

    const db = sqlite.db!;
    db.prepare("UPDATE loans SET name = ?, credit_limit = ?, opening_used = ?, opening_used_as_of = ? WHERE id = ?")
        .run(request.name, request.creditLimit, request.openingUsed, request.openingUsedAsOf, request.loanId);
    if (request.updateDrawingPower) {
        db.prepare("UPDATE loans SET drawing_power = ? WHERE id = ?").run(request.drawingPower, request.loanId);
    }
    if (request.updateDrawingPowerSchedule) {
        db.prepare("DELETE FROM loan_drawing_power_schedule WHERE loan_id = ?").run(request.loanId);
        for (const step of request.drawingPowerSchedule) {
            db.prepare("INSERT INTO loan_drawing_power_schedule (id, loan_id, effective_date, drawing_power) VALUES (?, ?, ?, ?)")
                .run(step.id, request.loanId, step.effectiveDate, step.drawingPower);
        }
    }
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...(args as [string, never])) }));

function run(db: DatabaseSync, sql: string): void {
    for (const statement of sql.split(";").map(part => part.trim()).filter(Boolean)) {
        if (!/^PRAGMA\s+foreign_keys\s*=\s*ON\s*$/i.test(statement)) db.exec(statement);
    }
}

// Fills every NOT NULL column without a default, so a test states only what it is about.
function insert(table: string, values: Record<string, unknown>): void {
    const row: Record<string, unknown> = { ...values };
    for (const column of sqlite.db!.prepare(`PRAGMA table_info(${table})`).all() as {
        name: string; type: string; notnull: number; dflt_value: unknown;
    }[]) {
        if (column.name in row || !column.notnull || column.dflt_value !== null) continue;
        row[column.name] = /INT|REAL|NUM/i.test(column.type) ? 0 : `${column.name}-x`;
    }
    const columns = Object.keys(row);
    sqlite.db!.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
        .run(...(Object.values(row) as never[]));
}

const LOAN = "od-dropline";
const BANK = "acct-bank";
// Dated far enough either side of any real "today" that the step in force
// is always the 2020 one before the edit.
const PAST = "2020-01-01";
const FUTURE = "2099-01-01";

function values(overrides: Partial<OverdraftFormValues> = {}): OverdraftFormValues {
    return {
        name: "Dropline",
        lenderInstitutionName: "",
        accountIds: [BANK],
        currencyId: "cur-inr",
        creditLimit: 1000,
        openingUsed: 600,
        openingUsedAsOf: "2019-12-31",
        drawingPower: null,
        startDate: "2019-12-31",
        interestRate: 10,
        status: "ACTIVE",
        notes: "",
        ...overrides,
    };
}

async function loan() {
    return (await new LoanRepository().getById(LOAN))!;
}

async function edit(overrides: Partial<OverdraftFormValues>, drawingPowerSchedule?: { effectiveDate: string; drawingPower: number }[]) {
    await new LoanService().update({
        ...overdraftRequestFromValues(values(overrides)),
        id: LOAN,
        ...(drawingPowerSchedule ? { drawingPowerSchedule } : {}),
    });
}

const lastRequest = () => invoke.mock.calls[invoke.mock.calls.length - 1]![1].request;

beforeEach(() => {
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
    for (const migration of migrations) run(db, migration.sql);
    run(db, DroplineDrawingPowerScheduleMigration.sql);
    sqlite.db = db;

    feature.enabled = true;
    invoke.mockClear();

    insert("accounts", { id: BANK, name: "Current Account", account_type: "CURRENT", opening_balance: 0 });
    insert("accounts", { id: "acct-loan", name: "Dropline", account_type: "LOAN", opening_balance: 0 });
    insert("loans", {
        id: LOAN, name: "Dropline", loan_kind: "OVERDRAFT", loan_type: "Dropline Overdraft", account_id: BANK, loan_account_id: "acct-loan",
        currency_id: "cur-inr", principal_amount: 0, interest_rate: 10, interest_type: "REDUCING", start_date: "2019-12-31",
        status: "ACTIVE", credit_limit: 1000, opening_used: 600, opening_used_as_of: "2019-12-31",
    });
    insert("overdraft_accounts", { id: "oa-1", loan_id: LOAN, account_id: BANK });
    insert("loan_drawing_power_schedule", { id: "s1", loan_id: LOAN, effective_date: PAST, drawing_power: 950 });
    insert("loan_drawing_power_schedule", { id: "s2", loan_id: LOAN, effective_date: FUTURE, drawing_power: 500 });
});

describe("editing a Dropline Overdraft's drawing-power steps", () => {
    it("reads the saved steps, and today's step drives Available", async () => {
        const saved = await loan();

        expect(await new OverdraftService().getDrawingPowerSchedule(saved)).toEqual([
            { effectiveDate: PAST, drawingPower: 950 },
            { effectiveDate: FUTURE, drawingPower: 500 },
        ]);
        expect(await new OverdraftService().getPosition(saved)).toMatchObject({ drawingPower: 950, used: 600, available: 350 });
    });

    it("saves the steps whole, with the terms, in one command - and Available follows the new step in force", async () => {
        await edit({ name: "Dropline renamed" }, [
            { effectiveDate: FUTURE, drawingPower: 400 },
            { effectiveDate: PAST, drawingPower: 900 },
            { effectiveDate: "2021-01-01", drawingPower: 700 },
        ]);

        expect(invoke).toHaveBeenCalledTimes(1);
        const request = lastRequest();
        expect(request).toMatchObject({ name: "Dropline renamed", updateDrawingPowerSchedule: true, updateDrawingPower: false });
        expect(request.drawingPowerSchedule.map((step: any) => [step.effectiveDate, step.drawingPower])).toEqual([
            [FUTURE, 400],
            [PAST, 900],
            ["2021-01-01", 700],
        ]);
        expect(request.drawingPowerSchedule.every((step: any) => typeof step.id === "string" && step.id.length > 0)).toBe(true);

        const position = await new OverdraftService().getPosition(await loan());
        expect(position).toMatchObject({ drawingPower: 700, used: 600, available: 100, status: "PARTLY_USED" });
    });

    it("flags Over Drawing Power when a lowered step falls below what is already used", async () => {
        await edit({}, [{ effectiveDate: PAST, drawingPower: 500 }]);

        const position = await new OverdraftService().getPosition(await loan());
        expect(position).toMatchObject({ drawingPower: 500, available: 0, overLimitBy: 0, overDrawingPowerBy: 100, status: "OVER_DRAWING_POWER" });
    });

    it.each([
        ["no step", [], /at least one/],
        ["two steps on one date", [{ effectiveDate: PAST, drawingPower: 1 }, { effectiveDate: PAST, drawingPower: 2 }], /same date/],
        ["a step above the limit", [{ effectiveDate: PAST, drawingPower: 1001 }], /more than the sanctioned limit/],
        ["a missing date", [{ effectiveDate: "", drawingPower: 1 }], /date it takes effect/],
    ])("refuses %s before anything is sent", async (_label, steps, message) => {
        await expect(edit({}, steps)).rejects.toThrow(message);
        expect(invoke).not.toHaveBeenCalled();
    });

    it("checks the steps against the limit being saved, not the old one", async () => {
        await expect(edit({ creditLimit: 900 }, [{ effectiveDate: PAST, drawingPower: 950 }])).rejects.toThrow(/more than the sanctioned limit/);
        expect(invoke).not.toHaveBeenCalled();
    });

    it("leaves the steps alone when an edit does not send them, and a plain Overdraft edit is unchanged", async () => {
        await edit({ name: "Only the name", drawingPower: null });

        const request = lastRequest();
        expect(request).not.toHaveProperty("updateDrawingPowerSchedule");
        expect(request).toMatchObject({ updateDrawingPower: true, drawingPower: null });
        expect(await new OverdraftService().getDrawingPowerSchedule(await loan())).toHaveLength(2);
    });

    it("shows the steps in the View dialog, the one in force today marked", async () => {
        const saved = await loan();
        const service = new OverdraftService();
        const model = buildOverdraftViewModel(saved, await service.getPosition(saved), {
            lenderName: "",
            linkedAccountNames: ["Current Account"],
            currencyLabel: "INR",
            formatMoney: value => value.toFixed(2),
            formatDate: value => value,
            drawingPowerSchedule: await service.getDrawingPowerSchedule(saved),
        });

        expect(model.facilityLabel).toBe("Dropline Overdraft");
        expect(model.drawingPowerSchedule).toEqual([
            { date: PAST, amount: "950.00", inForce: true, upcoming: false },
            { date: FUTURE, amount: "500.00", inForce: false, upcoming: true },
        ]);
        expect(model.details).toContainEqual({ label: "Drawing Power Today", value: "950.00" });
    });
});

describe("while migration 053 is not registered", () => {
    it("refuses step edits, never queries the table, and plain edits still work", async () => {
        feature.enabled = false;
        const saved = await loan();

        await expect(edit({}, [{ effectiveDate: PAST, drawingPower: 900 }])).rejects.toThrow(/database update 053/);
        expect(invoke).not.toHaveBeenCalled();

        expect(await new OverdraftService().getDrawingPowerSchedule(saved)).toEqual([]);

        await edit({ name: "Plain edit" });
        expect(lastRequest()).not.toHaveProperty("updateDrawingPowerSchedule");
    });
});
