import * as XLSX from "xlsx";

import type { CsvDocument, CsvRow } from "../types";

import { findHeaderRow } from "./tableDetector";

function cellToString(value: unknown): string {
    if (value === null || value === undefined) {
        return "";
    }

    if (value instanceof Date) {
        return value.toISOString().slice(0, 10);
    }

    return String(value).trim();
}

// XLSX.utils.sheet_to_json pads every row out to the sheet's full
// column width regardless of how much content that row actually has -
// so a single-value metadata row (e.g. "Name :- NETEDGE TECHNOLOGY")
// looks exactly as "wide" as the real transaction rows unless this
// trailing padding is stripped first. A CSV/TSV line with no delimiter
// in it never has this artifact (splitDelimitedLine simply returns one
// field for it) - so this trimming is Excel-specific input
// normalization for findHeaderRow's benefit, not a change to the shared
// heuristic itself, and it never touches the headers/rows actually
// returned below (those keep their true, untrimmed cell positions).
function trimTrailingEmpty(
    fields: string[]
): string[] {
    let end = fields.length;

    while (
        end > 0 &&
        fields[end - 1] === ""
    ) {
        end -= 1;
    }

    return fields.slice(0, end);
}

export interface ExcelParseOptions {
    sheetName?: string;
}

export function parseExcel(
    content: ArrayBuffer,
    options: ExcelParseOptions = {},
): CsvDocument {
    const workbook = XLSX.read(content, {
        type: "array",
        cellDates: true,
    });

    if (workbook.SheetNames.length === 0) {
        throw new Error("The Excel workbook does not contain any sheets.");
    }

    const sheetName =
        options.sheetName ?? workbook.SheetNames[0];

    const worksheet = workbook.Sheets[sheetName];

    if (!worksheet) {
        throw new Error(
            `Excel sheet "${sheetName}" was not found.`,
        );
    }

    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(
        worksheet,
        {
            header: 1,
            defval: "",
            raw: true,
        },
    );

    if (rawRows.length === 0) {
        return {
            headers: [],
            rows: [],
        };
    }

    const stringRows = rawRows.map(row =>
        row.map(cellToString)
    );

    // Bank-generated Excel exports commonly prepend account metadata
    // (name, address, statement period, ...) before the real
    // transaction header row - never assume row 0 is the header. Reuses
    // the exact same "find the row that best explains the longest
    // consistent tabular run" heuristic parseCsv already relies on (see
    // findHeaderRow/detectDelimiterAndHeader in tableDetector.ts) rather
    // than a second, Excel-only implementation of that logic. Falls
    // back to row 0, unbounded - the prior behavior - when no reliable
    // tabular structure is found at all.
    const detection = findHeaderRow(
        stringRows.map(trimTrailingEmpty)
    );

    const headerIndex =
        detection?.headerIndex ?? 0;

    const headers = stringRows[headerIndex];

    // Bounds the transaction body to the contiguous run right after the
    // header (mirrors parseCsv's bodyEndIndex) so trailing non-tabular
    // content - a "Charge breakup" mini table, a legend, disclaimers -
    // is never treated as transaction rows either.
    const bodyEndIndex =
        detection?.bodyLength == null
            ? stringRows.length
            : Math.min(
                  stringRows.length,
                  headerIndex + 1 + detection.bodyLength
              );

    const documentRows: CsvRow[] = stringRows
        .slice(headerIndex + 1, bodyEndIndex)
        .map((row, index) => ({
            rowNumber: headerIndex + index + 2,
            values: headers.map((_, columnIndex) =>
                row[columnIndex] ?? "",
            ),
        }))
        .filter(row =>
            row.values.some(value => value !== ""),
        );

    return {
        headers,
        rows: documentRows,
    };
}

export function getExcelSheetNames(
    content: ArrayBuffer,
): string[] {
    const workbook = XLSX.read(content, {
        type: "array",
        bookSheets: true,
    });

    return workbook.SheetNames;
}
