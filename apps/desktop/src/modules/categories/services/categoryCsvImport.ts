import {
    splitDelimitedLine,
    stripBom,
} from "@financeos/import-engine";

import { CATEGORY_TYPE_OPTIONS } from "../constants";
import type { Category, CategoryType, FinanceScope } from "../types";
import { parseFinanceScopeText } from "../utils/financeScope";

// ---------------------------------------------------------------------
// Categories CSV import - parsing + validation (pure; no database).
//
// Format (header row required, columns in any order, matched
// case-insensitively; extra columns are ignored):
//
//     name,type,scope,description
//     Sales Revenue,INCOME,Business,Revenue from sales
//     Fuel,EXPENSE,Personal+Business,
//     "Travel, Local",EXPENSE,Personal,"Taxi, bus and metro"
//
// - name: required.
// - type: required; one of the app's existing category types
//   (CATEGORY_TYPE_OPTIONS: INCOME / EXPENSE / TRANSFER), matched
//   case-insensitively.
// - scope: optional column. Personal, Business, or both - written as
//   "Personal+Business" (also accepted: "Both", or the two joined by &,
//   /, |, ; or a quoted comma), any case. See parseFinanceScopeText.
//   Files without a scope column - every file made before scopes could
//   be combined - import exactly as before: as Personal. An empty scope
//   cell is Personal too; the preview shows the scope of every row.
//   Anything else makes the row invalid.
// - description: optional.
//
// Reuses the import-engine's quote-aware field splitting
// (splitDelimitedLine - the same code behind bank-statement CSV import):
// quoted fields, commas and "" escapes inside quotes, a UTF-8 BOM, and
// Windows (CRLF) or Unix (LF) line endings. Blank lines - and lines whose
// fields are all empty - are ignored rather than reported.
//
// Every non-empty row is reported with a status; nothing is dropped
// silently. Imported categories get the Category form's defaults for the
// fields the CSV doesn't carry: no parent, no business entity, active.
// ---------------------------------------------------------------------

export const CATEGORY_CSV_TEMPLATE = [
    "name,type,scope,description",
    "Sales Revenue,INCOME,Business,Revenue from sales",
    "Rental Income,INCOME,Personal+Business,Rent received",
    "Salaries & Wages,EXPENSE,Business,Employee salaries",
    "Fuel,EXPENSE,Personal+Business,Vehicle fuel",
    "Groceries,EXPENSE,Personal,Household groceries",
].join("\n");

// Scope for a file with no scope column, or an empty scope cell - what
// every CSV import produced before scopes could be combined.
export const CATEGORY_CSV_DEFAULT_SCOPE: FinanceScope = "PERSONAL";

export const CATEGORY_CSV_REQUIRED_COLUMNS = ["name", "type"] as const;

const VALID_TYPES: readonly CategoryType[] = CATEGORY_TYPE_OPTIONS.map(
    option => option.value
);

export type CategoryCsvRowStatus = "valid" | "duplicate" | "invalid";

export interface CategoryCsvRow {
    /** 1-based physical line number in the file (blank lines count). */
    lineNumber: number;
    /** Trimmed, internal whitespace collapsed. */
    name: string;
    /** Normalized to the canonical CategoryType when valid; else as typed. */
    type: string;
    /** Canonical FinanceScope when valid (default Personal); else as typed. */
    scope: string;
    description: string | null;
    status: CategoryCsvRowStatus;
    /** Why the row is invalid / a duplicate; empty for a valid row. */
    messages: string[];
}

export interface CategoryCsvPreview {
    /** A problem with the file as a whole (e.g. missing header column). */
    fileError: string | null;
    rows: CategoryCsvRow[];
    totalRows: number;
    validRows: number;
    duplicateRows: number;
    invalidRows: number;
}

// Whitespace-normalized display name: trimmed, internal runs of
// whitespace collapsed to one space.
export function normalizeCategoryName(name: string): string {
    return name.trim().replace(/\s+/g, " ");
}

// Duplicate-detection key: the normalized name, case-insensitive
// ("Bank Charges" == " bank  charges ").
export function categoryNameKey(name: string): string {
    return normalizeCategoryName(name).toLocaleLowerCase();
}

interface CsvRecord {
    /** 1-based physical line the record starts on. */
    lineNumber: number;
    text: string;
}

