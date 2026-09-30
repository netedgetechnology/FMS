import { describe, expect, it, vi } from "vitest";

import type { ImportReconciliationResetResult } from "./importReconciliationReset";
import {
    canConfirmImportReset,
    createImportResetRunner,
    IMPORT_RESET_DELETES,
    IMPORT_RESET_KEEPS,
    importResetDialogReducer,
    INITIAL_IMPORT_RESET_DIALOG_STATE,
    RESET_CONFIRMATION_PHRASE,
    type ImportResetDialogAction,
    type ImportResetDialogState,
} from "./importReconciliationResetFlow";

// The Settings page's "Reset Import Data" dialog drives exactly this
// reducer + runner (SettingsPage.tsx). No render test setup exists in
// this repo, so the flow is exercised here directly, with a mock reset
// function standing in for the Tauri command - the live database is
// never touched. The backend's own table scope (deletes exactly five
// tables, never transactions / accounts / other modules) is covered by
// the Rust tests in src-tauri/src/import_reconciliation_reset.rs.

const RESULT: ImportReconciliationResetResult = {
    importRows: 12,
    importBatches: 2,
    importMappings: 1,
    counterpartyRules: 3,
    reconciliations: 1,
};

function reduce(
    actions: ImportResetDialogAction[],
    from: ImportResetDialogState = INITIAL_IMPORT_RESET_DIALOG_STATE
): ImportResetDialogState {
    return actions.reduce(importResetDialogReducer, from);
}

const confirmable = (): ImportResetDialogState =>
    reduce([
        { type: "open" },
        {
            type: "typeConfirmation",
            text: RESET_CONFIRMATION_PHRASE,
        },
    ]);

// What SettingsPage.handleConfirmReset does, against a mock reset.
async function confirm(
    state: ImportResetDialogState,
    runner: ReturnType<typeof createImportResetRunner>
): Promise<ImportResetDialogState> {
    if (!canConfirmImportReset(state)) {
        return state;
    }

    let next = importResetDialogReducer(state, { type: "start" });
    const outcome = await runner.run();

    if (outcome.status === "succeeded") {
        next = importResetDialogReducer(next, {
            type: "succeeded",
            result: outcome.result,
        });
    } else if (outcome.status === "failed") {
        next = importResetDialogReducer(next, {
            type: "failed",
            message: String(outcome.error),
        });
    }

    return next;
}

describe("Reset Import Data - opening the dialog", () => {
    it("the button only opens the confirmation dialog - no reset call", () => {
        const reset = vi.fn();

        createImportResetRunner(reset);

        const state = reduce([{ type: "open" }]);

        expect(state.open).toBe(true);
        expect(state.resetting).toBe(false);
        expect(state.result).toBeNull();
        expect(reset).not.toHaveBeenCalled();
    });

    it("cannot be confirmed until the exact phrase is typed", () => {
        const opened = reduce([{ type: "open" }]);

        expect(canConfirmImportReset(opened)).toBe(false);

        for (const text of [
            "delete import data",
            "DELETE IMPORT",
            ` ${RESET_CONFIRMATION_PHRASE}`,
        ]) {
            const typed = importResetDialogReducer(opened, {
                type: "typeConfirmation",
                text,
            });

            expect(canConfirmImportReset(typed)).toBe(false);
            expect(
                importResetDialogReducer(typed, { type: "start" })
                    .resetting
            ).toBe(false);
        }

        expect(canConfirmImportReset(confirmable())).toBe(true);
    });

    it("re-opening starts clean - no leftover phrase, result or error", () => {
        const reopened = reduce(
            [{ type: "requestClose" }, { type: "open" }],
            {
                ...confirmable(),
                error: "old error",
            }
        );

        expect(reopened).toEqual({
            ...INITIAL_IMPORT_RESET_DIALOG_STATE,
            open: true,
        });
    });
});

describe("Reset Import Data - cancel / Escape / outside click", () => {
    it("closes the dialog and never calls the reset", () => {
        const reset = vi.fn();

        createImportResetRunner(reset);

        // Cancel, Escape and outside click all dispatch requestClose -
        // even with the phrase fully typed.
        const closed = importResetDialogReducer(confirmable(), {
            type: "requestClose",
        });

        expect(closed.open).toBe(false);
        expect(closed.resetting).toBe(false);
        expect(closed.result).toBeNull();
        expect(reset).not.toHaveBeenCalled();
    });

    it("a closed dialog cannot be confirmed", () => {
        const closed = importResetDialogReducer(confirmable(), {
            type: "requestClose",
        });

        expect(canConfirmImportReset(closed)).toBe(false);
        expect(
            importResetDialogReducer(closed, { type: "start" })
        ).toBe(closed);
    });

    it("closing is ignored while a reset is running, so the outcome is always shown", () => {
        const running = importResetDialogReducer(confirmable(), {
            type: "start",
        });

        expect(running.resetting).toBe(true);
        expect(
            importResetDialogReducer(running, { type: "requestClose" })
        ).toBe(running);
        expect(
            importResetDialogReducer(running, {
                type: "typeConfirmation",
                text: "",
            })
        ).toBe(running);
    });
});

