import { describe, expect, it } from "vitest";

import {
    CATEGORY_CSV_TEMPLATE,
    categoryNameKey,
    normalizeCategoryName,
    parseCategoryCsv,
} from "./categoryCsvImport";

const existing = [{ name: "Bank Charges" }, { name: "Rent" }];

describe("parseCategoryCsv - valid files", () => {
    it("parses a valid CSV into valid rows with canonical types", () => {
        const preview = parseCategoryCsv(
            [
                "name,type,description",
                "Sales Revenue,INCOME,Revenue from sales",
                "Office Supplies,expense,",
                "Card Payment,Transfer,Moving money",
            ].join("\n"),
            []
        );

        expect(preview.fileError).toBeNull();
        expect(preview.totalRows).toBe(3);
        expect(preview.validRows).toBe(3);
        expect(preview.rows).toEqual([
            {
                lineNumber: 2,
                name: "Sales Revenue",
                type: "INCOME",
                // No scope column: Personal, as before.
                scope: "PERSONAL",
                description: "Revenue from sales",
                status: "valid",
                messages: [],
            },
            {
                lineNumber: 3,
                name: "Office Supplies",
                type: "EXPENSE",
                // No scope column: Personal, as before.
                scope: "PERSONAL",
                description: null,
                status: "valid",
                messages: [],
            },
            {
                lineNumber: 4,
                name: "Card Payment",
                type: "TRANSFER",
                // No scope column: Personal, as before.
                scope: "PERSONAL",
                description: "Moving money",
                status: "valid",
                messages: [],
            },
        ]);
    });

    it("parses the downloadable template as all-valid", () => {
        const preview = parseCategoryCsv(CATEGORY_CSV_TEMPLATE, []);

        expect(preview.fileError).toBeNull();
        expect(preview.validRows).toBe(5);
        expect(preview.invalidRows).toBe(0);
        expect(
            Object.fromEntries(preview.rows.map(row => [row.name, row.scope]))
        ).toEqual({
            "Sales Revenue": "BUSINESS",
            "Rental Income": "BOTH",
            "Salaries & Wages": "BUSINESS",
            Fuel: "BOTH",
            Groceries: "PERSONAL",
        });
    });

    it("matches header columns in any order and case, ignoring extras, with description optional", () => {
        const preview = parseCategoryCsv(
            ["Notes,TYPE,Name", "ignored,INCOME,Salary"].join("\n"),
            []
        );

        expect(preview.rows[0]).toMatchObject({
            name: "Salary",
            type: "INCOME",
            description: null,
            status: "valid",
        });
    });

    it("handles quoted fields containing commas and escaped quotes", () => {
        const preview = parseCategoryCsv(
            [
                "name,type,description",
                '"Travel, Local",EXPENSE,"Taxi, bus and metro"',
                '"The ""Big"" Shop",EXPENSE,"Say ""hi"""',
            ].join("\n"),
            []
        );

        expect(preview.rows.map(row => [row.name, row.description])).toEqual([
            ["Travel, Local", "Taxi, bus and metro"],
            ['The "Big" Shop', 'Say "hi"'],
        ]);
        expect(preview.validRows).toBe(2);
    });

    it("handles a UTF-8 BOM and Windows (CRLF) line endings", () => {
        const preview = parseCategoryCsv(
            "﻿name,type,description\r\nSalary,INCOME,Monthly\r\n",
            []
        );

        expect(preview.fileError).toBeNull();
        expect(preview.rows).toHaveLength(1);
        expect(preview.rows[0]).toMatchObject({
            name: "Salary",
            type: "INCOME",
            description: "Monthly",
        });
    });

    it("keeps UTF-8 names intact", () => {
        const preview = parseCategoryCsv(
            [
                "name,type,description",
                "Café & Restaurants,EXPENSE,Dîner",
                "किराना,EXPENSE,Groceries",
                "日本の旅行,EXPENSE,",
                "Gifts 🎁,EXPENSE,",
            ].join("\n"),
            []
        );

        expect(preview.validRows).toBe(4);
        expect(preview.rows.map(row => row.name)).toEqual([
            "Café & Restaurants",
            "किराना",
            "日本の旅行",
            "Gifts 🎁",
        ]);
        expect(preview.rows[0].description).toBe("Dîner");
    });

    it("parses 100+ categories", () => {
        const lines = ["name,type,description"];

        for (let index = 1; index <= 150; index++) {
            lines.push(
                `Category ${index},${index % 2 ? "INCOME" : "EXPENSE"},Row ${index}`
            );
        }

        const preview = parseCategoryCsv(lines.join("\n"), []);

        expect(preview.totalRows).toBe(150);
        expect(preview.validRows).toBe(150);
        expect(preview.rows[149]).toMatchObject({
            lineNumber: 151,
            name: "Category 150",
            type: "EXPENSE",
        });
    });
});

