import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

const invoke = vi.fn();
const execute = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
    invoke: (...args: unknown[]) => invoke(...args),
}));

vi.mock("./engine/SQLiteProvider", () => ({
    SQLiteProvider: {
        getInstance: () => ({ execute }),
    },
}));

import {
    AUTOMATIC_BACKUP_DIRECTORY,
    AUTOMATIC_BACKUP_RETENTION,
    buildVacuumIntoStatement,
    runDailyDatabaseBackup,
} from "./dailyDatabaseBackup";

const PLAN = {
    shouldRun: true,
    stagingDir:
        "D:/FinWea_Backup/FinWea_2026-09-10_2100.partial",
    finalDir: "D:/FinWea_Backup/FinWea_2026-09-10_2100",
    databaseTarget:
        "D:/FinWea_Backup/FinWea_2026-09-10_2100.partial/financeos.db",
};

describe("buildVacuumIntoStatement", () => {
    it("wraps the staging DB path in a VACUUM INTO string literal", () => {
        expect(
            buildVacuumIntoStatement(PLAN.databaseTarget)
        ).toBe(`VACUUM INTO '${PLAN.databaseTarget}'`);
    });

    it("escapes single quotes so a path cannot break out of the literal", () => {
        expect(
            buildVacuumIntoStatement("D:/o'd/financeos.db")
        ).toBe("VACUUM INTO 'D:/o''d/financeos.db'");
    });
});

describe("runDailyDatabaseBackup", () => {
    beforeEach(() => {
        invoke.mockReset();
        execute.mockReset();
        vi.spyOn(console, "info").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(
            () => {}
        );
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function withPlan(
        plan: Partial<typeof PLAN> & { shouldRun: boolean }
    ) {
        invoke.mockImplementation((command: string) => {
            if (command === "begin_daily_backup") {
                return Promise.resolve({ ...PLAN, ...plan });
            }

            // finalize_daily_backup
            return Promise.resolve(undefined);
        });
    }

    it("retention is fixed at 30 daily backups", () => {
        expect(AUTOMATIC_BACKUP_RETENTION).toBe(30);
    });

    it("creates the day's backup: begin -> VACUUM INTO staging -> finalize(succeeded:true)", async () => {
        withPlan({ shouldRun: true });
        execute.mockResolvedValue(undefined);

        await runDailyDatabaseBackup();

        expect(invoke).toHaveBeenNthCalledWith(
            1,
            "begin_daily_backup",
            { destinationPath: AUTOMATIC_BACKUP_DIRECTORY }
        );

        expect(execute).toHaveBeenCalledWith(
            `VACUUM INTO '${PLAN.databaseTarget}'`
        );

        expect(invoke).toHaveBeenCalledWith(
            "finalize_daily_backup",
            {
                stagingDir: PLAN.stagingDir,
                finalDir: PLAN.finalDir,
                succeeded: true,
                keep: 30,
            }
        );
    });

    it("prevents a second backup on the same calendar day", async () => {
        withPlan({ shouldRun: false });

        await runDailyDatabaseBackup();

        expect(execute).not.toHaveBeenCalled();
        expect(invoke).toHaveBeenCalledTimes(1); // begin only
        expect(invoke).not.toHaveBeenCalledWith(
            "finalize_daily_backup",
            expect.anything()
        );
    });

    it("on VACUUM failure: finalizes with succeeded:false, does NOT mark the day done, never throws", async () => {
        withPlan({ shouldRun: true });
        execute.mockRejectedValue(new Error("disk full"));

        await expect(
            runDailyDatabaseBackup()
        ).resolves.toBeUndefined();

        expect(invoke).toHaveBeenCalledWith(
            "finalize_daily_backup",
            expect.objectContaining({ succeeded: false })
        );
        expect(invoke).not.toHaveBeenCalledWith(
            "finalize_daily_backup",
            expect.objectContaining({ succeeded: true })
        );
        expect(console.error).toHaveBeenCalled();
    });

    it("on document-copy / publish failure: still finalizes with succeeded:false and never throws", async () => {
        invoke.mockImplementation(
            (command: string, args: { succeeded?: boolean }) => {
                if (command === "begin_daily_backup") {
                    return Promise.resolve(PLAN);
                }

                if (
                    command === "finalize_daily_backup" &&
                    args.succeeded === true
                ) {
                    return Promise.reject(
                        new Error(
                            "Could not copy document storage"
                        )
                    );
                }

                return Promise.resolve(undefined);
            }
        );
        execute.mockResolvedValue(undefined);

        await expect(
            runDailyDatabaseBackup()
        ).resolves.toBeUndefined();

        expect(invoke).toHaveBeenCalledWith(
            "finalize_daily_backup",
            expect.objectContaining({ succeeded: false })
        );
        expect(console.error).toHaveBeenCalled();
    });

    it("swallows a failure of begin_daily_backup (e.g. cannot create D:\\FinWea_Backup)", async () => {
        invoke.mockRejectedValue(
            new Error("Could not create backup folder")
        );

        await expect(
            runDailyDatabaseBackup()
        ).resolves.toBeUndefined();

        expect(execute).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalled();
    });
});
