import { SQLiteProvider } from "./engine/SQLiteProvider";
import { MigrationEngine } from "./engine/MigrationEngine";

export async function initializeDatabase(): Promise<void> {
    const database = SQLiteProvider.getInstance();

    await database.connect();

    const migrationEngine = new MigrationEngine();

    await migrationEngine.migrate();
}
