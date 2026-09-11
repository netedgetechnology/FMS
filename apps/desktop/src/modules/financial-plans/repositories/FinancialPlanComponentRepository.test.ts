import { DatabaseSync } from "node:sqlite";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

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

import { FinancialPlanComponentRepository } from "./FinancialPlanComponentRepository";
import type { FinancialPlanComponent } from "../types";

function schema(): string {
    return `
        CREATE TABLE financial_plan_components (
            id TEXT PRIMARY KEY,
            plan_id TEXT NOT NULL,
            component_type TEXT NOT NULL,
            role TEXT NOT NULL,
            account_id TEXT,
            category_id TEXT,
            investment_id TEXT,
            loan_id TEXT,
            label TEXT,
            target_amount REAL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            is_active INTEGER NOT NULL DEFAULT 1,
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );
    `;
}

function component(
    overrides: Partial<FinancialPlanComponent> = {}
): FinancialPlanComponent {
    return {
        id: "c-1",
        planId: "plan-1",
        componentType: "ACCOUNT",
        role: "ASSET",
        accountId: "acc-1",
        categoryId: null,
        investmentId: null,
        loanId: null,
        label: null,
        targetAmount: null,
        sortOrder: 0,
        isActive: true,
        notes: null,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
        ...overrides,
    };
}

describe("FinancialPlanComponentRepository", () => {
    beforeEach(() => {
        db = new DatabaseSync(":memory:");
        db.exec(schema());
    });

    afterEach(() => {
        db.close();
    });

    it("round-trips every column through create / getById", async () => {
        const repo =
            new FinancialPlanComponentRepository();

        await repo.create(
            component({
                id: "c-loan",
                componentType: "LOAN",
                role: "LIABILITY",
                accountId: null,
                loanId: "loan-9",
                label: "Car loan",
                targetAmount: 250000,
                sortOrder: 3,
                isActive: false,
                notes: "note",
            })
        );

        const read = await repo.getById("c-loan");

        expect(read).toEqual(
            component({
                id: "c-loan",
                componentType: "LOAN",
                role: "LIABILITY",
                accountId: null,
                loanId: "loan-9",
                label: "Car loan",
                targetAmount: 250000,
                sortOrder: 3,
                isActive: false,
                notes: "note",
            })
        );
    });

    it("lists a plan's non-deleted components ordered by sort_order then created_at", async () => {
        const repo =
            new FinancialPlanComponentRepository();

        await repo.create(
            component({ id: "c-b", sortOrder: 2 })
        );
        await repo.create(
            component({ id: "c-a", sortOrder: 1 })
        );
        await repo.create(
            component({
                id: "c-gone",
                sortOrder: 0,
            })
        );
        await repo.softDelete("c-gone");

        const list = await repo.listByPlan("plan-1");

        expect(list.map(c => c.id)).toEqual([
            "c-a",
            "c-b",
        ]);
        expect(await repo.countByPlan("plan-1")).toBe(
            2
        );
    });

    it("update changes only role/label/target/order/active/notes", async () => {
        const repo =
            new FinancialPlanComponentRepository();

        await repo.create(component({ id: "c-1" }));

        await repo.update({
            id: "c-1",
            role: "CONTRIBUTION",
            label: "Renamed",
            targetAmount: 500,
            sortOrder: 7,
            isActive: false,
            notes: "changed",
        });

        const read = await repo.getById("c-1");

        expect(read).toMatchObject({
            role: "CONTRIBUTION",
            label: "Renamed",
            targetAmount: 500,
            sortOrder: 7,
            isActive: false,
            notes: "changed",
            componentType: "ACCOUNT",
            accountId: "acc-1",
        });
    });

    it("softDeleteByPlan removes every component of one plan only", async () => {
        const repo =
            new FinancialPlanComponentRepository();

        await repo.create(
            component({ id: "c-1", planId: "plan-1" })
        );
        await repo.create(
            component({ id: "c-2", planId: "plan-1" })
        );
        await repo.create(
            component({ id: "c-3", planId: "plan-2" })
        );

        await repo.softDeleteByPlan("plan-1");

        expect(
            await repo.listByPlan("plan-1")
        ).toEqual([]);
        expect(
            (await repo.listByPlan("plan-2")).map(
                c => c.id
            )
        ).toEqual(["c-3"]);
    });

    it("updateSortOrder rewrites a single component's position", async () => {
        const repo =
            new FinancialPlanComponentRepository();

        await repo.create(component({ id: "c-1" }));
        await repo.updateSortOrder("c-1", 5);

        expect(
            (await repo.getById("c-1"))?.sortOrder
        ).toBe(5);
    });
});
