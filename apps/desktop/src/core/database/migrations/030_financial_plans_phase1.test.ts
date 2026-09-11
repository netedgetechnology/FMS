import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { FinancialPlansPhase1Migration } from "./030_financial_plans_phase1";

/** Replicates MigrationEngine's statement splitting. */
function statements(): string[] {
    return FinancialPlansPhase1Migration.sql
        .split(";")
        .map(statement => statement.trim())
        .filter(statement => statement.length > 0)
        .filter(
            statement =>
                !/^PRAGMA\s+foreign_keys\s*=\s*ON\s*$/i.test(
                    statement
                )
        );
}

function runMigration(db: DatabaseSync): void {
    for (const statement of statements()) {
        db.exec(statement);
    }
}

/** Only the data transforms (skips the two ALTER TABLE ... ADD COLUMN). */
function runDataTransforms(db: DatabaseSync): void {
    for (const statement of statements()) {
        if (/^ALTER TABLE/i.test(statement)) {
            continue;
        }
        db.exec(statement);
    }
}

/** The pre-migration-030 financial_plans shape. */
function createDb(): DatabaseSync {
    const db = new DatabaseSync(":memory:");

    db.exec(`
        CREATE TABLE goals (
            id TEXT PRIMARY KEY
        );

        CREATE TABLE financial_plans (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            plan_type TEXT NOT NULL,
            plan_category TEXT,
            plan_subcategory TEXT,
            start_date TEXT NOT NULL,
            end_date TEXT,
            currency_id TEXT NOT NULL,
            target_amount REAL,
            notes TEXT,
            status TEXT NOT NULL DEFAULT 'ACTIVE',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            deleted_at TEXT
        );
    `);

    return db;
}

interface SeedPlan {
    id: string;
    name: string;
    planType: string;
    planCategory: string | null;
    planSubcategory: string | null;
    startDate?: string;
    endDate?: string | null;
    currencyId?: string;
    targetAmount?: number | null;
    status?: string;
    deletedAt?: string | null;
}

function seed(db: DatabaseSync, plan: SeedPlan): void {
    db.prepare(
        `INSERT INTO financial_plans
         (id, name, plan_type, plan_category, plan_subcategory, start_date, end_date, currency_id, target_amount, notes, status, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'note', ?, '2026-08-20T00:00:00Z', '2026-08-20 00:00:00', ?)`
    ).run(
        plan.id,
        plan.name,
        plan.planType,
        plan.planCategory,
        plan.planSubcategory,
        plan.startDate ?? "2026-08-20",
        plan.endDate ?? null,
        plan.currencyId ?? "INR",
        plan.targetAmount ?? null,
        plan.status ?? "ACTIVE",
        plan.deletedAt ?? null
    );
}

function row(db: DatabaseSync, id: string) {
    return db
        .prepare(
            `SELECT * FROM financial_plans WHERE id = ?`
        )
        .get(id) as Record<string, unknown>;
}

// The two live and two soft-deleted rows that currently exist, plus
// synthetic rows for the end_date / blank-taxonomy branches.
function seedRealisticData(db: DatabaseSync): void {
    seed(db, {
        id: "emergency-fund",
        name: "Emergency Fund",
        planType: "RETIREMENT",
        planCategory: "LONG_TERM_WEALTH",
        planSubcategory: "RETIREMENT",
        targetAmount: 3000001,
    });
    seed(db, {
        id: "debt-management",
        name: "Debt Management1",
        planType: "DEBT_REDUCTION",
        planCategory: "DEBT_LIABILITIES",
        planSubcategory: "DEBT_REDUCTION",
        targetAmount: 1000000,
    });
    seed(db, {
        id: "test-fund",
        name: "Test Fund",
        planType: "ANNUAL",
        planCategory: "CORE_PERSONAL_FINANCE",
        planSubcategory: "ANNUAL_EXPENSES",
        targetAmount: 100000,
        deletedAt: "2026-08-20 13:28:42",
    });
    seed(db, {
        id: "business-expansion",
        name: "Business Expansion",
        planType: "BUSINESS_EXPANSION",
        planCategory: "BUSINESS_PROFESSIONAL",
        planSubcategory: "BUSINESS_EXPANSION",
        currencyId: "USD",
        targetAmount: 3030000,
        deletedAt: "2026-08-20 17:47:23",
    });
    seed(db, {
        id: "bounded-plan",
        name: "House Down Payment",
        planType: "HOME_PURCHASE",
        planCategory: "CORE_PERSONAL_FINANCE",
        planSubcategory: "HOME_PURCHASE",
        endDate: "2027-06-01",
        targetAmount: 5000000,
    });
    seed(db, {
        id: "blank-taxonomy",
        name: "Legacy Blank",
        planType: "WEALTH_BUILDING",
        planCategory: null,
        planSubcategory: "  ",
    });
}

