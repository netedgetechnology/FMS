import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { FinanceFoundationMigration } from "@/core/database/migrations/004_finance_foundation";

import { CategoryService, parseCategoryCsv } from "../services";

import {
    CATEGORY_CSV_ACCEPT,
    CATEGORY_CSV_TEMPLATE_SAVED_MESSAGE,
    canImportCategoryCsv,
    categoryCsvImportReducer,
    categoryCsvTemplateContent,
    downloadCategoryCsvTemplate,
    initialCategoryCsvImportState,
    isCsvFileName,
    readCategoryCsvFile,
    runCategoryCsvImport,
    type CategoryCsvImportAction,
    type CategoryCsvImportState,
} from "./categoryCsvImportFlow";

// ---------------------------------------------------------------------
// Categories CSV import - dialog flow.
//
// No component-render test setup exists in this repo (vitest runs with
// environment: "node"), so the dialog is exercised through the exact
// functions it calls (readCategoryCsvFile, the reducer,
// runCategoryCsvImport), plus a check of the page/dialog source for the
// wiring.
//
// Every database access is recorded. SQLiteProvider (select/execute) and
// Tauri invoke (the create_categories_atomic command) run against a real
// in-memory SQLite database built from the app's own categories migration.
// The invoke stand-in mirrors category_import.rs (one transaction,
// name re-check, INSERT only). The Rust command itself is covered by its
// own tests in src-tauri/src/category_import.rs.
// ---------------------------------------------------------------------

const dbCalls: string[] = [];
const sqlite = { db: null as DatabaseSync | null };

vi.mock("@/core/database/engine/SQLiteProvider", () => ({
    SQLiteProvider: {
        getInstance: () => ({
            async select(sql: string, binds: unknown[] = []) {
                dbCalls.push(`select: ${sql.trim().split("\n")[0]}`);
                return sqlite.db
                    ? sqlite.db.prepare(sql).all(...(binds as never[]))
                    : [];
            },
            async execute(sql: string, binds: unknown[] = []) {
                dbCalls.push(`execute: ${sql.trim().split("\n")[0]}`);
                sqlite.db?.prepare(sql).run(...(binds as never[]));
            },
        }),
    },
}));

