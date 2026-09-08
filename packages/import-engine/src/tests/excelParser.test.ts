import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import {
    getExcelSheetNames,
    parseExcel,
} from "../parser/excelParser";

import {
    processExcel,
} from "../pipeline";

function createWorkbook(): ArrayBuffer {
    const workbook = XLSX.utils.book_new();

    const sheet = XLSX.utils.aoa_to_sheet([
        [
            "Date",
            "Description",
            "Debit",
            "Credit",
            "Reference",
        ],
        [
            "2026-08-01",
            "Coffee Shop",
            250,
            "",
            "REF001",
        ],
        [
            "2026-08-02",
            "Salary",
            "",
            50000,
            "REF002",
        ],
        [
            "",
            "",
            "",
            "",
            "",
        ],
    ]);

    const secondSheet =
        XLSX.utils.aoa_to_sheet([
            ["Date", "Description", "Amount"],
            ["2026-08-03", "Test", 100],
        ]);

    XLSX.utils.book_append_sheet(
        workbook,
        sheet,
        "Bank Statement",
    );

    XLSX.utils.book_append_sheet(
        workbook,
        secondSheet,
        "Other Sheet",
    );

    const output = XLSX.write(workbook, {
        type: "array",
        bookType: "xlsx",
    });

    return output;
}

describe("Excel parser", () => {
    it("reads workbook sheet names", () => {
        const content = createWorkbook();

        expect(getExcelSheetNames(content)).toEqual([
            "Bank Statement",
            "Other Sheet",
        ]);
    });

    it("parses the selected worksheet", () => {
        const content = createWorkbook();

        const document = parseExcel(content, {
            sheetName: "Bank Statement",
        });

        expect(document.headers).toEqual([
            "Date",
            "Description",
            "Debit",
            "Credit",
            "Reference",
        ]);

        expect(document.rows).toHaveLength(2);

        expect(document.rows[0].values).toEqual([
            "2026-08-01",
            "Coffee Shop",
            "250",
            "",
            "REF001",
        ]);
    });

    it("uses the first worksheet by default", () => {
        const content = createWorkbook();

        const document = parseExcel(content);

        expect(document.headers).toEqual([
            "Date",
            "Description",
            "Debit",
            "Credit",
            "Reference",
        ]);
    });

    it("rejects a missing worksheet", () => {
        const content = createWorkbook();

        expect(() =>
            parseExcel(content, {
                sheetName: "Missing Sheet",
            }),
        ).toThrow(
            'Excel sheet "Missing Sheet" was not found.',
        );
    });
});

describe("Excel import pipeline", () => {
    it("detects bank statement columns and creates candidates", () => {
        const content = createWorkbook();

        const result = processExcel(
            content,
            "Bank Statement",
            "BANK_CSV",
        );

        expect(result.sheetName).toBe(
            "Bank Statement",
        );

        expect(result.mapping.date).toBe("Date");
        expect(result.mapping.description).toBe(
            "Description",
        );
        expect(result.mapping.debit).toBe("Debit");
        expect(result.mapping.credit).toBe("Credit");
        expect(result.mapping.referenceNumber).toBe(
            "Reference",
        );

        expect(result.candidates).toHaveLength(2);

        expect(result.candidates[0].payee).toBe(
            "Coffee Shop",
        );

        expect(result.candidates[1].amount).toBe(
            50000,
        );
    });

    // Common bank layout #2: a single Amount column (no separate
    // Debit/Credit) - same detection/normalization logic CSV already
    // relies on (resolveAmountAndType's Amount fallback), exercised here
    // through an Excel-sourced document.
    it("detects a single-Amount-column layout (no Debit/Credit split)", () => {
        const content = createWorkbook();

        const result = processExcel(
            content,
            "Other Sheet",
            "BANK_CSV",
        );

        expect(result.mapping.date).toBe("Date");
        expect(result.mapping.description).toBe(
            "Description",
        );
        expect(result.mapping.amount).toBe("Amount");

        expect(result.candidates).toHaveLength(1);
        expect(result.candidates[0].amount).toBe(100);
        expect(result.candidates[0].type).toBe(
            "income",
        );
        expect(result.candidates[0].payee).toBe(
            "Test",
        );
    });
});

