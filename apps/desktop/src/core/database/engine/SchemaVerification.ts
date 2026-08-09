import { SQLiteProvider } from "./SQLiteProvider";

export async function verifyDatabaseSchema(): Promise<void> {

    const database = SQLiteProvider.getInstance();

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

    console.info(
        "FinanceOS tables:",
        tables.map(table => table.name)
    );

    const versions = await database.select<{
        version: number;
    }>(
        `
        SELECT version
        FROM schema_version
        ORDER BY version
        `
    );

    console.info(
        "FinanceOS migrations:",
        versions.map(row => row.version)
    );
}
