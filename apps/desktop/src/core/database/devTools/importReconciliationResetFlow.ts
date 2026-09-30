import type { ImportReconciliationResetResult } from "./importReconciliationReset";

// ---------------------------------------------------------------------
// Confirmation flow for the development-only "Reset Import Data" action
// (SettingsPage). Kept as pure state + a runner so the safety rules can
// be tested without rendering - this repo has no component render test
// setup (vitest runs with environment: "node").
//
// Safety rules:
//  - Clicking "Reset Import Data" only opens the dialog (`open`). The
//    reset runs solely from `start` + the runner, and only once the
//    exact confirmation phrase has been typed.
//  - Cancel / Escape / outside click all dispatch `requestClose`, which
//    only ever closes the dialog - and is ignored while a reset is
//    running, so the result is never hidden mid-operation.
//  - `start` is ignored while a reset is already running, and the
//    runner itself refuses to start a second call while one is in
//    flight, so a double click can never run the reset twice.
//  - Success is only reported from a resolved call; a rejected call is
//    reported as an error and never as success.
// ---------------------------------------------------------------------

export const RESET_CONFIRMATION_PHRASE = "DELETE IMPORT DATA";

/** What the reset permanently deletes - the five tables it clears. */
export const IMPORT_RESET_DELETES: readonly {
    label: string;
    table: string;
}[] = [
    { label: "Import batches", table: "import_batches" },
    { label: "Staged import rows", table: "import_rows" },
    { label: "Saved import mappings", table: "import_mappings" },
    { label: "Learned counterparty rules", table: "counterparty_rules" },
    { label: "Reconciliation sessions", table: "reconciliations" },
];

/**
 * What the reset never touches (shown in the dialog's "Will NOT be
 * deleted" list). Transactions keep their reconciled status too.
 */
export const IMPORT_RESET_KEEPS: readonly string[] = [
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
];

export interface ImportResetDialogState {
    open: boolean;
    confirmationText: string;
    resetting: boolean;
    result: ImportReconciliationResetResult | null;
    error: string | null;
}

export const INITIAL_IMPORT_RESET_DIALOG_STATE: ImportResetDialogState = {
    open: false,
    confirmationText: "",
    resetting: false,
    result: null,
    error: null,
};

export type ImportResetDialogAction =
    /** "Reset Import Data" clicked - opens the dialog, nothing else. */
    | { type: "open" }
    | { type: "typeConfirmation"; text: string }
    /** Cancel button, Escape, or outside click. */
    | { type: "requestClose" }
    /** The destructive button - accepted only when confirmable. */
    | { type: "start" }
    | {
          type: "succeeded";
          result: ImportReconciliationResetResult;
      }
    | { type: "failed"; message: string }
    /** "Done" on the success view. */
    | { type: "dismissResult" };

export function canConfirmImportReset(
    state: Pick<
        ImportResetDialogState,
        "open" | "resetting" | "result" | "confirmationText"
    >
): boolean {
    return (
        state.open &&
        !state.resetting &&
        state.result === null &&
        state.confirmationText === RESET_CONFIRMATION_PHRASE
    );
}

export function importResetDialogReducer(
    state: ImportResetDialogState,
    action: ImportResetDialogAction
): ImportResetDialogState {
    switch (action.type) {
        case "open":
            return {
                ...INITIAL_IMPORT_RESET_DIALOG_STATE,
                open: true,
            };

        case "typeConfirmation":
            return state.resetting
                ? state
                : {
                      ...state,
                      confirmationText: action.text,
                  };

        case "requestClose":
            // Never closes mid-reset: the user must see the outcome.
            return state.resetting
                ? state
                : { ...state, open: false };

        case "start":
            return canConfirmImportReset(state)
                ? { ...state, resetting: true, error: null }
                : state;

        case "succeeded":
            return {
                ...state,
                resetting: false,
                result: action.result,
                confirmationText: "",
                error: null,
            };

        case "failed":
            return {
                ...state,
                resetting: false,
                result: null,
                error: action.message,
            };

        case "dismissResult":
            return INITIAL_IMPORT_RESET_DIALOG_STATE;
    }
}

export type ImportResetOutcome =
    | {
          status: "succeeded";
          result: ImportReconciliationResetResult;
      }
    | { status: "failed"; error: unknown }
    /** A call was already in flight - this one did nothing. */
    | { status: "ignored" };

// Wraps the reset call so at most one runs at a time, independent of
// React re-render timing (a second click before the button re-renders
// as disabled gets "ignored" and never reaches the backend).
export function createImportResetRunner(
    reset: () => Promise<ImportReconciliationResetResult>
): { run: () => Promise<ImportResetOutcome> } {
    let inFlight = false;

    return {
        async run() {
            if (inFlight) {
                return { status: "ignored" };
            }

            inFlight = true;

            try {
                return {
                    status: "succeeded",
                    result: await reset(),
                };
            } catch (error) {
                return { status: "failed", error };
            } finally {
                inFlight = false;
            }
        },
    };
}