// Regression coverage for the "Excel import fails with every row missing
// transactionDate/payee/amount/type" bug: a real bank-generated .xls
// export prepends account metadata (name, address, IFSC, statement
// period, ...) before the actual transaction header - parseExcel used
// to always treat row 0 as the header, so every column detection failed
// and every row was reported invalid. This fixture reproduces that
// exact shape (account holder/number anonymized) - preamble rows padded
// to the sheet's full column width, a blank/tab separator row, then the
// real "SRL NO, Tran Date, CHQNO, PARTICULARS, DR, CR, BAL, SOL" header
// - as investigated against the actual failing file.
function createAxisStyleWorkbookWithMetadataPreamble(): ArrayBuffer {
    const workbook = XLSX.utils.book_new();

    const sheet = XLSX.utils.aoa_to_sheet([
        ["Name :- ACME TECHNOLOGY", "", "", "", "", "", "", ""],
        ["Joint Holder :- -", "", "", "", "", "", "", ""],
        ["10, EXAMPLE STREET", "", "", "", "", "", "", ""],
        ["EXAMPLE CITY-000000", "", "", "", "", "", "", ""],
        ["Customer ID :- 000000000", "", "", "", "", "", "", ""],
        ["IFSC Code :- ABCD0000000", "", "", "", "", "", "", ""],
        ["MICR Code :- 000000000", "", "", "", "", "", "", ""],
        [
            "Statement of Account No - 000000000000000 for the period (From : 01-08-2026 To : 31-08-2026)",
            "", "", "", "", "", "", "",
        ],
        ["\t", "", "", "", "", "", "", ""],
        [
            "SRL NO",
            "Tran Date",
            "CHQNO",
            "PARTICULARS",
            "DR",
            "CR",
            "BAL",
            "SOL",
        ],
        [
            1,
            "01-08-2026",
            "-",
            "ACH-DR-KOTAKMAHPRIMELTKKBK-RC4-127429415-PC4-1054",
            "9260.00",
            "",
            "54981.96",
            "878",
        ],
        [
            2,
            "01-08-2026",
            "-",
            "UPI/P2A/621333332818/JOHN DOE/Sent u/EXAMPLE BANK",
            "150.00",
            "",
            "54831.96",
            "878",
        ],
        [
            3,
            "02-08-2026",
            "-",
            "NEFT/IN12345678901/SALARY CREDIT",
            "",
            "50000.00",
            "104831.96",
            "878",
        ],
    ]);

    XLSX.utils.book_append_sheet(
        workbook,
        sheet,
        "Sheet1",
    );

    const output = XLSX.write(workbook, {
        type: "array",
        bookType: "xlsx",
    });

    return output;
}

describe("Excel header-row detection (metadata preamble before the real header)", () => {
    // 1. Metadata preamble + real header + transactions selects the
    // real header, not row 0.
    it("skips the account-metadata preamble and finds the real header row", () => {
        const content =
            createAxisStyleWorkbookWithMetadataPreamble();

        const document = parseExcel(content);

        expect(document.headers).toEqual([
            "SRL NO",
            "Tran Date",
            "CHQNO",
            "PARTICULARS",
            "DR",
            "CR",
            "BAL",
            "SOL",
        ]);

        expect(document.rows).toHaveLength(3);

        expect(document.rows[0].values).toEqual([
            "1",
            "01-08-2026",
            "-",
            "ACH-DR-KOTAKMAHPRIMELTKKBK-RC4-127429415-PC4-1054",
            "9260.00",
            "",
            "54981.96",
            "878",
        ]);

        // rowNumber must still reflect the row's true position in the
        // original sheet (1-based), not its position relative to the
        // detected header.
        expect(document.rows[0].rowNumber).toBe(11);
    });

    // 2. The Axis-style header maps correctly through the full
    // processExcel pipeline - column detection, normalization, and
    // validation, exactly like a CSV import of the same shape, with no
    // Axis-specific header rules added anywhere.
    it("maps the Axis-style header (SRL NO, Tran Date, CHQNO, PARTICULARS, DR, CR, BAL, SOL) correctly through processExcel", () => {
        const content =
            createAxisStyleWorkbookWithMetadataPreamble();

        const result = processExcel(
            content,
            "Sheet1",
            "BANK_CSV",
        );

        expect(result.mapping.date).toBe(
            "Tran Date"
        );
        expect(result.mapping.description).toBe(
            "PARTICULARS"
        );
        expect(result.mapping.debit).toBe("DR");
        expect(result.mapping.credit).toBe("CR");
        expect(result.mapping.balance).toBe("BAL");

        expect(result.validation.valid).toBe(true);
        expect(result.validation.errors).toHaveLength(
            0
        );

        expect(result.candidates).toHaveLength(3);

        expect(result.candidates[0].transactionDate).toBe(
            "2026-08-01"
        );
        expect(result.candidates[0].amount).toBe(
            9260
        );
        expect(result.candidates[0].type).toBe(
            "expense"
        );
        expect(result.candidates[0].payee).toBe(
            "ACH-DR-KOTAKMAHPRIMELTKKBK-RC4-127429415-PC4-1054"
        );

        expect(result.candidates[2].amount).toBe(
            50000
        );
        expect(result.candidates[2].type).toBe(
            "income"
        );
    });

    it("falls back to row 0 (prior behavior) when no reliable header/tabular structure is found at all", () => {
        const workbook = XLSX.utils.book_new();

        const sheet = XLSX.utils.aoa_to_sheet([
            ["Just", "One", "Row"],
        ]);

        XLSX.utils.book_append_sheet(
            workbook,
            sheet,
            "Sheet1",
        );

        const content = XLSX.write(workbook, {
            type: "array",
            bookType: "xlsx",
        });

        const document = parseExcel(content);

        expect(document.headers).toEqual([
            "Just",
            "One",
            "Row",
        ]);
        expect(document.rows).toHaveLength(0);
    });
});
