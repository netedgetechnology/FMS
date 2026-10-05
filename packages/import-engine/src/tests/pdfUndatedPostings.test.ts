import { describe, expect, it } from "vitest";

import { parsePdfText } from "../parser/pdfParser";
import { processPdfText } from "../pipeline";

// Generic (issuer-agnostic) rules for statement lines that print no date
// of their own - see isUndatedPosting in parser/pdfParser.ts. A monetary
// statement row must never silently disappear: it becomes a row dated
// like the row it is printed under, or - when no date can be associated
// with it - a row with no date that validation flags for review. Lines
// that are not postings (narration, totals, summary figures) are still
// ignored.

function rows(text: string): string[][] {
    return parsePdfText(text).document.rows.map((row) => row.values);
}

// Date | Description | Amount | Type | Reference | Debit | Credit | Balance
describe("undated postings directly under a dated row share its date", () => {
    it("amount + C/D marker layout: a run of undated fee lines", () => {
        expect(
            rows(
                [
                    "Date Transaction Details Amount",
                    "15 Aug 26 FINANCE CHARGE 1,000.00 D",
                    "MARKUP FEE (EXCL TAX 10.00) 59.00 D",
                    "GST @ 18.00% 190.62 D",
                    "16 Aug 26 PAYMENT RECEIVED 5,000.00 C",
                ].join("\n"),
            ),
        ).toEqual([
            ["15 Aug 26", "FINANCE CHARGE", "1000.00", "DR", "", "1000.00", "", ""],
            ["15 Aug 26", "MARKUP FEE (EXCL TAX 10.00)", "59.00", "DR", "", "59.00", "", ""],
            ["15 Aug 26", "GST @ 18.00%", "190.62", "DR", "", "190.62", "", ""],
            ["16 Aug 26", "PAYMENT RECEIVED", "5000.00", "CR", "", "", "5000.00", ""],
        ]);
    });

    it("a trailing undated fee under the LAST dated row is kept too", () => {
        expect(
            rows(
                [
                    "01/07/2026 PURCHASE 100.00 DR",
                    "SERVICE TAX 18.00 DR",
                ].join("\n"),
            ).map((row) => [row[0], row[1], row[2], row[3]]),
        ).toEqual([
            ["01/07/2026", "PURCHASE", "100.00", "DR"],
            ["01/07/2026", "SERVICE TAX", "18.00", "DR"],
        ]);
    });

    it("Debit/Credit/Balance bank layout: the undated row continues the balance chain", () => {
        const result = processPdfText(
            [
                "Date Description Debit Credit Balance",
                "Opening Balance 10,000.00",
                "01/07/2026 ATM WITHDRAWAL 500.00 - 9,500.00",
                "ATM FEE 20.00 - 9,480.00",
                "02/07/2026 SALARY - 5,000.00 14,480.00",
            ].join("\n"),
            "BANK_PDF",
        );

        expect(
            result.candidates.map((c) => [c.transactionDate, c.description, c.type, c.amount, c.balance]),
        ).toEqual([
            ["2026-07-01", "ATM WITHDRAWAL", "expense", 500, 9500],
            ["2026-07-01", "ATM FEE", "expense", 20, 9480],
            ["2026-07-02", "SALARY", "income", 5000, 14480],
        ]);
        expect(result.validation.errors).toEqual([]);
        expect(result.balanceReconciliation).toMatchObject({ checkedRows: 2, mismatches: [] });
    });

    it("unmarked Amount/Balance layout: kept only when its balance moves by exactly its amount", () => {
        expect(
            rows(
                [
                    "Date Description Amount Balance",
                    "01/07/2026 CARD PURCHASE 500.00 9,500.00",
                    "CARD FEE 20.00 9,480.00",
                    // Wrapped narration that merely contains two numbers.
                    "RATE 3.50 ON 1,234.56",
                    "02/07/2026 SALARY 5,000.00 14,480.00",
                ].join("\n"),
            ).map((row) => [row[0], row[1], row[2], row[7]]),
        ).toEqual([
            ["01/07/2026", "CARD PURCHASE", "500.00", "9500.00"],
            ["01/07/2026", "CARD FEE", "20.00", "9480.00"],
            ["02/07/2026", "SALARY", "5000.00", "14480.00"],
        ]);
    });
});

describe("an undated posting with no row to take a date from is visible, never dropped", () => {
    it("after a page break inside the table: kept with no date and flagged 'Transaction date is required.'", () => {
        const result = processPdfText(
            [
                "Date Transaction Details Amount",
                "01 Jul 26 PURCHASE ONE 100.00 D",
                "Page 1 of 2",
                "LATE PAYMENT FEE 500.00 D",
                "02 Jul 26 PURCHASE TWO 200.00 D",
            ].join("\n"),
            "CREDIT_CARD_PDF",
        );

        expect(
            result.candidates.map((c) => [c.rowNumber, c.transactionDate, c.description, c.type, c.amount]),
        ).toEqual([
            [1, "2026-07-01", "PURCHASE ONE", "expense", 100],
            // Amount and direction exactly as printed; no date invented.
            [2, null, "LATE PAYMENT FEE", "expense", 500],
            [3, "2026-07-02", "PURCHASE TWO", "expense", 200],
        ]);

        expect(result.validation.errors).toEqual([
            { rowNumber: 2, field: "transactionDate", message: "Transaction date is required." },
        ]);
    });
});

describe("lines that are not postings are still ignored", () => {
    it("narration without direction evidence, totals, bare figures, carry-forwards, and text before the table", () => {
        expect(
            rows(
                [
                    // Before any transaction: summary figures and a
                    // marked amount that belongs to the summary.
                    "3,30,094.00 3,12,216.70",
                    "TOTAL AMOUNT DUE 3,30,094.00 D",
                    "Date Transaction Details Amount",
                    "01 Jul 26 PURCHASE ONE 100.00 D",
                    // Wrapped narration: an amount, but no C/D marker.
                    "CONVERTED AT 83.25",
                    "Total 100.00 D",
                    "Sub Total 100.00 D",
                    "Closing Balance 100.00 D",
                    "02 Jul 26 PURCHASE TWO 200.00 D",
                    // Separated from the table by a non-posting line,
                    // after the last dated row: outside the table.
                    "Reward points summary",
                    "POINTS VALUE 50.00 C",
                ].join("\n"),
            ).map((row) => [row[0], row[1], row[2]]),
        ).toEqual([
            ["01 Jul 26", "PURCHASE ONE", "100.00"],
            ["02 Jul 26", "PURCHASE TWO", "200.00"],
        ]);
    });

    it("an undated line whose tail shape differs from the table's rows is not a posting", () => {
        // Amount + C/D table; the undated line prints two amounts.
        expect(
            rows(
                [
                    "01 Jul 26 PURCHASE ONE 100.00 D",
                    "EMI 1 OF 6 1,000.00 6,000.00",
                ].join("\n"),
            ),
        ).toHaveLength(1);
    });
});
