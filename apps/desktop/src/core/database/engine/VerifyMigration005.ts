import { SQLiteProvider } from "./SQLiteProvider";

async function verify() {

    const db = SQLiteProvider.getInstance();

    await db.connect();

    const tables = await db.select<{ name: string }>(
        `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN ('loans', 'loan_payment_schedule')
        ORDER BY name
        `
    );

    const migrations = await db.select<{ version: number }>(
        `
        SELECT version
        FROM schema_version
        WHERE version = 5
        `
    );

    console.info(
        "Migration 005:",
        migrations.length === 1 ? "APPLIED" : "NOT APPLIED"
    );

    console.info(
        "Loan tables:",
        tables.map(table => table.name)
    );
}

void verify();