interface InvokedCategory {
    id: string;
    parentId: string | null;
    name: string;
    categoryType: string;
    financeScope: string;
    businessEntityId: string | null;
    description: string | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

const invokeMock = vi.hoisted(() => ({
    failAfter: null as number | null,
    templateArgs: null as unknown,
    templateResult: (async () => true) as () => Promise<boolean>,
}));

vi.mock("@tauri-apps/api/core", () => ({
    async invoke(
        command: string,
        args: { request: { categories: InvokedCategory[] } }
    ) {
        dbCalls.push(`invoke: ${command}`);

        // Stand-in for the native Save dialog + file write.
        if (command === "save_category_csv_template") {
            invokeMock.templateArgs = args;
            return invokeMock.templateResult();
        }

        const db = sqlite.db;

        if (command !== "create_categories_atomic" || !db) {
            throw new Error(`unexpected invoke ${command}`);
        }

        const key = (name: string) =>
            name.split(/\s+/).filter(Boolean).join(" ").toLowerCase();

        db.exec("BEGIN");

        try {
            const taken = new Set(
                (
                    db
                        .prepare(
                            "SELECT name FROM categories WHERE deleted_at IS NULL"
                        )
                        .all() as { name: string }[]
                ).map(row => key(row.name))
            );

            let inserted = 0;
            let skippedDuplicates = 0;

            for (const category of args.request.categories) {
                if (taken.has(key(category.name))) {
                    skippedDuplicates += 1;
                    continue;
                }

                taken.add(key(category.name));

                if (invokeMock.failAfter === inserted) {
                    throw "error returned from database: (code: 19) UNIQUE constraint failed";
                }

                db.prepare(
                    `INSERT INTO categories
                    (id, parent_id, name, category_type, finance_scope,
                     business_entity_id, description, is_active, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).run(
                    category.id,
                    category.parentId,
                    category.name,
                    category.categoryType,
                    category.financeScope,
                    category.businessEntityId,
                    category.description,
                    category.isActive ? 1 : 0,
                    category.createdAt,
                    category.updatedAt
                );

                inserted += 1;
            }

            db.exec("COMMIT");

            return { inserted, skippedDuplicates };
        } catch (error) {
            db.exec("ROLLBACK");
            throw error;
        }
    },
}));

function createDatabase(): DatabaseSync {
    const db = new DatabaseSync(":memory:");

    db.exec(FinanceFoundationMigration.sql);
    db.exec(`
        INSERT INTO categories (id, name, category_type, finance_scope, description, created_at, updated_at)
            VALUES ('existing-1', 'Bank Charges', 'EXPENSE', 'BUSINESS', 'Original', 'orig', 'orig');
        INSERT INTO categories (id, name, category_type, deleted_at)
            VALUES ('deleted-1', 'Shopping', 'EXPENSE', '2026-09-01');
    `);

    return db;
}

function csvFile(name: string, content: string) {
    return { name, text: async () => content };
}

function dispatchAll(
    actions: CategoryCsvImportAction[],
    state: CategoryCsvImportState = initialCategoryCsvImportState
): CategoryCsvImportState {
    return actions.reduce(categoryCsvImportReducer, state);
}

const existing = [{ name: "Bank Charges" }];

const mixedCsv = [
    "name,type,description",
    "Sales Revenue,INCOME,Revenue from sales",
    "bank charges,EXPENSE,",
    ",EXPENSE,",
    '"Travel, Local",EXPENSE,"Taxi, bus and metro"',
    "Consulting,Fees,",
].join("\n");

beforeEach(() => {
    dbCalls.length = 0;
    sqlite.db = null;
    invokeMock.failAfter = null;
    invokeMock.templateArgs = null;
    invokeMock.templateResult = async () => true;
});

describe("choosing a file", () => {
    it("accepts only .csv files", () => {
        expect(CATEGORY_CSV_ACCEPT).toBe(".csv,text/csv");
        expect(isCsvFileName("categories.csv")).toBe(true);
        expect(isCsvFileName("CATEGORIES.CSV")).toBe(true);
        expect(isCsvFileName("categories.xlsx")).toBe(false);
        expect(isCsvFileName("categories.csv.txt")).toBe(false);
    });

    it("rejects a non-CSV file without reading it", async () => {
        const text = vi.fn();

        const action = await readCategoryCsvFile(
            { name: "categories.xlsx", text },
            existing
        );

        expect(text).not.toHaveBeenCalled();
        expect(action).toEqual({
            type: "fileRejected",
            error: '"categories.xlsx" is not a CSV file. Choose a .csv file.',
        });
        expect(dispatchAll([action])).toEqual({
            step: "select",
            error: '"categories.xlsx" is not a CSV file. Choose a .csv file.',
        });
    });

    it("reports a file that can't be read", async () => {
        const action = await readCategoryCsvFile(
            {
                name: "categories.csv",
                text: async () => {
                    throw new Error("Permission denied");
                },
            },
            existing
        );

        expect(action).toEqual({
            type: "fileRejected",
            error: "Permission denied",
        });
    });

    it("previews a mixed file with counts - and touches no database", async () => {
        const action = await readCategoryCsvFile(
            csvFile("categories.csv", mixedCsv),
            existing
        );

        const state = dispatchAll([action]);

        expect(state.step).toBe("preview");

        if (state.step !== "preview") {
            return;
        }

        expect(state.fileName).toBe("categories.csv");
        expect(state.confirming).toBe(false);
        expect(state.preview).toMatchObject({
            totalRows: 5,
            validRows: 2,
            duplicateRows: 1,
            invalidRows: 2,
        });
        expect(state.preview.rows.map(row => row.status)).toEqual([
            "valid",
            "duplicate",
            "invalid",
            "valid",
            "invalid",
        ]);
        expect(dbCalls).toEqual([]);
    });
});

describe("confirmation", () => {
    async function previewState(csv = mixedCsv) {
        return dispatchAll([
            await readCategoryCsvFile(csvFile("c.csv", csv), existing),
        ]);
    }

    it("requires an explicit confirm step before importing", async () => {
        const preview = await previewState();

        // Import can't start straight from the preview.
        expect(
            categoryCsvImportReducer(preview, { type: "importStarted" })
        ).toBe(preview);

        const confirming = categoryCsvImportReducer(preview, {
            type: "requestConfirm",
        });

        expect(confirming).toMatchObject({ step: "preview", confirming: true });
        expect(
            categoryCsvImportReducer(confirming, { type: "importStarted" })
        ).toMatchObject({ importing: true });
    });

    it("can't confirm when there are no valid rows", async () => {
        const preview = await previewState(
            ["name,type", "bank charges,EXPENSE", ",INCOME"].join("\n")
        );

        expect(preview.step === "preview" && canImportCategoryCsv(preview.preview)).toBe(false);
        expect(
            categoryCsvImportReducer(preview, { type: "requestConfirm" })
        ).toBe(preview);
    });

    it("can't confirm a file-level error", () => {
        expect(
            canImportCategoryCsv(parseCategoryCsv("title\nx", []))
        ).toBe(false);
        expect(
            canImportCategoryCsv(parseCategoryCsv("name,type\n", []))
        ).toBe(false);
    });

    it("Back returns to the preview without importing", async () => {
        const state = dispatchAll(
            [{ type: "requestConfirm" }, { type: "cancelConfirm" }],
            await previewState()
        );

        expect(state).toMatchObject({
            step: "preview",
            confirming: false,
            importing: false,
        });
    });

    it("ignores Back and a second confirm while importing", async () => {
        const importing = dispatchAll(
            [{ type: "requestConfirm" }, { type: "importStarted" }],
            await previewState()
        );

        expect(
            categoryCsvImportReducer(importing, { type: "cancelConfirm" })
        ).toBe(importing);
        expect(
            categoryCsvImportReducer(importing, { type: "requestConfirm" })
        ).toBe(importing);
    });
});

describe("cancellation", () => {
    it("Cancel at any step before confirming resets the dialog and makes no database changes", async () => {
        sqlite.db = createDatabase();
        const before = sqlite.db
            .prepare("SELECT * FROM categories ORDER BY id")
            .all();

        for (const steps of [
            [],
            [{ type: "requestConfirm" }],
            [{ type: "requestConfirm" }, { type: "cancelConfirm" }],
        ] as CategoryCsvImportAction[][]) {
            const state = dispatchAll([
                await readCategoryCsvFile(csvFile("c.csv", mixedCsv), existing),
                ...steps,
                { type: "reset" },
            ]);

            expect(state).toEqual(initialCategoryCsvImportState);
        }

        expect(dbCalls).toEqual([]);
        expect(
            sqlite.db.prepare("SELECT * FROM categories ORDER BY id").all()
        ).toEqual(before);
    });

    it("the dialog's Cancel and close paths only reset state; only Confirm imports", () => {
        const source = readFileSync(
            path.resolve(__dirname, "ImportCategoriesCsvDialog.tsx"),
            "utf8"
        );

        // importCsvRows is reached only via runCategoryCsvImport, called
        // once - from the confirm handler.
        expect(source.match(/runCategoryCsvImport\(/g)).toHaveLength(1);
        expect(source).toMatch(
            /async function handleConfirmImport\(\) \{\s+if \(state\.step !== "preview" \|\| !state\.confirming \|\| importing\)/
        );
        expect(source).toMatch(/onClick=\{handleConfirmImport\}/);
        expect(source).not.toMatch(/importCsvRows/);

        // Closing resets; closing mid-import is blocked.
        expect(source).toMatch(
            /if \(!nextOpen && importing\) \{\s+return;\s+\}\s+if \(!nextOpen\) \{\s+dispatch\(\{ type: "reset" \}\);/
        );
    });
});

describe("running the import", () => {
    async function confirmedState(csv: string, names = existing) {
        return dispatchAll([
            await readCategoryCsvFile(csvFile("categories.csv", csv), names),
            { type: "requestConfirm" },
            { type: "importStarted" },
        ]);
    }

    it("imports only valid rows, never changes existing categories, and the result appears in the Categories module", async () => {
        sqlite.db = createDatabase();

        const categories = await new CategoryService().getAll();
        const state = await confirmedState(mixedCsv, categories);

        if (state.step !== "preview") {
            throw new Error("expected preview");
        }

        dbCalls.length = 0;

        const action = await runCategoryCsvImport(
            new CategoryService(),
            state.preview
        );

        expect(action).toEqual({
            type: "importSucceeded",
            result: { imported: 2, skippedDuplicates: 1, invalid: 2 },
        });
        // One atomic command - no per-row writes.
        expect(dbCalls).toEqual(["invoke: create_categories_atomic"]);

        const done = categoryCsvImportReducer(state, action);

        expect(done).toEqual({
            step: "done",
            fileName: "categories.csv",
            result: { imported: 2, skippedDuplicates: 1, invalid: 2 },
        });

        // What the Categories page (useCategories -> getAll) now lists.
        const after = await new CategoryService().getAll();

        expect(after.map(category => category.name)).toEqual([
            "Bank Charges",
            "Sales Revenue",
            "Travel, Local",
        ]);
        expect(
            after.find(category => category.name === "Travel, Local")
        ).toMatchObject({
            categoryType: "EXPENSE",
            financeScope: "PERSONAL",
            parentId: null,
            businessEntityId: null,
            description: "Taxi, bus and metro",
            isActive: true,
        });
        expect(
            after.find(category => category.id === "existing-1")
        ).toMatchObject({
            name: "Bank Charges",
            financeScope: "BUSINESS",
            description: "Original",
            updatedAt: "orig",
        });
    });

    it("imports 100+ UTF-8 categories, all visible in the Categories module", async () => {
        sqlite.db = createDatabase();

        const lines = ["name,type,description"];

        for (let index = 1; index <= 120; index++) {
            lines.push(`Café ${index},EXPENSE,Dîner ${index}`);
        }

        lines.push("किराना,EXPENSE,", "日本の旅行,EXPENSE,");

        const state = await confirmedState(
            lines.join("\n"),
            await new CategoryService().getAll()
        );

        if (state.step !== "preview") {
            throw new Error("expected preview");
        }

        const action = await runCategoryCsvImport(
            new CategoryService(),
            state.preview
        );

        expect(action).toMatchObject({
            type: "importSucceeded",
            result: { imported: 122, skippedDuplicates: 0, invalid: 0 },
        });

        const names = (await new CategoryService().getAll()).map(
            category => category.name
        );

        expect(names).toHaveLength(123);
        expect(names).toContain("Café 120");
        expect(names).toContain("किराना");
        expect(names).toContain("日本の旅行");
    });

    it("skips a name created after the preview instead of duplicating it", async () => {
        sqlite.db = createDatabase();

        const state = await confirmedState(
            ["name,type", "Rent,EXPENSE", "Salary,INCOME"].join("\n"),
            await new CategoryService().getAll()
        );

        // Someone adds "RENT" between preview and confirm.
        sqlite.db.exec(
            "INSERT INTO categories (id, name, category_type) VALUES ('late', 'RENT', 'EXPENSE')"
        );

        if (state.step !== "preview") {
            throw new Error("expected preview");
        }

        const action = await runCategoryCsvImport(
            new CategoryService(),
            state.preview
        );

        expect(action).toMatchObject({
            type: "importSucceeded",
            result: { imported: 1, skippedDuplicates: 1, invalid: 0 },
        });
        expect(
            (await new CategoryService().getAll()).filter(
                category => category.name.toLowerCase() === "rent"
            )
        ).toHaveLength(1);
    });

    it("a failed import writes nothing and returns to the preview with the error", async () => {
        sqlite.db = createDatabase();
        invokeMock.failAfter = 1;

        const state = await confirmedState(
            ["name,type", "First,EXPENSE", "Second,EXPENSE", "Third,EXPENSE"].join("\n"),
            await new CategoryService().getAll()
        );

        if (state.step !== "preview") {
            throw new Error("expected preview");
        }

        const action = await runCategoryCsvImport(
            new CategoryService(),
            state.preview
        );

        expect(action).toEqual({
            type: "importFailed",
            error: "Import failed - no categories were created. error returned from database: (code: 19) UNIQUE constraint failed",
        });
        expect(categoryCsvImportReducer(state, action)).toMatchObject({
            step: "preview",
            confirming: false,
            importing: false,
            error: action.type === "importFailed" ? action.error : null,
        });
        expect(
            (await new CategoryService().getAll()).map(category => category.name)
        ).toEqual(["Bank Charges"]);
    });
});

describe("Download Template - save feedback", () => {
    function notifier() {
        return { success: vi.fn(), error: vi.fn() };
    }

    it("successful save -> success toast, only after the file is written", async () => {
        const notify = notifier();
        let finishWrite: (saved: boolean) => void = () => {};

        const pending = downloadCategoryCsvTemplate(
            notify,
            () => new Promise(resolve => (finishWrite = resolve))
        );

        // Save dialog open / write in progress: nothing shown yet.
        await Promise.resolve();
        expect(notify.success).not.toHaveBeenCalled();

        finishWrite(true);

        expect(await pending).toBe("saved");
        expect(notify.success).toHaveBeenCalledTimes(1);
        expect(notify.success).toHaveBeenCalledWith(
            "Category CSV template downloaded successfully."
        );
        expect(CATEGORY_CSV_TEMPLATE_SAVED_MESSAGE).toBe(
            "Category CSV template downloaded successfully."
        );
        expect(notify.error).not.toHaveBeenCalled();
    });

    it("user cancels the Save dialog -> no success toast and no error", async () => {
        const notify = notifier();

        expect(
            await downloadCategoryCsvTemplate(notify, async () => false)
        ).toBe("cancelled");
        expect(notify.success).not.toHaveBeenCalled();
        expect(notify.error).not.toHaveBeenCalled();
    });

    it("save failure -> error toast with the reason, no success toast", async () => {
        const notify = notifier();
        const consoleError = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});

        // A Rust Err(..) arrives from invoke() as a plain string.
        expect(
            await downloadCategoryCsvTemplate(notify, async () => {
                throw "Could not write C:\\locked\\categories-template.csv: Access is denied. (os error 5)";
            })
        ).toBe("failed");

        expect(notify.success).not.toHaveBeenCalled();
        expect(notify.error).toHaveBeenCalledTimes(1);
        expect(notify.error).toHaveBeenCalledWith(
            "Could not save the template. Could not write C:\\locked\\categories-template.csv: Access is denied. (os error 5)"
        );

        consoleError.mockRestore();
    });

    it("by default calls the native save command with the template file name and contents", async () => {
        const notify = notifier();

        expect(await downloadCategoryCsvTemplate(notify)).toBe("saved");
        expect(dbCalls).toEqual(["invoke: save_category_csv_template"]);
        expect(invokeMock.templateArgs).toEqual({
            fileName: "categories-template.csv",
            contents: categoryCsvTemplateContent(),
        });
        expect(notify.success).toHaveBeenCalledTimes(1);

        invokeMock.templateResult = async () => false;
        expect(await downloadCategoryCsvTemplate(notify)).toBe("cancelled");
        expect(notify.success).toHaveBeenCalledTimes(1);
        expect(notify.error).not.toHaveBeenCalled();
    });

    it("the dialog's Download Template button uses it with the app's toast", () => {
        const source = readFileSync(
            path.resolve(__dirname, "ImportCategoriesCsvDialog.tsx"),
            "utf8"
        );

        expect(source).toMatch(/import \{ toast \} from "sonner";/);
        expect(source).toMatch(/await downloadCategoryCsvTemplate\(toast\);/);
        expect(source).toMatch(/onClick=\{handleDownloadTemplate\}/);
        // The browser-style download (no success/cancel signal) is gone.
        expect(source).not.toMatch(/createObjectURL|\.download =/);
    });
});

describe("template and page wiring", () => {
    it("offers a template that previews as all-valid", () => {
        const template = categoryCsvTemplateContent();

        expect(template.startsWith("name,type,scope,description\r\n")).toBe(true);

        const preview = parseCategoryCsv(template, []);

        expect(preview.fileError).toBeNull();
        expect(preview.validRows).toBe(preview.totalRows);
        expect(preview.totalRows).toBeGreaterThan(0);
    });

    it("the Categories page opens the import dialog and refreshes its list on success", () => {
        const page = readFileSync(
            path.resolve(__dirname, "../pages/CategoriesPage.tsx"),
            "utf8"
        );

        expect(page).toMatch(/onClick=\{\(\) => setImportOpen\(true\)\}/);
        expect(page).toContain("Import CSV");
        expect(page).toMatch(
            /<ImportCategoriesCsvDialog\s+categories=\{categories\}\s+open=\{importOpen\}\s+onOpenChange=\{setImportOpen\}\s+onSuccess=\{refresh\}/
        );
    });

    it("the preview table shows Name, Type, Description and Status columns", () => {
        const source = readFileSync(
            path.resolve(__dirname, "ImportCategoriesCsvDialog.tsx"),
            "utf8"
        );

        for (const column of ["Name", "Type", "Description", "Status"]) {
            expect(source).toContain(`<th className={headClass}>${column}</th>`);
        }

        for (const label of ["Total", "Valid", "Duplicate", "Invalid"]) {
            expect(source).toContain(`label="${label}"`);
        }
    });
});
