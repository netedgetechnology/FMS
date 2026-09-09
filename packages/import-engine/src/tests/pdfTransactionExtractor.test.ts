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

    // Regression test: DATE_PATTERN used to require a 4-digit year for
    // every date shape except plain YYYY-MM-DD, so a genuinely generic
    // (non-bank-structured) document using 2-digit years had every one
    // of its dated rows silently treated as non-dated continuation
    // text instead of its own transaction - exactly what happened to a
    // real SBI Credit Card statement's "16 Jul 26"-style dates. Widened
    // to accept 2-4 digit years, matching pdfParser.ts's own date
    // matching - not a bank-specific fix, just a real date format this
    // pattern previously couldn't recognise at all.
    it("supports 2-digit-year dates (DD Mon YY and DD/MM/YY), not just 4-digit years", () => {
        const result = extractPdfTransactions({
            headers: ["Date", "Description"],
            rows: [
                {
                    rowNumber: 2,
                    values: [
                        "16 Jul 26",
                        "Payment Received",
                    ],
                },
                {
                    rowNumber: 3,
                    values: [
                        "01/08/26",
                        "ATM Withdrawal",
                    ],
                },
            ],
        });

        expect(result.transactionLines)
            .toHaveLength(2);
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

// A previous version of this module had a second, bank-specific
// extraction path (extractAxisRows/parseTransactionRow) that only
// activated for single-value rows whose text started with two numeric
// dates - the shape a real PDF line took when pdfParser.ts's own
// extraction found no transactions and fell back to one-column-per-line
// text. pdfParser.ts's structural heuristic (date-led block + qualifying
// trailing amount/balance tail) now extracts these transactions directly
// instead of ever falling back to that shape, so the bank-specific path
// was removed as dead code. The real-Axis-line regression scenarios it
// used to cover (amount/balance not swapped, multiple consecutive DR/CR
// transactions, no-trailing-branch-text, header-leak into description)
// are covered against the new unified path in pdfParser.test.ts instead.
