import Database from "@tauri-apps/plugin-sql";

export class SQLiteProvider {
    private static instance: SQLiteProvider;
    private db: Database | null = null;

    private constructor() {}

    static getInstance(): SQLiteProvider {
        if (!SQLiteProvider.instance) {
            SQLiteProvider.instance = new SQLiteProvider();
        }

        return SQLiteProvider.instance;
    }

    async connect(): Promise<Database> {
        if (!this.db) {
            this.db = await Database.load("sqlite:financeos.db");
        }

        return this.db;
    }

    async execute(
        sql: string,
        bindValues: unknown[] = []
    ): Promise<void> {
        const db = await this.connect();
        await db.execute(sql, bindValues);
    }

    async select<TResult extends object>(
        sql: string,
        bindValues: unknown[] = []
    ): Promise<TResult[]> {
        const db = await this.connect();

        return (await db.select(
            sql,
            bindValues
        )) as TResult[];
    }

    async beginTransaction(): Promise<void> {
        await this.execute("BEGIN TRANSACTION");
    }

    async commit(): Promise<void> {
        await this.execute("COMMIT");
    }

    async rollback(): Promise<void> {
        await this.execute("ROLLBACK");
    }

    isConnected(): boolean {
        return this.db !== null;
    }
}
