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

import { GoalInvestmentLinkRepository } from "./GoalInvestmentLinkRepository";

function schema(): string {
    return `
        CREATE TABLE goal_investment_links (
            id TEXT PRIMARY KEY,
            goal_id TEXT NOT NULL,
            investment_id TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            deleted_at TEXT
        );
    `;
}

describe("GoalInvestmentLinkRepository", () => {
    beforeEach(() => {
        db = new DatabaseSync(":memory:");
        db.exec(schema());
    });

    afterEach(() => {
        db.close();
    });

    it("creates a link defaulting isActive to true", async () => {
        const repo =
            new GoalInvestmentLinkRepository();

        await repo.create({
            id: "link-1",
            goalId: "goal-1",
            investmentId: "inv-1",
        });

        const list = await repo.listByGoal("goal-1");

        expect(list).toEqual([
            expect.objectContaining({
                id: "link-1",
                goalId: "goal-1",
                investmentId: "inv-1",
                isActive: true,
            }),
        ]);
    });

    it("lists multiple links for the same goal, ordered by created_at", async () => {
        const repo =
            new GoalInvestmentLinkRepository();

        await repo.create({
            id: "link-1",
            goalId: "goal-1",
            investmentId: "inv-1",
        });
        await repo.create({
            id: "link-2",
            goalId: "goal-1",
            investmentId: "inv-2",
        });

        const list = await repo.listByGoal("goal-1");

        expect(list.map(l => l.investmentId)).toEqual([
            "inv-1",
            "inv-2",
        ]);
    });

    it("scopes listByGoal to only that goal's links", async () => {
        const repo =
            new GoalInvestmentLinkRepository();

        await repo.create({
            id: "link-1",
            goalId: "goal-1",
            investmentId: "inv-1",
        });
        await repo.create({
            id: "link-2",
            goalId: "goal-2",
            investmentId: "inv-2",
        });

        const list = await repo.listByGoal("goal-1");

        expect(list.map(l => l.id)).toEqual([
            "link-1",
        ]);
    });

    it("listByGoals batches multiple goal ids and returns [] for an empty list", async () => {
        const repo =
            new GoalInvestmentLinkRepository();

        await repo.create({
            id: "link-1",
            goalId: "goal-1",
            investmentId: "inv-1",
        });
        await repo.create({
            id: "link-2",
            goalId: "goal-2",
            investmentId: "inv-2",
        });
        await repo.create({
            id: "link-3",
            goalId: "goal-3",
            investmentId: "inv-3",
        });

        const list = await repo.listByGoals([
            "goal-1",
            "goal-2",
        ]);

        expect(
            list.map(l => l.id).sort()
        ).toEqual(["link-1", "link-2"]);

        expect(
            await repo.listByGoals([])
        ).toEqual([]);
    });

    it("softDelete excludes a link from listByGoal", async () => {
        const repo =
            new GoalInvestmentLinkRepository();

        await repo.create({
            id: "link-1",
            goalId: "goal-1",
            investmentId: "inv-1",
        });

        await repo.softDelete("link-1");

        expect(
            await repo.listByGoal("goal-1")
        ).toEqual([]);
    });

    it("softDeleteByGoal removes every link for that goal only", async () => {
        const repo =
            new GoalInvestmentLinkRepository();

        await repo.create({
            id: "link-1",
            goalId: "goal-1",
            investmentId: "inv-1",
        });
        await repo.create({
            id: "link-2",
            goalId: "goal-1",
            investmentId: "inv-2",
        });
        await repo.create({
            id: "link-3",
            goalId: "goal-2",
            investmentId: "inv-3",
        });

        await repo.softDeleteByGoal("goal-1");

        expect(
            await repo.listByGoal("goal-1")
        ).toEqual([]);
        expect(
            await repo.listByGoal("goal-2")
        ).toHaveLength(1);
    });
});
