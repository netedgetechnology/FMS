import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
    invoke: (...args: unknown[]) => invoke(...args),
}));

import { resetImportAndReconciliationData } from "./importReconciliationReset";

describe("resetImportAndReconciliationData", () => {
    beforeEach(() => {
        invoke.mockReset();
    });

    it("invokes exactly the reset_import_and_reconciliation_data command with no arguments", async () => {
        invoke.mockResolvedValue({
            importRows: 3,
            importBatches: 1,
            importMappings: 2,
            counterpartyRules: 4,
            reconciliations: 1,
        });

        await resetImportAndReconciliationData();

        expect(invoke).toHaveBeenCalledTimes(1);
        expect(invoke).toHaveBeenCalledWith(
            "reset_import_and_reconciliation_data"
        );
    });

    it("returns the exact per-table counts the backend reports", async () => {
        const counts = {
            importRows: 10,
            importBatches: 2,
            importMappings: 0,
            counterpartyRules: 5,
            reconciliations: 3,
        };

        invoke.mockResolvedValue(counts);

        await expect(
            resetImportAndReconciliationData()
        ).resolves.toEqual(counts);
    });

    it("propagates the real database error unchanged, instead of swallowing it", async () => {
        // A @tauri-apps/api/core invoke() rejection from a Rust
        // Result::Err(String) arrives as a plain string, never an Error
        // instance - this must let it through unchanged so the UI's
        // getErrorMessage() can still surface the real reason.
        invoke.mockRejectedValue(
            "error returned from database: (code: 787) FOREIGN KEY constraint failed"
        );

        await expect(
            resetImportAndReconciliationData()
        ).rejects.toBe(
            "error returned from database: (code: 787) FOREIGN KEY constraint failed"
        );
    });
});
