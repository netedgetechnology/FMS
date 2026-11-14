import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { DroplineDrawingPowerScheduleMigration as migration } from "./053_dropline_drawing_power_schedule";
import { migrations } from "./registry";

function run(db: DatabaseSync, sql: string): void {
    for (const statement of sql.split(";").map(part => part.trim()).filter(Boolean)) {
        if (!/^PRAGMA\s+foreign_keys\s*=\s*ON\s*$/i.test(statement)) db.exec(statement);
    }
}

// In-memory only: this never opens a file, let alone the live database.
function databaseBefore(): DatabaseSync {
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
    for (const item of migrations) {
        if (item.version < migration.version) run(db, item.sql);
    }

    return db;
}

describe("migration 053 - Dropline Drawing Power Schedule", () => {
    it("is registered once, in order (054 Interest Rate History follows it)", () => {
        expect(migrations.filter(item => item.version === migration.version)).toEqual([migration]);
        const index = migrations.indexOf(migration);
        expect(migrations[index - 1]!.version).toBeLessThan(migration.version);
        expect(migrations[index + 1]?.version).toBe(54);
    });

    it("refuses a step whose loan does not exist when foreign keys are on", () => {
        const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
        for (const item of migrations) run(db, item.sql);

        expect(() => db.exec("INSERT INTO loan_drawing_power_schedule (id, loan_id, effective_date, drawing_power) VALUES ('x', 'no-such-loan', '2026-01-01', 1)")).toThrow(/FOREIGN KEY/);
    });

    it("adds an empty table and changes no existing table", () => {
        const db = databaseBefore();
        const shape = () => db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name != 'loan_drawing_power_schedule' ORDER BY name").all();
        const before = shape();

        run(db, migration.sql);

        expect(shape()).toEqual(before);
        expect(db.prepare("SELECT COUNT(*) AS n FROM loan_drawing_power_schedule").get()).toEqual({ n: 0 });
    });

    it("refuses two steps on one date and a negative drawing power", () => {
        const db = databaseBefore();
        run(db, migration.sql);

        db.exec("INSERT INTO loan_drawing_power_schedule (id, loan_id, effective_date, drawing_power) VALUES ('a', 'l', '2026-01-01', 100)");

        expect(() => db.exec("INSERT INTO loan_drawing_power_schedule (id, loan_id, effective_date, drawing_power) VALUES ('b', 'l', '2026-01-01', 90)")).toThrow(/UNIQUE/);
        expect(() => db.exec("INSERT INTO loan_drawing_power_schedule (id, loan_id, effective_date, drawing_power) VALUES ('c', 'l', '2026-02-01', -1)")).toThrow(/CHECK/);
    });
});
