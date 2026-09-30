import Database from "@tauri-apps/plugin-sql";

/**
 * SQLite's own error text for both contention errors (see
 * sqlite3_errstr): SQLITE_BUSY -> "database is locked", SQLITE_LOCKED ->
 * "database table is locked". sqlx/tauri-plugin-sql rejects with this
 * text verbatim (see getErrorMessage.ts).
 */
const BUSY_ERROR_PATTERN =
    /database is locked|database table is locked|SQLITE_BUSY|SQLITE_LOCKED/i;

const BUSY_RETRY_DELAYS_MS = [150, 400, 900];

function isBusyError(error: unknown): boolean {
    const message =
        error instanceof Error
            ? error.message
            : typeof error === "string"
                ? error
                : "";

    return BUSY_ERROR_PATTERN.test(message);
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retries `operation` a few times, with a short backoff, when it fails
 * with SQLITE_BUSY/SQLITE_LOCKED. This is safe to do blindly: a
 * busy/locked failure means SQLite never started applying the
 * statement, so nothing has partially happened - retrying just waits
 * for the other connection (another window, or this app's own
 * automatic backup) to finish. Any other error is rethrown immediately.
 */
async function retryOnBusy<T>(
    operation: () => Promise<T>
): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await operation();
        } catch (error) {
            if (
                attempt >= BUSY_RETRY_DELAYS_MS.length ||
                !isBusyError(error)
            ) {
                throw error;
            }

            await sleep(BUSY_RETRY_DELAYS_MS[attempt]);
        }
    }
}

export class SQLiteProvider {
    private static instance: SQLiteProvider;
    private db: Database | null = null;
    private connecting: Promise<Database> | null = null;

    private constructor() {}

    static getInstance(): SQLiteProvider {
        if (!SQLiteProvider.instance) {
            SQLiteProvider.instance = new SQLiteProvider();
        }

        return SQLiteProvider.instance;
    }

    async connect(): Promise<Database> {
        if (this.db) {
            return this.db;
        }

        // Without this, two callers racing before the first `Database.load()`
        // resolves (e.g. a page firing off several repository reads at once
        // on mount) would each open their own separate connection pool -
        // more connections fighting over the same SQLite file, not fewer.
        if (!this.connecting) {
            this.connecting = this.establishConnection().catch(
                error => {
                    this.connecting = null;
                    throw error;
                }
            );
        }

        return this.connecting;
    }

    private async establishConnection(): Promise<Database> {
        const db = await Database.load("sqlite:financeos.db");

        // SQLite allows only one writer at a time. In the default
        // rollback-journal mode, a long-running reader - such as this
        // app's own once-a-day automatic backup, which runs `VACUUM INTO`
        // on this same connection a few seconds after every launch (see
        // dailyDatabaseBackup.ts) - holds a read lock for its entire
        // duration, blocking every writer's commit until it finishes.
        // That is what actually surfaces as "database is locked" even
        // with a single window open. WAL mode lets readers and the one
        // writer proceed concurrently instead, which fixes the cause
        // rather than just widening the timeout. This is persisted in
        // the database file itself, so it is a no-op after the first
        // successful run.
        await retryOnBusy(() =>
            db.execute("PRAGMA journal_mode = WAL")
        );

        // sqlx already defaults every connection to a 5s busy timeout;
        // setting it explicitly keeps the behaviour visible and in one
        // place instead of relying on an undocumented library default.
        await retryOnBusy(() =>
            db.execute("PRAGMA busy_timeout = 5000")
        );

        this.db = db;
        this.connecting = null;

        return db;
    }

    async execute(
        sql: string,
        bindValues: unknown[] = []
    ): Promise<void> {
        await retryOnBusy(async () => {
            const db = await this.connect();
            await db.execute(sql, bindValues);
        });
    }

    async select<TResult extends object>(
        sql: string,
        bindValues: unknown[] = []
    ): Promise<TResult[]> {
        return await retryOnBusy(async () => {
            const db = await this.connect();

            return (await db.select(
                sql,
                bindValues
            )) as TResult[];
        });
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

    async disconnect(): Promise<void> {
        if (!this.db) {
            return;
        }

        await this.db.close();
        this.db = null;
    }
}