// Splits into records like the import-engine's splitCsvLines (a line
// break inside quotes stays in the record; blank lines are dropped), but
// keeps each record's physical line number. splitCsvLines discards blank
// lines before they can be counted, so the preview's "Line" - and "row N
// in this file" - would drift from what the user sees in their editor.
function splitCsvRecords(content: string): CsvRecord[] {
    const records: CsvRecord[] = [];
    let current = "";
    let quoted = false;
    let line = 1;
    let startLine = 1;

    const flush = () => {
        if (current.trim().length > 0) {
            records.push({ lineNumber: startLine, text: current });
        }
        current = "";
    };

    for (let index = 0; index < content.length; index += 1) {
        const character = content[index];
        const isBreak = character === "\n" || character === "\r";

        if (isBreak) {
            // CRLF is one line break.
            if (character === "\r" && content[index + 1] === "\n") {
                index += 1;
            }
            line += 1;
        }

        if (character === '"') {
            quoted = !quoted;
        }

        if (isBreak && !quoted) {
            flush();
            startLine = line;
            continue;
        }

        current += isBreak ? "\n" : character;
    }

    flush();

    return records;
}

function emptyPreview(fileError: string | null): CategoryCsvPreview {
    return {
        fileError,
        rows: [],
        totalRows: 0,
        validRows: 0,
        duplicateRows: 0,
        invalidRows: 0,
    };
}

export function parseCategoryCsv(
    content: string,
    existingCategories: readonly Pick<Category, "name">[]
): CategoryCsvPreview {
    const records = splitCsvRecords(stripBom(content));

    if (records.length === 0) {
        return emptyPreview("The file is empty.");
    }

    const headers = splitDelimitedLine(records[0].text, ",").map(header =>
        header.trim().toLowerCase()
    );

    const nameIndex = headers.indexOf("name");
    const typeIndex = headers.indexOf("type");
    const descriptionIndex = headers.indexOf("description");
    const scopeIndex = headers.indexOf("scope");

    const missing = CATEGORY_CSV_REQUIRED_COLUMNS.filter(
        column => !headers.includes(column)
    );

    if (missing.length > 0) {
        return emptyPreview(
            `The header row must include ${missing
                .map(column => `"${column}"`)
                .join(" and ")}. Expected: name,type,scope,description`
        );
    }

    // Names already in use: every existing (non-deleted) category, plus
    // each valid row as it's accepted, so a repeat later in the same file
    // is a duplicate too.
    const takenNames = new Map<string, string>();

    for (const category of existingCategories) {
        takenNames.set(
            categoryNameKey(category.name),
            "an existing category"
        );
    }

    const rows: CategoryCsvRow[] = [];

    records.slice(1).forEach(({ lineNumber, text }) => {
        const values = splitDelimitedLine(text, ",");

        if (values.every(value => value.trim() === "")) {
            return;
        }

        const name = normalizeCategoryName(values[nameIndex] ?? "");
        const rawType = (values[typeIndex] ?? "").trim();
        const description =
            descriptionIndex >= 0
                ? (values[descriptionIndex] ?? "").trim() || null
                : null;

        const rawScope =
            scopeIndex >= 0 ? (values[scopeIndex] ?? "").trim() : "";
        const scope = rawScope
            ? parseFinanceScopeText(rawScope)
            : CATEGORY_CSV_DEFAULT_SCOPE;

        const messages: string[] = [];

        if (!name) {
            messages.push("Name is required.");
        }

        const type = VALID_TYPES.find(
            valid => valid === rawType.toUpperCase()
        );

        if (!rawType) {
            messages.push("Type is required.");
        } else if (!type) {
            messages.push(
                `Invalid type "${rawType}". Use ${VALID_TYPES.join(", ")}.`
            );
        }

        if (!scope) {
            messages.push(
                `Invalid scope "${rawScope}". Use Personal, Business or Personal+Business.`
            );
        }

        if (messages.length > 0) {
            rows.push({
                lineNumber,
                name,
                type: rawType,
                scope: scope ?? rawScope,
                description,
                status: "invalid",
                messages,
            });
            return;
        }

        const key = categoryNameKey(name);
        const takenBy = takenNames.get(key);

        if (takenBy) {
            rows.push({
                lineNumber,
                name,
                type: type!,
                scope: scope!,
                description,
                status: "duplicate",
                messages: [`Duplicate of ${takenBy} - will be skipped.`],
            });
            return;
        }

        takenNames.set(key, `row ${lineNumber} in this file`);

        rows.push({
            lineNumber,
            name,
            type: type!,
            scope: scope!,
            description,
            status: "valid",
            messages: [],
        });
    });

    const count = (status: CategoryCsvRowStatus) =>
        rows.filter(row => row.status === status).length;

    return {
        fileError:
            rows.length === 0 ? "The file has no category rows." : null,
        rows,
        totalRows: rows.length,
        validRows: count("valid"),
        duplicateRows: count("duplicate"),
        invalidRows: count("invalid"),
    };
}
