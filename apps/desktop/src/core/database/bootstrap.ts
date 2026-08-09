import { SQLiteProvider } from "./engine/SQLiteProvider";
import { MigrationEngine } from "./engine/MigrationEngine";

export async function initializeDatabase(): Promise<void> {

    const database = SQLiteProvider.getInstance();

    await database.connect();

    const migrationEngine = new MigrationEngine();

    await migrationEngine.migrate();

    const tables = await database.select<{
        name: string;
    }>(
        `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
        ORDER BY name
        `
    );

    const tableNames = tables.map(table => table.name);

    console.info(
        "FinanceOS SQLite tables:",
        tableNames
    );

    if (!tableNames.includes("accounts")) {
        throw new Error(
            `DATABASE DIAGNOSTIC: accounts table is missing. Tables found: ${tableNames.join(", ") || "(none)"}`
        );
    }

    console.info("FinanceOS: accounts table verified.");
}

