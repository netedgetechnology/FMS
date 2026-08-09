import { SQLiteProvider } from "./SQLiteProvider";
import { migrations } from "../migrations/registry";

export class MigrationEngine {

    private readonly database =
        SQLiteProvider.getInstance();

    async migrate(): Promise<void> {

        await this.database.execute(`
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);

        const appliedRows = await this.database.select<{
            version: number;
        }>(
            `
            SELECT version
            FROM schema_version
            ORDER BY version
            `
        );

        const appliedVersions = new Set(
            appliedRows.map(row => Number(row.version))
        );

        for (const migration of migrations) {

            if (appliedVersions.has(migration.version)) {
                continue;
            }

            console.info(
                `Applying migration ${migration.version} - ${migration.name}`
            );

            const statements = migration.sql
                .split(";")
                .map(statement => statement.trim())
                .filter(statement => statement.length > 0)
                .filter(statement =>
                    !/^PRAGMA\s+foreign_keys\s*=\s*ON\s*$/i.test(statement)
                );

            for (const statement of statements) {
                await this.database.execute(statement);
            }

            await this.database.execute(
                `
                INSERT INTO schema_version (version)
                VALUES (?)
                `,
                [migration.version]
            );

            console.info(
                `Migration ${migration.version} applied.`
            );
        }
    }
}
