import { invoke } from "@tauri-apps/api/core";

import { getErrorMessage } from "@/core/errors";

import {
    CATEGORY_CSV_TEMPLATE,
    parseCategoryCsv,
    type CategoryCsvImportResult,
    type CategoryCsvPreview,
    type CategoryService,
} from "../services";
import type { Category } from "../types";

// ---------------------------------------------------------------------
// Categories CSV import - dialog state + steps.
//
// Everything ImportCategoriesCsvDialog does, as plain functions: the
// reducer is the dialog's whole state machine, and the two async steps
// (reading the chosen file, running the confirmed import) return the
// action to dispatch. Kept out of the component so the flow is testable
// without a DOM (vitest runs with environment: "node").
//
//     select --file--> preview --Import--> confirming --Confirm--> done
//                        ^                     |
//                        +------- Back --------+
//
// Only the "Confirm" step writes to the database. Choosing a file,
// previewing, Back, Cancel and closing the dialog never do.
// ---------------------------------------------------------------------

export const CATEGORY_CSV_ACCEPT = ".csv,text/csv";

export const CATEGORY_CSV_TEMPLATE_FILE_NAME = "categories-template.csv";

export type CategoryCsvImportState =
    | {
          step: "select";
          error: string | null;
      }
    | {
          step: "preview";
          fileName: string;
          preview: CategoryCsvPreview;
          confirming: boolean;
          importing: boolean;
          error: string | null;
      }
    | {
          step: "done";
          fileName: string;
          result: CategoryCsvImportResult;
      };

export type CategoryCsvImportAction =
    | { type: "fileRejected"; error: string }
    | {
          type: "fileParsed";
          fileName: string;
          preview: CategoryCsvPreview;
      }
    | { type: "requestConfirm" }
    | { type: "cancelConfirm" }
    | { type: "importStarted" }
    | { type: "importFailed"; error: string }
    | { type: "importSucceeded"; result: CategoryCsvImportResult }
    | { type: "reset" };

export const initialCategoryCsvImportState: CategoryCsvImportState = {
    step: "select",
    error: null,
};

export function isCsvFileName(fileName: string): boolean {
    return /\.csv$/i.test(fileName.trim());
}

// The Import button is enabled only when there's something to create.
export function canImportCategoryCsv(
    preview: CategoryCsvPreview
): boolean {
    return preview.fileError === null && preview.validRows > 0;
}

export function categoryCsvImportReducer(
    state: CategoryCsvImportState,
    action: CategoryCsvImportAction
): CategoryCsvImportState {
    switch (action.type) {
        case "reset":
            return initialCategoryCsvImportState;

        case "fileRejected":
            return { step: "select", error: action.error };

        case "fileParsed":
            return {
                step: "preview",
                fileName: action.fileName,
                preview: action.preview,
                confirming: false,
                importing: false,
                error: null,
            };

        case "requestConfirm":
            if (
                state.step !== "preview" ||
                state.importing ||
                !canImportCategoryCsv(state.preview)
            ) {
                return state;
            }
            return { ...state, confirming: true, error: null };

        case "cancelConfirm":
            if (state.step !== "preview" || state.importing) {
                return state;
            }
            return { ...state, confirming: false };

        case "importStarted":
            if (state.step !== "preview" || !state.confirming) {
                return state;
            }
            return { ...state, importing: true, error: null };

        case "importFailed":
            if (state.step !== "preview") {
                return state;
            }
            // The import is all-or-nothing, so after a failure nothing was
            // written: back to the preview to retry or cancel.
            return {
                ...state,
                confirming: false,
                importing: false,
                error: action.error,
            };

        case "importSucceeded":
            if (state.step !== "preview") {
                return state;
            }
            return {
                step: "done",
                fileName: state.fileName,
                result: action.result,
            };
    }
}

// Reads + validates the chosen file. Never touches the database: the
// duplicate check runs against the categories the page already loaded.
export async function readCategoryCsvFile(
    file: Pick<File, "name" | "text">,
    existingCategories: readonly Pick<Category, "name">[]
): Promise<CategoryCsvImportAction> {
    if (!isCsvFileName(file.name)) {
        return {
            type: "fileRejected",
            error: `"${file.name}" is not a CSV file. Choose a .csv file.`,
        };
    }

    let content: string;

    try {
        content = await file.text();
    } catch (error) {
        return {
            type: "fileRejected",
            error: getErrorMessage(error, "The file could not be read."),
        };
    }

    return {
        type: "fileParsed",
        fileName: file.name,
        preview: parseCategoryCsv(content, existingCategories),
    };
}

// The one database write: creates the preview's valid rows atomically
// (CategoryService.importCsvRows).
export async function runCategoryCsvImport(
    service: Pick<CategoryService, "importCsvRows">,
    preview: CategoryCsvPreview
): Promise<CategoryCsvImportAction> {
    try {
        const result = await service.importCsvRows(preview.rows);

        return { type: "importSucceeded", result };
    } catch (error) {
        return {
            type: "importFailed",
            error: `Import failed - no categories were created. ${getErrorMessage(
                error,
                "Please try again."
            )}`,
        };
    }
}

// CRLF so the template opens cleanly in Excel on Windows.
export function categoryCsvTemplateContent(): string {
    return `${CATEGORY_CSV_TEMPLATE.split("\n").join("\r\n")}\r\n`;
}

export const CATEGORY_CSV_TEMPLATE_SAVED_MESSAGE =
    "Category CSV template downloaded successfully.";

/** Resolves true once written, false if the user cancelled the Save dialog. */
export type SaveCategoryCsvTemplate = (
    fileName: string,
    contents: string
) => Promise<boolean>;

// Opens the native Save dialog and writes the file (Rust command
// save_category_csv_template - see src-tauri/src/category_import.rs).
export const saveCategoryCsvTemplateFile: SaveCategoryCsvTemplate = (
    fileName,
    contents
) =>
    invoke<boolean>("save_category_csv_template", {
        fileName,
        contents,
    });

// "Download Template": success toast only once the file is on disk,
// nothing when the Save dialog is cancelled, the error toast on failure.
export async function downloadCategoryCsvTemplate(
    notify: {
        success: (message: string) => unknown;
        error: (message: string) => unknown;
    },
    save: SaveCategoryCsvTemplate = saveCategoryCsvTemplateFile
): Promise<"saved" | "cancelled" | "failed"> {
    try {
        const saved = await save(
            CATEGORY_CSV_TEMPLATE_FILE_NAME,
            categoryCsvTemplateContent()
        );

        if (!saved) {
            return "cancelled";
        }

        notify.success(CATEGORY_CSV_TEMPLATE_SAVED_MESSAGE);
        return "saved";
    } catch (error) {
        console.error("Failed to save category CSV template:", error);

        notify.error(
            `Could not save the template. ${getErrorMessage(
                error,
                "Please try again."
            )}`
        );
        return "failed";
    }
}
