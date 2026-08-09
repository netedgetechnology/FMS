import { SQLiteProvider } from "./SQLiteProvider";

export class DatabaseHealth {
    private readonly database = SQLiteProvider.getInstance();

    async check() {
        const result = await this.database.select<{ version: string }>(
            "SELECT sqlite_version() AS version"
        );

        return {
            connected: this.database.isConnected(),
            sqliteVersion: result[0]?.version ?? "unknown"
        };
    }
}
