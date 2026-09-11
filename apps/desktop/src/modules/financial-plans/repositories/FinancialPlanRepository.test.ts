import { DatabaseSync } from "node:sqlite";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

// The repository extends the Repository base class, which talks to a
// live Tauri SQLite connection. Replace the singleton provider with a
// node:sqlite-backed fake so the repository's real SQL runs end to end.

let db: DatabaseSync;

const fakeProvider = {
    async execute(sql: string, binds: unknown[] = []) {
        db.prepare(sql).run(...(binds as never[]));
    },
    async select(sql: string, binds: unknown[] = []) {
        return db
            .prepare(sql)
            .all(...(binds as never[]));
    },
    async beginTransaction() {
        db.exec("BEGIN");
    },
    async commit() {
        db.exec("COMMIT");
    },
    async rollback() {
        db.exec("ROLLBACK");
    },
};

vi.mock(
    "@/core/database/engine/SQLiteProvider",
    () => ({
        SQLiteProvider: {
            getInstance: () => fakeProvider,
        },
    })
);

import { FinancialPlanRepository } from "./FinancialPlanRepository";
import type { FinancialPlan } from "../types";

function schema(): string {
    return `
        CREATE TABLE financial_plans (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            plan_type TEXT NOT NULL,
            plan_category TEXT,
            plan_subcategory TEXT,
            period_type TEXT NOT NULL DEFAULT 'MONTHLY',
            start_date TEXT NOT NULL,
            end_date TEXT,
            currency_id TEXT NOT NULL,
            target_amount REAL,
            goal_id TEXT,
            notes TEXT,
            status TEXT NOT NULL DEFAULT 'ACTIVE',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );
    `;
}

function plan(
    overrides: Partial<FinancialPlan> = {}
): FinancialPlan {
    return {
        id: "plan-1",
        name: "Retirement",
        planType: "ACCUMULATION",
        planCategory: "LONG_TERM_WEALTH",
        planSubcategory: "RETIREMENT",
        periodType: "MONTHLY",
        startDate: "2026-09-01",
        endDate: null,
        currencyId: "INR",
        targetAmount: 5000000,
        goalId: null,
        notes: null,
        status: "ACTIVE",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
        ...overrides,
    };
}

describe("FinancialPlanRepository", () => {
    beforeEach(() => {
        db = new DatabaseSync(":memory:");
        db.exec(schema());
    });

    afterEach(() => {
        db.close();
    });

    it("round-trips period_type and goal_id through create / getById", async () => {
        const repo = new FinancialPlanRepository();

        await repo.create(
            plan({
                id: "p-1",
                periodType: "QUARTERLY",
                goalId: "goal-42",
                endDate: "2027-01-01",
            })
        );

        const read = await repo.getById("p-1");

        expect(read).toMatchObject({
            id: "p-1",
            periodType: "QUARTERLY",
            goalId: "goal-42",
            endDate: "2027-01-01",
            planType: "ACCUMULATION",
        });
    });

    it("getAll returns non-deleted plans with camelCase columns", async () => {
        const repo = new FinancialPlanRepository();

        await repo.create(plan({ id: "p-1" }));
        await repo.create(
            plan({ id: "p-2", name: "Debt" })
        );
        await repo.delete("p-2");

        const all = await repo.getAll();

        expect(all.map(p => p.id)).toEqual(["p-1"]);
        expect(all[0].periodType).toBe("MONTHLY");
        expect(all[0].goalId).toBeNull();
    });

    it("update persists period_type and goal_id changes", async () => {
        const repo = new FinancialPlanRepository();

        await repo.create(plan({ id: "p-1" }));

        await repo.update({
            id: "p-1",
            name: "Retirement",
            planType: "PORTFOLIO_GROWTH",
            planCategory: "LONG_TERM_WEALTH",
            planSubcategory: "INVESTMENT_GROWTH",
            periodType: "YEARLY",
            startDate: "2026-09-01",
            endDate: null,
            currencyId: "INR",
            targetAmount: 9000000,
            goalId: "goal-7",
            notes: null,
            status: "ACTIVE",
        });

        const read = await repo.getById("p-1");

        expect(read).toMatchObject({
            planType: "PORTFOLIO_GROWTH",
            periodType: "YEARLY",
            goalId: "goal-7",
            targetAmount: 9000000,
        });
    });
});