describe("parseCategoryCsv - whitespace and empty rows", () => {
    it("trims and collapses whitespace in names and trims types/descriptions", () => {
        const preview = parseCategoryCsv(
            ["name,type,description", "   Office    Supplies  ,  expense  ,  Pens  "].join("\n"),
            []
        );

        expect(preview.rows[0]).toMatchObject({
            name: "Office Supplies",
            type: "EXPENSE",
            description: "Pens",
            status: "valid",
        });
    });

    it("treats a whitespace-only description as none", () => {
        const preview = parseCategoryCsv(
            ["name,type,description", "Salary,INCOME,   "].join("\n"),
            []
        );

        expect(preview.rows[0].description).toBeNull();
    });

    it("ignores blank lines and all-empty rows without reporting them", () => {
        const preview = parseCategoryCsv(
            [
                "name,type,description",
                "",
                "Salary,INCOME,",
                ",,",
                "   ",
                " , , ",
                "Rent Paid,EXPENSE,",
                "",
            ].join("\n"),
            []
        );

        expect(preview.totalRows).toBe(2);
        // Physical line numbers - blank lines still count, so the preview
        // points at the line the user sees in their editor.
        expect(preview.rows.map(row => row.lineNumber)).toEqual([3, 7]);
        expect(preview.invalidRows).toBe(0);
    });

    it("numbers lines physically with CRLF endings and blank lines", () => {
        const preview = parseCategoryCsv(
            "name,type\r\n\r\nSalary,INCOME\r\n\r\n\r\nsalary,INCOME\r\n",
            []
        );

        expect(preview.rows.map(row => row.lineNumber)).toEqual([3, 6]);
        expect(preview.rows[1].messages).toEqual([
            "Duplicate of row 3 in this file - will be skipped.",
        ]);
    });

    it("keeps a quoted multi-line description in one row and numbers later rows correctly", () => {
        const preview = parseCategoryCsv(
            [
                "name,type,description",
                'Rent,EXPENSE,"First line',
                'second line"',
                "Salary,INCOME,",
            ].join("\n"),
            []
        );

        expect(preview.rows).toHaveLength(2);
        expect(preview.rows[0]).toMatchObject({
            lineNumber: 2,
            name: "Rent",
            description: "First line\nsecond line",
        });
        expect(preview.rows[1]).toMatchObject({
            lineNumber: 4,
            name: "Salary",
        });
    });

    it("reports an empty file", () => {
        expect(parseCategoryCsv("", []).fileError).toBe("The file is empty.");
    });

    it("reports a header-only file as having no rows", () => {
        const preview = parseCategoryCsv("name,type,description\n\n", []);

        expect(preview.fileError).toBe("The file has no category rows.");
        expect(preview.totalRows).toBe(0);
    });

    it("reports missing required header columns", () => {
        const preview = parseCategoryCsv(
            ["title,kind", "Salary,INCOME"].join("\n"),
            []
        );

        expect(preview.fileError).toBe(
            'The header row must include "name" and "type". Expected: name,type,scope,description'
        );
        expect(preview.rows).toEqual([]);
    });
});