describe("migration 030 - Financial Plans Phase 1", () => {
    it("is registered with version 30", () => {
        expect(
            FinancialPlansPhase1Migration.version
        ).toBe(30);
    });

    it("adds period_type and goal_id without a table rebuild and preserves every row and soft-deleted state", () => {
        const db = createDb();
        seedRealisticData(db);

        const before = db
            .prepare(
                `SELECT id, name, start_date, currency_id, target_amount, status, deleted_at FROM financial_plans ORDER BY id`
            )
            .all();

        runMigration(db);

        const after = db
            .prepare(
                `SELECT id, name, start_date, currency_id, target_amount, status, deleted_at FROM financial_plans ORDER BY id`
            )
            .all();

        expect(after).toEqual(before);

        // soft-deleted rows keep their deleted_at
        expect(row(db, "test-fund").deleted_at).toBe(
            "2026-08-20 13:28:42"
        );
        expect(
            row(db, "business-expansion").deleted_at
        ).toBe("2026-08-20 17:47:23");

        // new columns exist, goal_id is NULL for every row
        for (const id of [
            "emergency-fund",
            "debt-management",
            "test-fund",
            "business-expansion",
            "bounded-plan",
            "blank-taxonomy",
        ]) {
            expect(row(db, id).goal_id).toBeNull();
        }
    });

    it("remaps plan_type to the 5 strategy archetypes with the safest defensible mapping", () => {
        const db = createDb();
        seedRealisticData(db);
        runMigration(db);

        expect(row(db, "emergency-fund").plan_type).toBe(
            "ACCUMULATION"
        );
        expect(row(db, "debt-management").plan_type).toBe(
            "DEBT_PAYOFF"
        );
        expect(row(db, "test-fund").plan_type).toBe(
            "EXPENSE_PLAN"
        );
        // business expansion: nothing in the data indicates a recurring
        // surplus target -> falls through to ACCUMULATION
        expect(
            row(db, "business-expansion").plan_type
        ).toBe("ACCUMULATION");
        expect(row(db, "bounded-plan").plan_type).toBe(
            "ACCUMULATION"
        );
        expect(row(db, "blank-taxonomy").plan_type).toBe(
            "ACCUMULATION"
        );
    });

    it("maps investment / cash-flow subcategories to their archetypes", () => {
        const db = createDb();
        seed(db, {
            id: "invest",
            name: "Invest",
            planType: "INVESTMENT_GROWTH",
            planCategory: "LONG_TERM_WEALTH",
            planSubcategory: "INVESTMENT_GROWTH",
        });
        seed(db, {
            id: "working-capital",
            name: "WC",
            planType: "WORKING_CAPITAL",
            planCategory: "BUSINESS_PROFESSIONAL",
            planSubcategory: "WORKING_CAPITAL",
        });
        runMigration(db);

        expect(row(db, "invest").plan_type).toBe(
            "PORTFOLIO_GROWTH"
        );
        expect(
            row(db, "working-capital").plan_type
        ).toBe("CASHFLOW_TARGET");
    });

    it("sets period_type: MONTHLY by default, ONE_TIME when an end_date is present", () => {
        const db = createDb();
        seedRealisticData(db);
        runMigration(db);

        for (const id of [
            "emergency-fund",
            "debt-management",
            "test-fund",
            "business-expansion",
            "blank-taxonomy",
        ]) {
            expect(row(db, id).period_type).toBe(
                "MONTHLY"
            );
        }

        expect(row(db, "bounded-plan").period_type).toBe(
            "ONE_TIME"
        );
    });

    it("never changes a user-set taxonomy value, and only fills NULL / blank taxonomy", () => {
        const db = createDb();
        seedRealisticData(db);
        runMigration(db);

        // untouched
        expect(
            row(db, "emergency-fund").plan_category
        ).toBe("LONG_TERM_WEALTH");
        expect(
            row(db, "emergency-fund").plan_subcategory
        ).toBe("RETIREMENT");

        // filled
        expect(
            row(db, "blank-taxonomy").plan_category
        ).toBe("CORE_PERSONAL_FINANCE");
        expect(
            row(db, "blank-taxonomy").plan_subcategory
        ).toBe("SAVINGS");
    });

    it("creates the new indexes", () => {
        const db = createDb();
        runMigration(db);

        const indexes = db
            .prepare(
                `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'financial_plans'`
            )
            .all()
            .map(r => (r as { name: string }).name);

        expect(indexes).toContain(
            "idx_financial_plans_status"
        );
        expect(indexes).toContain(
            "idx_financial_plans_goal"
        );
        expect(indexes).toContain(
            "idx_financial_plans_dates"
        );
    });

    it("data transforms are idempotent - re-running them changes nothing", () => {
        const db = createDb();
        seedRealisticData(db);
        runMigration(db);

        const first = db
            .prepare(
                `SELECT id, plan_type, period_type, plan_category, plan_subcategory FROM financial_plans ORDER BY id`
            )
            .all();

        runDataTransforms(db);

        const second = db
            .prepare(
                `SELECT id, plan_type, period_type, plan_category, plan_subcategory FROM financial_plans ORDER BY id`
            )
            .all();

        expect(second).toEqual(first);
    });
});
