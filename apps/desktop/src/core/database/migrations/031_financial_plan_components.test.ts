import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { FinancialPlanComponentsMigration } from "./031_financial_plan_components";
import { FinancialPlansPhase1Migration } from "./030_financial_plans_phase1";

/** Replicates MigrationEngine's statement splitting. */
function statements(sql: string): string[] {
    return sql
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

function run(db: DatabaseSync, sql: string): void {
    for (const statement of statements(sql)) {
        db.exec(statement);
    }
}

/** A DB carrying financial_plans as it stands after migration 030. */
function createDb(): DatabaseSync {
    const db = new DatabaseSync(":memory:");

    db.exec(`
        CREATE TABLE goals (id TEXT PRIMARY KEY);
        CREATE TABLE accounts (id TEXT PRIMARY KEY);
        CREATE TABLE categories (id TEXT PRIMARY KEY);
        CREATE TABLE investments (id TEXT PRIMARY KEY);
        CREATE TABLE loans (id TEXT PRIMARY KEY);

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

    run(db, FinancialPlansPhase1Migration.sql);

    db.prepare(
        `INSERT INTO financial_plans
         (id, name, plan_type, plan_category, plan_subcategory, start_date, currency_id, target_amount, status)
         VALUES ('plan-1', 'Emergency Fund', 'ACCUMULATION', 'CORE_PERSONAL_FINANCE', 'SAVINGS', '2026-01-01', 'INR', 1000000, 'ACTIVE')`
    ).run();

    db.exec(`INSERT INTO accounts (id) VALUES ('acc-1')`);

    return db;
}

function columns(
    db: DatabaseSync
): Record<string, { notnull: number; dflt: unknown }> {
    const rows = db
        .prepare(
            `PRAGMA table_info(financial_plan_components)`
        )
        .all() as Array<{
        name: string;
        notnull: number;
        dflt_value: unknown;
    }>;

    return Object.fromEntries(
        rows.map(row => [
            row.name,
            {
                notnull: row.notnull,
                dflt: row.dflt_value,
            },
        ])
    );
}

describe("migration 031 - Financial Plan Components", () => {
    it("is registered with version 31", () => {
        expect(
            FinancialPlanComponentsMigration.version
        ).toBe(31);
    });

    it("creates financial_plan_components with the expected shape", () => {
        const db = createDb();
        run(db, FinancialPlanComponentsMigration.sql);

        const cols = columns(db);

        expect(Object.keys(cols).sort()).toEqual(
            [
                "account_id",
                "category_id",
                "component_type",
                "created_at",
                "deleted_at",
                "id",
                "investment_id",
                "is_active",
                "label",
                "loan_id",
                "notes",
                "plan_id",
                "role",
                "sort_order",
                "target_amount",
                "updated_at",
            ].sort()
        );

        expect(cols.plan_id.notnull).toBe(1);
        expect(cols.component_type.notnull).toBe(1);
        expect(cols.role.notnull).toBe(1);
        expect(cols.account_id.notnull).toBe(0);
        expect(cols.category_id.notnull).toBe(0);
        expect(cols.investment_id.notnull).toBe(0);
        expect(cols.loan_id.notnull).toBe(0);
        expect(cols.target_amount.notnull).toBe(0);
        expect(cols.is_active.notnull).toBe(1);
        expect(cols.sort_order.notnull).toBe(1);

        db.close();
    });

    it("has no GOAL foreign key (goal link stays on financial_plans)", () => {
        const db = createDb();
        run(db, FinancialPlanComponentsMigration.sql);

        const fks = db
            .prepare(
                `PRAGMA foreign_key_list(financial_plan_components)`
            )
            .all() as Array<{ table: string }>;

        const tables = fks
            .map(fk => fk.table)
            .sort();

        expect(tables).toEqual([
            "accounts",
            "categories",
            "financial_plans",
            "investments",
            "loans",
        ]);

        db.close();
    });

    it("creates the plan and source indexes", () => {
        const db = createDb();
        run(db, FinancialPlanComponentsMigration.sql);

        const indexes = db
            .prepare(
                `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'financial_plan_components'`
            )
            .all()
            .map(r => (r as { name: string }).name);

        for (const name of [
            "idx_financial_plan_components_plan",
            "idx_financial_plan_components_account",
            "idx_financial_plan_components_category",
            "idx_financial_plan_components_investment",
            "idx_financial_plan_components_loan",
        ]) {
            expect(indexes).toContain(name);
        }

        db.close();
    });

    it("is a no-op on re-run and leaves existing plans untouched with zero components", () => {
        const db = createDb();

        const before = db
            .prepare(
                `SELECT * FROM financial_plans ORDER BY id`
            )
            .all();

        run(db, FinancialPlanComponentsMigration.sql);
        run(db, FinancialPlanComponentsMigration.sql);

        const after = db
            .prepare(
                `SELECT * FROM financial_plans ORDER BY id`
            )
            .all();

        expect(after).toEqual(before);

        const count = db
            .prepare(
                `SELECT COUNT(*) AS n FROM financial_plan_components`
            )
            .get() as { n: number };

        expect(count.n).toBe(0);

        db.close();
    });

    it("accepts a component row for an existing plan", () => {
        const db = createDb();
        run(db, FinancialPlanComponentsMigration.sql);

        db.prepare(
            `INSERT INTO financial_plan_components
             (id, plan_id, component_type, role, account_id)
             VALUES ('c-1', 'plan-1', 'ACCOUNT', 'ASSET', 'acc-1')`
        ).run();

        const row = db
            .prepare(
                `SELECT * FROM financial_plan_components WHERE id = 'c-1'`
            )
            .get() as Record<string, unknown>;

        expect(row.is_active).toBe(1);
        expect(row.sort_order).toBe(0);
        expect(row.target_amount).toBeNull();
        expect(row.category_id).toBeNull();

        db.close();
    });
});
