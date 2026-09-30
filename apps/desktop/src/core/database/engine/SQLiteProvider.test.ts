import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

const load = vi.fn();

vi.mock("@tauri-apps/plugin-sql", () => ({
    default: {
        load: (...args: unknown[]) => load(...args),
    },
}));

/**
 * SQLiteProvider is a module-level singleton, so each test needs a fresh
 * module instance (and fresh fake db) to avoid leaking connection state
 * between tests.
 */
async function freshProvider() {
    vi.resetModules();
    load.mockReset();

    const execute = vi.fn().mockResolvedValue(undefined);
    const select = vi.fn().mockResolvedValue([]);
    const close = vi.fn().mockResolvedValue(undefined);
    const fakeDb = { execute, select, close };

    load.mockResolvedValue(fakeDb);

    const { SQLiteProvider } = await import("./SQLiteProvider");

    return {
        provider: SQLiteProvider.getInstance(),
        execute,
        select,
        close,
    };
}

describe("SQLiteProvider.connect", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("sets WAL journal mode and an explicit busy timeout on the first connection", async () => {
        const { provider, execute } = await freshProvider();

        await provider.connect();

        expect(execute).toHaveBeenNthCalledWith(
            1,
            "PRAGMA journal_mode = WAL"
        );
        expect(execute).toHaveBeenNthCalledWith(
            2,
            "PRAGMA busy_timeout = 5000"
        );
    });

    it("only loads the database once even when connect() is called concurrently", async () => {
        const { provider } = await freshProvider();

        const [first, second] = await Promise.all([
            provider.connect(),
            provider.connect(),
        ]);

        expect(load).toHaveBeenCalledTimes(1);
        expect(first).toBe(second);
    });

    it("reuses the same connection on subsequent calls", async () => {
        const { provider } = await freshProvider();

        await provider.connect();
        await provider.connect();

        expect(load).toHaveBeenCalledTimes(1);
    });

    it("lets a later connect() attempt retry after a failed connection", async () => {
        vi.resetModules();
        load.mockReset();
        load.mockRejectedValueOnce(new Error("disk error"));

        const execute = vi.fn().mockResolvedValue(undefined);
        load.mockResolvedValueOnce({
            execute,
            select: vi.fn(),
            close: vi.fn(),
        });

        const { SQLiteProvider } = await import("./SQLiteProvider");
        const provider = SQLiteProvider.getInstance();

        await expect(provider.connect()).rejects.toThrow(
            "disk error"
        );

        await expect(provider.connect()).resolves.toBeDefined();
        expect(load).toHaveBeenCalledTimes(2);
    });
});

describe("SQLiteProvider busy/locked retry", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("retries execute() on 'database is locked' and succeeds once it clears", async () => {
        const { provider, execute } = await freshProvider();

        execute
            // journal_mode + busy_timeout pragmas on connect
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce(undefined)
            // the actual write: fails twice, then succeeds
            .mockRejectedValueOnce(
                "error returned from database: (code: 5) database is locked"
            )
            .mockRejectedValueOnce(
                "error returned from database: (code: 5) database is locked"
            )
            .mockResolvedValueOnce(undefined);

        const promise = provider.execute(
            "DELETE FROM accounts WHERE id = ?",
            ["acc-1"]
        );

        await vi.runAllTimersAsync();

        await expect(promise).resolves.toBeUndefined();
        // 2 pragmas + 3 attempts of the real statement
        expect(execute).toHaveBeenCalledTimes(5);
    });

    it("retries select() on SQLITE_LOCKED text and eventually returns the data", async () => {
        const { provider, select } = await freshProvider();

        select
            .mockRejectedValueOnce(
                "error returned from database: (code: 6) database table is locked"
            )
            .mockResolvedValueOnce([{ id: "acc-1" }]);

        const promise = provider.select("SELECT * FROM accounts");

        await vi.runAllTimersAsync();

        await expect(promise).resolves.toEqual([
            { id: "acc-1" },
        ]);
        expect(select).toHaveBeenCalledTimes(2);
    });

    it("gives up and rethrows once every retry attempt is exhausted", async () => {
        const { provider, execute } = await freshProvider();

        const busyError =
            "error returned from database: (code: 5) database is locked";

        execute
            .mockResolvedValueOnce(undefined) // journal_mode
            .mockResolvedValueOnce(undefined) // busy_timeout
            .mockRejectedValue(busyError);

        const promise = provider.execute("DELETE FROM accounts");
        const assertion = expect(promise).rejects.toBe(busyError);

        await vi.runAllTimersAsync();
        await assertion;

        // 2 pragmas + 1 initial attempt + 3 retries = 6
        expect(execute).toHaveBeenCalledTimes(6);
    });

    it("never retries a non-busy error", async () => {
        const { provider, execute } = await freshProvider();

        execute
            .mockResolvedValueOnce(undefined) // journal_mode
            .mockResolvedValueOnce(undefined) // busy_timeout
            .mockRejectedValueOnce(
                "error returned from database: FOREIGN KEY constraint failed"
            );

        await expect(
            provider.execute("DELETE FROM accounts")
        ).rejects.toBe(
            "error returned from database: FOREIGN KEY constraint failed"
        );

        // 2 pragmas + exactly 1 attempt, no retries
        expect(execute).toHaveBeenCalledTimes(3);
    });
});

describe("SQLiteProvider.disconnect", () => {
    it("closes and clears the connection so the next connect() reconnects", async () => {
        const { provider, close } = await freshProvider();

        await provider.connect();
        await provider.disconnect();

        expect(close).toHaveBeenCalledTimes(1);
        expect(provider.isConnected()).toBe(false);

        await provider.connect();
        expect(load).toHaveBeenCalledTimes(2);
    });

    it("is a no-op when never connected", async () => {
        const { provider, close } = await freshProvider();

        await provider.disconnect();

        expect(close).not.toHaveBeenCalled();
    });
});