describe("Reset Import Data - confirming", () => {
    it("invokes the reset exactly once and reports success with the counts", async () => {
        const reset = vi.fn().mockResolvedValue(RESULT);
        const runner = createImportResetRunner(reset);

        const done = await confirm(confirmable(), runner);

        expect(reset).toHaveBeenCalledTimes(1);
        expect(done.resetting).toBe(false);
        expect(done.result).toEqual(RESULT);
        expect(done.error).toBeNull();
        expect(done.open).toBe(true);
        expect(canConfirmImportReset(done)).toBe(false);

        const dismissed = importResetDialogReducer(done, {
            type: "dismissResult",
        });

        expect(dismissed).toEqual(INITIAL_IMPORT_RESET_DIALOG_STATE);
        expect(reset).toHaveBeenCalledTimes(1);
    });

    it("shows a loading state and blocks a second start while running", () => {
        const running = importResetDialogReducer(confirmable(), {
            type: "start",
        });

        expect(running.resetting).toBe(true);
        expect(canConfirmImportReset(running)).toBe(false);
        expect(
            importResetDialogReducer(running, { type: "start" })
        ).toBe(running);
    });

    it("a double click before re-render still reaches the backend only once", async () => {
        let resolve!: (value: ImportReconciliationResetResult) => void;
        const reset = vi.fn(
            () =>
                new Promise<ImportReconciliationResetResult>(
                    done => {
                        resolve = done;
                    }
                )
        );
        const runner = createImportResetRunner(reset);

        const first = runner.run();
        const second = runner.run();

        resolve(RESULT);

        await expect(first).resolves.toEqual({
            status: "succeeded",
            result: RESULT,
        });
        await expect(second).resolves.toEqual({ status: "ignored" });
        expect(reset).toHaveBeenCalledTimes(1);

        // A later, separate reset is allowed again.
        reset.mockResolvedValueOnce(RESULT);
        await runner.run();
        expect(reset).toHaveBeenCalledTimes(2);
    });

    it("a failed reset shows the error and never reports success", async () => {
        const reset = vi
            .fn()
            .mockRejectedValue(
                "error returned from database: (code: 5) database is locked"
            );
        const runner = createImportResetRunner(reset);

        const failed = await confirm(confirmable(), runner);

        expect(reset).toHaveBeenCalledTimes(1);
        expect(failed.result).toBeNull();
        expect(failed.resetting).toBe(false);
        expect(failed.open).toBe(true);
        expect(failed.error).toBe(
            "error returned from database: (code: 5) database is locked"
        );

        // The user can retry, or cancel with nothing changed.
        expect(canConfirmImportReset(failed)).toBe(true);
        expect(
            importResetDialogReducer(failed, { type: "requestClose" })
                .open
        ).toBe(false);
    });

    it("the runner surfaces an Error rejection as failed, never succeeded", async () => {
        const error = new Error("boom");
        const runner = createImportResetRunner(
            vi.fn().mockRejectedValue(error)
        );

        await expect(runner.run()).resolves.toEqual({
            status: "failed",
            error,
        });
    });
});

describe("Reset Import Data - what the dialog says it deletes / keeps", () => {
    it("lists exactly the five tables the backend command clears", () => {
        expect(IMPORT_RESET_DELETES.map(item => item.table)).toEqual([
            "import_batches",
            "import_rows",
            "import_mappings",
            "counterparty_rules",
            "reconciliations",
        ]);
        expect(IMPORT_RESET_DELETES.map(item => item.label)).toEqual([
            "Import batches",
            "Staged import rows",
            "Saved import mappings",
            "Learned counterparty rules",
            "Reconciliation sessions",
        ]);
    });

    it("explicitly lists transactions, accounts and every other module as not deleted", () => {
        expect(IMPORT_RESET_KEEPS).toEqual([
            "Transactions",
            "Accounts",
            "Business Entities",
            "Budgets",
            "Financial Plans",
            "Financial Goals",
            "Investments",
            "Loans",
            "Categories",
            "Institutions",
            "Currencies",
            "Settings",
            "Documents",
            "Other financial data",
        ]);

        const kept = IMPORT_RESET_KEEPS.join(" | ");

        // Nothing in the "kept" list is one of the deleted tables.
        for (const { table, label } of IMPORT_RESET_DELETES) {
            expect(kept).not.toContain(table);
            expect(kept).not.toContain(label);
        }
    });
});
