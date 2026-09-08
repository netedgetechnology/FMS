import { describe, expect, it } from "vitest";

import {
    extractPdfTransactions,
} from "../parser/pdfTransactionExtractor";

describe("PDF transaction extractor", () => {
    it("extracts rows with supported transaction dates", () => {
        const result = extractPdfTransactions({
            headers: [
                "Date",
                "Description",
                "Debit",
                "Credit",
            ],
            rows: [
                {
                    rowNumber: 2,
                    values: [
                        "01/08/2026",
                        "ATM Withdrawal",
                        "500.00",
                        "",
                    ],
                },
                {
                    rowNumber: 3,
                    values: [
                        "05/08/2026",
                        "Salary",
                        "",
                        "50000.00",
                    ],
                },
            ],
        });

        expect(result.transactionLines).toHaveLength(2);
        expect(result.document.rows).toHaveLength(2);
    });

    it("reconstructs continuation lines", () => {
        const result = extractPdfTransactions({
            headers: [
                "Date",
                "Description",
                "Debit",
                "Credit",
            ],
            rows: [
                {
                    rowNumber: 2,
                    values: [
                        "01/08/2026",
                        "AMAZON INDIA",
                    ],
                },
                {
                    rowNumber: 3,
                    values: [
                        "ONLINE PURCHASE",
                        "1,250.00",
                    ],
                },
                {
                    rowNumber: 4,
                    values: [
                        "05/08/2026",
                        "SALARY",
                        "",
                        "50,000.00",
                    ],
                },
            ],
        });

        expect(result.transactionLines)
            .toHaveLength(2);

        expect(
            result.transactionLines[0].text,
        ).toContain("AMAZON INDIA");

        expect(
            result.transactionLines[0].text,
        ).toContain("ONLINE PURCHASE");

        expect(
            result.transactionLines[0].text,
        ).toContain("1,250.00");
    });

    it("ignores pre-header statement text", () => {
        const result = extractPdfTransactions({
            headers: [],
            rows: [
                {
                    rowNumber: 1,
                    values: [
                        "Account Statement",
                    ],
                },
                {
                    rowNumber: 2,
                    values: [
                        "Date",
                        "Description",
                        "Debit",
                        "Credit",
                    ],
                },
                {
                    rowNumber: 3,
                    values: [
                        "01/08/2026",
                        "Payment",
                        "100.00",
                    ],
                },
            ],
        });

        expect(result.document.headers)
            .toEqual([
                "Date",
                "Description",
                "Debit",
                "Credit",
            ]);

        expect(result.transactionLines)
            .toHaveLength(1);
    });

    it("supports ISO and month-name dates", () => {
        const result = extractPdfTransactions({
            headers: ["Date", "Description"],
            rows: [
                {
                    rowNumber: 2,
                    values: [
                        "2026-08-01",
                        "Transfer",
                    ],
                },
                {
                    rowNumber: 3,
                    values: [
                        "01 Aug 2026",
                        "Purchase",
                    ],
                },
                {
                    rowNumber: 4,
                    values: [
                        "Aug 15, 2026",
                        "Deposit",
                    ],
                },
            ],
        });

        expect(result.transactionLines)
            .toHaveLength(3);
    });

    it("does not mutate the original document", () => {
        const document = {
            headers: ["Date", "Description"],
            rows: [
                {
                    rowNumber: 2,
                    values: [
                        "01/08/2026",
                        "Payment",
                    ],
                },
                {
                    rowNumber: 3,
                    values: [
                        "Statement generated",
                    ],
                },
            ],
        };

        const result =
            extractPdfTransactions(document);

        expect(document.rows)
            .toHaveLength(2);

        expect(result.document.rows)
            .toHaveLength(1);
    });
});