describe("parseCategoryCsv - invalid rows", () => {
    it("flags a missing name", () => {
        const preview = parseCategoryCsv(
            ["name,type,description", "   ,INCOME,No name"].join("\n"),
            []
        );

        expect(preview.rows[0]).toMatchObject({
            status: "invalid",
            messages: ["Name is required."],
        });
    });

    it("flags a missing type", () => {
        const preview = parseCategoryCsv(
            ["name,type,description", "Salary,,"].join("\n"),
            []
        );

        expect(preview.rows[0]).toMatchObject({
            status: "invalid",
            messages: ["Type is required."],
        });
    });

    it("flags an unknown type, keeping it as typed", () => {
        const preview = parseCategoryCsv(
            ["name,type,description", "Salary,Revenue,"].join("\n"),
            []
        );

        expect(preview.rows[0]).toMatchObject({
            status: "invalid",
            type: "Revenue",
            messages: ['Invalid type "Revenue". Use INCOME, EXPENSE, TRANSFER.'],
        });
    });

    it("reports every problem on a row", () => {
        const preview = parseCategoryCsv(
            ["name,type,description", ",Bogus,"].join("\n"),
            []
        );

        expect(preview.rows[0].messages).toEqual([
            "Name is required.",
            'Invalid type "Bogus". Use INCOME, EXPENSE, TRANSFER.',
        ]);
    });

    it("treats a short row (missing columns) as invalid, not a crash", () => {
        const preview = parseCategoryCsv(
            ["name,type,description", "Salary"].join("\n"),
            []
        );

        expect(preview.rows[0]).toMatchObject({
            name: "Salary",
            status: "invalid",
            messages: ["Type is required."],
        });
    });
});

describe("parseCategoryCsv - duplicates", () => {
    it("flags names matching an existing category case- and whitespace-insensitively", () => {
        const preview = parseCategoryCsv(
            [
                "name,type,description",
                "bank charges,EXPENSE,",
                "  BANK   CHARGES ,EXPENSE,",
                "rENT,EXPENSE,",
            ].join("\n"),
            existing
        );

        expect(preview.duplicateRows).toBe(3);
        expect(preview.validRows).toBe(0);
        expect(preview.rows[0].messages).toEqual([
            "Duplicate of an existing category - will be skipped.",
        ]);
    });

    it("flags a repeat within the same file, keeping the first occurrence", () => {
        const preview = parseCategoryCsv(
            [
                "name,type,description",
                "Groceries,EXPENSE,",
                "GROCERIES,EXPENSE,",
                " groceries ,INCOME,",
            ].join("\n"),
            []
        );

        expect(preview.rows.map(row => row.status)).toEqual([
            "valid",
            "duplicate",
            "duplicate",
        ]);
        expect(preview.rows[1].messages).toEqual([
            "Duplicate of row 2 in this file - will be skipped.",
        ]);
    });

    it("does not let an invalid row claim a name", () => {
        const preview = parseCategoryCsv(
            [
                "name,type,description",
                "Groceries,Bogus,",
                "Groceries,EXPENSE,",
            ].join("\n"),
            []
        );

        expect(preview.rows.map(row => row.status)).toEqual([
            "invalid",
            "valid",
        ]);
    });

    it("compares UTF-8 names case-insensitively", () => {
        const preview = parseCategoryCsv(
            ["name,type,description", "CAFÉ,EXPENSE,"].join("\n"),
            [{ name: "café" }]
        );

        expect(preview.rows[0].status).toBe("duplicate");
    });
});

describe("parseCategoryCsv - mixed file", () => {
    it("classifies valid, duplicate and invalid rows together with correct counts", () => {
        const preview = parseCategoryCsv(
            [
                "name,type,description",
                "Sales Revenue,INCOME,",
                "bank charges,EXPENSE,",
                ",EXPENSE,",
                '"Travel, Local",EXPENSE,"Taxi, bus"',
                "Consulting,Fees,",
                "",
                "sales revenue,INCOME,",
            ].join("\n"),
            existing
        );

        expect(preview.rows.map(row => [row.lineNumber, row.status])).toEqual([
            [2, "valid"],
            [3, "duplicate"],
            [4, "invalid"],
            [5, "valid"],
            [6, "invalid"],
            [8, "duplicate"],
        ]);
        expect(preview).toMatchObject({
            fileError: null,
            totalRows: 6,
            validRows: 2,
            duplicateRows: 2,
            invalidRows: 2,
        });
    });
});

describe("category name normalization", () => {
    it("normalizes display names and duplicate keys", () => {
        expect(normalizeCategoryName("  Bank \t  Charges ")).toBe("Bank Charges");
        expect(categoryNameKey("  Bank   CHARGES ")).toBe("bank charges");
    });
});
