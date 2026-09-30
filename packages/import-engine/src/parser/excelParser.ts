import * as XLSX from "xlsx";

import type { CsvDocument, CsvRow } from "../types";

import { findHeaderRow } from "./tableDetector";

import {
    decryptAgileWorkbook,
    isAgileEncryptedWorkbook,
} from "./excelAgileDecryption";

// Why a password can fail in three different ways. Two libraries are
// involved, at two different stages:
//
// - Modern .xlsx "Encrypt with Password" files use ECMA-376 Agile
//   Encryption ([MS-OFFCRYPTO] 2.3.4.10) - the installed xlsx@0.18.5
//   (SheetJS Community Edition) build can detect these but never
//   decrypt them (no decrypt_agile routine at all in this build). See
//   resolveExcelWorkbookContent below: a supplied password is tried
//   against excelAgileDecryption.ts's own real Agile decryption
//   FIRST, before ever reaching xlsx.read - so "required"/"incorrect"
//   for THIS format come from that module's own verifier check, not
//   from xlsx's error text.
// - Everything else funnels through xlsx.read itself (verified against
//   its source):
//   - "required": no password was supplied for a protected file.
//   - "incorrect": a password was supplied and rejected. Only reachable
//     for the legacy BIFF (.xls) XOR-obfuscation scheme ("Method1"),
//     the one format xlsx.read itself can genuinely decrypt.
//   - "unsupported": the file's protection was detected but can never
//     be decrypted here, no matter what password is tried - legacy
//     .xls RC4/RC4-CryptoAPI encryption, or ECMA-376 Standard
//     Encryption (2.3.4.5 - an older, less common sibling of Agile;
//     genuinely unimplemented on both sides of this file). Retrying
//     can never succeed here - the UI must report this as a
//     limitation, not prompt for another attempt.
export type ExcelPasswordErrorReason =
    | "required"
    | "incorrect"
    | "unsupported";

export class ExcelPasswordError extends Error {
    reason: ExcelPasswordErrorReason;

    constructor(
        reason: ExcelPasswordErrorReason,
        message: string
    ) {
        super(message);
        this.name = "ExcelPasswordError";
        this.reason = reason;
    }
}

const UNSUPPORTED_PROTECTION_MESSAGE =
    "This file's password protection isn't supported. Please save an unprotected copy and try again.";

// Translates the exact error xlsx@0.18.5 throws for a protected
// workbook (see ExcelPasswordErrorReason above) into a typed
// ExcelPasswordError - never guesses at a password's correctness beyond
// what the library itself reports. Returns null for anything else (a
// genuinely corrupt/unrelated file), which the caller re-throws
// unchanged. Kept as its own pure function (rather than inlined in a
// try/catch around XLSX.read) so the three-way classification is
// directly testable against the library's own documented/verified
// error contract, without needing a real encrypted file fixture.
export function classifyExcelReadError(
    err: unknown,
    passwordProvided: boolean
): ExcelPasswordError | null {
    const message =
        err instanceof Error
            ? err.message
            : String(err);

    if (message === "Password is incorrect") {
        return new ExcelPasswordError(
            "incorrect",
            "The password is incorrect."
        );
    }

    if (message === "Encryption scheme unsupported") {
        return new ExcelPasswordError(
            "unsupported",
            UNSUPPORTED_PROTECTION_MESSAGE
        );
    }

    if (message === "File is password-protected") {
        // A password was supplied yet this exact message recurred
        // unchanged - only the unconditional CFB "/encryption" check
        // (modern .xlsx) behaves this way; the legacy BIFF path always
        // throws a different message once a password is given (see
        // above). Never treat this as "incorrect" - no password will
        // ever get past it.
        if (passwordProvided) {
            return new ExcelPasswordError(
                "unsupported",
                UNSUPPORTED_PROTECTION_MESSAGE
            );
        }

        return new ExcelPasswordError(
            "required",
            "This file is password-protected."
        );
    }

    return null;
}

function readWorkbook(
    content: ArrayBuffer,
    xlsxOptions: XLSX.ParsingOptions,
    password: string | undefined
): XLSX.WorkBook {
    try {
        return XLSX.read(content, {
            ...xlsxOptions,
            password,
        });
    } catch (err) {
        throw (
            classifyExcelReadError(
                err,
                Boolean(password)
            ) ?? err
        );
    }
}

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
    // Memory-only for the duration of this call - never stored on the
    // returned CsvDocument/workbook, never logged.
    password?: string;
}

export function parseExcel(
    content: ArrayBuffer,
    options: ExcelParseOptions = {},
): CsvDocument {
    const workbook = readWorkbook(
        content,
        {
            type: "array",
            cellDates: true,
        },
        options.password
    );

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
    password?: string,
): string[] {
    const workbook = readWorkbook(
        content,
        {
            type: "array",
            bookSheets: true,
        },
        password
    );

    return workbook.SheetNames;
}

// Resolves the ArrayBuffer that parseExcel/getExcelSheetNames should
// actually read: for an Agile-Encryption-protected .xlsx (the common,
// modern "Encrypt with Password" case - see excelAgileDecryption.ts),
// this performs real decryption and returns the plain OOXML ZIP bytes,
// so every downstream step (parseExcel, header detection, column
// mapping, preview) runs completely unchanged, exactly as it would for
// a file that was never protected. Every other case - an unprotected
// file, a legacy XOR/RC4 .xls, ECMA-376 Standard Encryption, or a
// corrupt file - is returned unchanged, deferring entirely to
// parseExcel/getExcelSheetNames's own existing readWorkbook/
// classifyExcelReadError handling (unaffected by this function).
export async function resolveExcelWorkbookContent(
    content: ArrayBuffer,
    password?: string,
): Promise<ArrayBuffer> {
    if (!isAgileEncryptedWorkbook(content)) {
        return content;
    }

    if (!password) {
        throw new ExcelPasswordError(
            "required",
            "This file is password-protected."
        );
    }

    return await decryptAgileWorkbook(
        content,
        password
    );
}
