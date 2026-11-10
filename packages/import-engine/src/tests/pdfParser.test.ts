import { beforeAll, describe, expect, it, vi } from "vitest";

// pdfParser.ts's own heuristic (extractBankTransactions/parseTransaction/
// findFinancialTail) only ever runs on the text pdf-parse's PDFParse.
// getText() returns - so these tests mock that one external dependency
// (a standard, test-only substitution; parsePdf itself, and every
// heuristic it calls, run completely unmodified) to drive the real
// parser with realistic multi-line statement text, instead of only
// checking "rejects invalid input" as before.
const { mockState } = vi.hoisted(() => ({
    mockState: { text: "" as string | null },
}));

vi.mock("pdf-parse", () => {
    class PDFParse {
        static setWorker(): void {}

        constructor(_options: unknown) {}

        async getText() {
            // A null sentinel simulates a real getText() failure (e.g.
            // genuinely corrupt PDF bytes), so parsePdf's own
            // error-propagation can still be tested without this mock
            // having to reimplement real PDF structure validation.
            if (mockState.text === null) {
                throw new Error(
                    "Invalid PDF structure",
                );
            }

            return { text: mockState.text };
        }

        async destroy() {}
    }

    return { PDFParse };
});

import { parsePdf } from "../parser/pdfParser";
import { processPdf } from "../pipeline";

// configurePdfWorker() (internal to parsePdf) reads window.location.origin -
// a real WebView/browser global this package's production code is always
// run inside, but not present in this package's Node-based vitest
// environment. Stubbing it is the minimal way to let parsePdf's real
// control flow run at all under test.
beforeAll(() => {
    vi.stubGlobal("window", {
        location: { origin: "http://localhost" },
    });
});

function setPdfText(lines: string[]): void {
    mockState.text = lines.join("\n");
}

describe("PDF parser", () => {
    it("exports parsePdf", () => {
        expect(parsePdf).toBeTypeOf("function");
    });

    it("rejects invalid PDF content", async () => {
        mockState.text = null;

        const content =
            new TextEncoder().encode(
                "not a pdf",
            ).buffer;

        await expect(
            parsePdf(content),
        ).rejects.toBeDefined();
    });
});

describe("PDF parser - bank statement extraction (realistic text)", () => {
    // Regression test for a real bug: findFinancialTail's own
    // "amountIndex"/"balanceIndex" field names are the reverse of what
    // they actually locate (amountIndex is the LAST of the two numbers,
    // balanceIndex the FIRST) - parseTransaction previously read them
    // literally, silently swapping every transaction's amount and
    // balance. Verified against a real Axis Bank statement export: a
    // line reading "...Chrgs 100.00 DR 3110.45..." is amount=100.00
    // (first number), balance=3110.45 (last number) - never the other
    // way around.
    it("assigns amount (first number) and balance (last number) correctly for a DR line - not swapped", async () => {
        setPdfText([
            "Statement of Account",
            "20-12-2025 20-12-2025 Monthly Service Chrgs 100.00 DR 3110.45 SAMPLE BRANCH [XX]",
        ]);

        const result = await parsePdf(
            new ArrayBuffer(0),
        );

        expect(result.document.headers).toEqual([
            "Date",
            "Description",
            "Amount",
            "Type",
            "Reference",
            "Debit",
            "Credit",
            "Balance",
        ]);

        expect(result.document.rows).toHaveLength(1);

        expect(result.document.rows[0].values).toEqual([
            "20-12-2025",
            "Monthly Service Chrgs",
            "100.00",
            "DR",
            "",
            "100.00",
            "",
            "3110.45",
        ]);
    });

    it("assigns amount and balance correctly for a CR line too, and extracts an ECS reference", async () => {
        setPdfText([
            "02-01-2026 02-01-2026 ECS/CS000000000001/EXAMPLE FINANCE LTD 4750.00 CR 987654.21 SAMPLE BRANCH TWO XX",
        ]);

        const result = await parsePdf(
            new ArrayBuffer(0),
        );

        expect(result.document.rows[0].values).toEqual([
            "02-01-2026",
            "ECS/CS000000000001/EXAMPLE FINANCE LTD",
            "4750.00",
            "CR",
            "ECS/CS000000000001/EXAMPLE",
            "",
            "4750.00",
            "987654.21",
        ]);
    });

    it("reconstructs a transaction whose date and description span multiple physical lines (real Axis PDF wrapping)", async () => {
        setPdfText([
            "26-12-2025 26-12-2025",
            "NEFT/IN00000000000002/EXAMPLE CARGO PRIVATE",
            "LIMITED/ICICI BANK LIMITED/EXAMPLE CARGO PRIVATE",
            "LIMITED 12450.00 CR 14820.30 RTGS HUB",
        ]);

        const result = await parsePdf(
            new ArrayBuffer(0),
        );

        expect(result.document.rows).toHaveLength(1);

        const [
            date,
            description,
            amount,
            type,
            reference,
            debit,
            credit,
            balance,
        ] = result.document.rows[0].values;

        expect(date).toBe("26-12-2025");
        expect(description).toBe(
            "NEFT/IN00000000000002/EXAMPLE CARGO PRIVATE LIMITED/ICICI BANK LIMITED/EXAMPLE CARGO PRIVATE LIMITED",
        );
        expect(amount).toBe("12450.00");
        expect(type).toBe("CR");
        expect(reference).toBe(
            "NEFT/IN00000000000002/EXAMPLE",
        );
        expect(debit).toBe("");
        expect(credit).toBe("12450.00");
        expect(balance).toBe("14820.30");
    });

    it("extracts multiple consecutive transactions with running balance, in order", async () => {
        setPdfText([
            "Tran Date Value Date Transaction Particulars Chq No Amount(INR) DR/CR Balance(INR) Branch Name",
            "OPENING BALANCE 3210.45",
            "20-12-2025 20-12-2025 Monthly Service Chrgs 100.00 DR 3110.45 SAMPLE BRANCH [XX]",
            "20-12-2025 20-12-2025 GST @18% on Monthly Service Chrgs 18.00 DR 3092.45 SAMPLE BRANCH [XX]",
            "31-12-2025 31-12-2025 IMPS/P2A/100000000006/NETEDGET/YesBankL/Transfer/0001",
            "200000000000001 500000.00 CR 876543.10 SAMPLE BRANCH [XX]",
        ]);

        const result = await parsePdf(
            new ArrayBuffer(0),
        );

        expect(result.document.rows).toHaveLength(3);

        expect(result.document.rows[0].values[0]).toBe(
            "20-12-2025",
        );
        expect(result.document.rows[0].values[2]).toBe(
            "100.00",
        );
        expect(result.document.rows[0].values[7]).toBe(
            "3110.45",
        );

        expect(result.document.rows[1].values[2]).toBe(
            "18.00",
        );
        expect(result.document.rows[1].values[7]).toBe(
            "3092.45",
        );

        expect(result.document.rows[2].values[2]).toBe(
            "500000.00",
        );
        expect(result.document.rows[2].values[3]).toBe(
            "CR",
        );
        expect(result.document.rows[2].values[7]).toBe(
            "876543.10",
        );
    });

    it("supports a numbered/serial-prefixed transaction row (date as the second token)", async () => {
        setPdfText([
            "1 01-08-2026 ATM Withdrawal 2,000.00 DR 48,000.00",
            "2 05-08-2026 Salary Credit 50,000.00 CR 98,000.00",
        ]);

        const result = await parsePdf(
            new ArrayBuffer(0),
        );

        expect(result.document.rows).toHaveLength(2);

        expect(result.document.rows[0].values[0]).toBe(
            "01-08-2026",
        );
        expect(result.document.rows[0].values[2]).toBe(
            "2000.00",
        );
        expect(result.document.rows[0].values[7]).toBe(
            "48000.00",
        );

        expect(result.document.rows[1].values[2]).toBe(
            "50000.00",
        );
        expect(result.document.rows[1].values[3]).toBe(
            "CR",
        );
    });

    it("never turns non-transaction preamble/header/opening-balance lines into rows", async () => {
        setPdfText([
            "NETEDGE TECHNOLOGY",
            "Statement of Axis Account No :900000000000001 for the period (From : 20-12-2025 To : 19-06-2026)",
            "Tran Date Value Date Transaction Particulars Chq No Amount(INR) DR/CR Balance(INR) Branch Name",
            "OPENING BALANCE 3210.45",
            "20-12-2025 20-12-2025 Monthly Service Chrgs 100.00 DR 3110.45 SAMPLE BRANCH [XX]",
        ]);

        const result = await parsePdf(
            new ArrayBuffer(0),
        );

        expect(result.document.rows).toHaveLength(1);
        expect(result.document.rows[0].values[1]).toBe(
            "Monthly Service Chrgs",
        );
    });

    it("falls back to generic column-splitting when no date-led transaction lines are found at all", async () => {
        setPdfText([
            "Invoice\tTotal",
            "Intel Xeon E5 1650 V3 128GB\tRs.10500.00INR",
            "Sub Total\tRs.10500.00INR",
        ]);

        const result = await parsePdf(
            new ArrayBuffer(0),
        );

        expect(result.document.headers).toEqual([
            "Column 1",
            "Column 2",
        ]);

        expect(result.document.rows).toHaveLength(3);

        expect(result.document.rows[0].values).toEqual([
            "Invoice",
            "Total",
        ]);
    });

    // Regression test migrated from pdfTransactionExtractor.test.ts's
    // former Axis-specific-path describe block: that whole path
    // (extractAxisRows/parseTransactionRow) is now dead code, since this
    // heuristic extracts real Axis lines directly instead of ever
    // falling back to the one-column-per-line shape that path required.
    it("does not crash and returns a fully correct row when a transaction line has no trailing branch text", async () => {
        setPdfText([
            "20-12-2025 20-12-2025 Monthly Service Chrgs 100.00 DR 3110.45",
        ]);

        const result = await parsePdf(
            new ArrayBuffer(0),
        );

        expect(result.document.rows).toHaveLength(1);

        expect(result.document.rows[0].values).toEqual([
            "20-12-2025",
            "Monthly Service Chrgs",
            "100.00",
            "DR",
            "",
            "100.00",
            "",
            "3110.45",
        ]);
    });
});

describe("PDF parser - universal structural extraction (amount+balance, amount-only, multi-format dates, multi-page)", () => {
    // Real lines from an actual YES Bank statement export (anonymized
    // account/customer numbers only). YES Bank's layout has no DR/CR
    // marker at all - just "<amount> <running balance>" - and uses
    // month-name dates ("30 May 2026"), unlike Axis's numeric
    // DD-MM-YYYY dates with an explicit DR/CR marker. Direction here
    // must be inferred purely from the change in running balance between
    // chronologically adjacent transactions - these 4 transactions are
    // consecutive in the real statement (no gaps), which is what makes
    // the balance-delta chain valid to check against their real amounts.
    it("infers debit/credit from balance deltas for an unmarked amount+balance layout with month-name dates, oldest entry left undetermined with no anchor", async () => {
        setPdfText([
            "30 May 2026 30 May 2026 YBS0000000000001 UPI/100000000001/",
            "From:examplepayer0001@ptyes/",
            "To:examplemerchant@icici/MandateRequest",
            "512.40 1,003.35",
            "28 May 2026 28 May 2026 10000000000000000000000000001 CMS-TPT-BT00000000000001 -MOR000000000001 -",
            "RETAIL ASSET BULK LO",
            "1,375.25 1,515.75",
            "21 Apr 2026 21 Apr 2026 YBS0000000000002 UPI/100000000002/From:9000000001@ptyes/",
            "To:9000000002@axl/Sent using Paytm UPI",
            "100.00 140.50",
            "05 Apr 2026 05 Apr 2026 YBS0000000000003 UPI/100000000003/From:9000000001@ptyes/",
            "To:paytmqrexample01@paytm/NA",
            "35.00 240.50",
        ]);

        const result = await parsePdf(
            new ArrayBuffer(0),
        );

        expect(result.document.rows).toHaveLength(4);

        const [
            newest,
            secondNewest,
            thirdNewest,
            oldest,
        ] = result.document.rows.map(
            (row) => row.values,
        );

        // 30 May 2026: balance fell 1,515.75 -> 1,003.35, a fall of
        // exactly the transaction's own amount (512.40) - a debit.
        expect(newest?.[0]).toBe("30 May 2026");
        expect(newest?.[2]).toBe("512.40");
        expect(newest?.[3]).toBe("DR");
        expect(newest?.[5]).toBe("512.40");
        expect(newest?.[6]).toBe("");
        expect(newest?.[7]).toBe("1003.35");

        // 28 May 2026: balance rose 140.50 -> 1,515.75, a rise of
        // exactly 1,375.25 - a credit.
        expect(secondNewest?.[2]).toBe("1375.25");
        expect(secondNewest?.[3]).toBe("CR");
        expect(secondNewest?.[6]).toBe("1375.25");

        // 21 Apr 2026: balance fell 240.50 -> 140.50, a fall of
        // exactly 100.00 - a debit.
        expect(thirdNewest?.[2]).toBe("100.00");
        expect(thirdNewest?.[3]).toBe("DR");
        expect(thirdNewest?.[5]).toBe("100.00");

        // 05 Apr 2026 is the oldest transaction in this excerpt - there
        // is no earlier balance (and no Opening Balance line) to
        // compare against, so direction is left undetermined rather
        // than guessed.
        expect(oldest?.[0]).toBe("05 Apr 2026");
        expect(oldest?.[2]).toBe("35.00");
        expect(oldest?.[3]).toBe("");
        expect(oldest?.[5]).toBe("");
        expect(oldest?.[6]).toBe("");
        expect(oldest?.[7]).toBe("240.50");
    });

    // A statement's own "Opening Balance" line (present, in different
    // positions, in both real fixtures used throughout this file) seeds
    // the running-balance anchor so even the very first transaction gets
    // a direction, not just later ones with an earlier transaction to
    // compare against.
    it("anchors the first transaction's direction off an Opening Balance line", async () => {
        setPdfText([
            "Opening Balance: 1,000.00",
            "01 Jan 2026 01 Jan 2026 Test Transaction One",
            "200.00 1,200.00",
            "02 Jan 2026 02 Jan 2026 Test Transaction Two",
            "50.00 1,150.00",
        ]);

        const result = await parsePdf(
            new ArrayBuffer(0),
        );

        expect(result.document.rows).toHaveLength(2);

        expect(result.document.rows[0].values[3]).toBe("CR");
        expect(result.document.rows[0].values[2]).toBe(
            "200.00",
        );
        expect(result.document.rows[0].values[7]).toBe(
            "1200.00",
        );

        expect(result.document.rows[1].values[3]).toBe("DR");
        expect(result.document.rows[1].values[2]).toBe(
            "50.00",
        );
        expect(result.document.rows[1].values[7]).toBe(
            "1150.00",
        );
    });

    // Third structural shape: amount only, no balance and no marker at
    // all. Direction is left undetermined (not guessed, not dropped)
    // rather than crashing or being silently discarded.
    it("gracefully degrades to amount-only when neither a marker nor a balance is present", async () => {
        setPdfText([
            "15 Jan 2026 Misc Charge 250.00",
        ]);

        const result = await parsePdf(
            new ArrayBuffer(0),
        );

        expect(result.document.rows).toHaveLength(1);

        expect(result.document.rows[0].values).toEqual([
            "15 Jan 2026",
            "Misc Charge",
            "250.00",
            "",
            "",
            "",
            "",
            "",
        ]);
    });

    // Real multi-page transition text from the YES Bank statement: a
    // page-marker ("-- 1 of 5 --"), customer/account metadata, and a
    // repeated column-header block, all between two real transactions.
    // None of this noise starts with a date, so it is excluded purely
    // structurally - no header/footer vocabulary list is involved - and
    // must not leak into either neighboring transaction's description.
    it("excludes repeated multi-page headers/footers and page markers without leaking into either neighboring transaction", async () => {
        setPdfText([
            "03 Apr 2026 03 Apr 2026 YBS0000000000004 UPI/100000000004/From:9000000001@ptyes/",
            "To:examplemerchant2@ptybl/Payment for UPI Autopay",
            "742.60 610.40",
            "-- 1 of 5 --",
            "Customer Id: 10000001",
            "Primary Account Holder Name: EXAMPLE CUSTOMER",
            "Transaction details for your account number 000000000000001 (CURRENT) (Currency - INR)",
            "Primary Holder: EXAMPLE CUSTOMER A/C Opening Date: 01/01/2020 Account Variant/ Description: FREEDOM FLEXI 25",
            "Nominee Details: Registered Account Status: ACTIVE Joint Holder's names:",
            "Transaction",
            "Date Value Date Cheque No/Reference No Description Withdrawals Deposits Running Balance",
            "03 Apr 2026 03 Apr 2026 YBS0000000000005 UPI/100000000005/From:9000000001@ptyes/",
            "To:examplebiller.paytm@ptybl/Postpaid Bill",
            "Payment",
            "1,315.20 1,353.00",
        ]);

        const result = await parsePdf(
            new ArrayBuffer(0),
        );

        expect(result.document.rows).toHaveLength(2);

        expect(result.document.rows[0].values[2]).toBe(
            "742.60",
        );
        expect(result.document.rows[0].values[7]).toBe(
            "610.40",
        );
        expect(
            result.document.rows[0].values[1],
        ).not.toMatch(/Customer Id|Transaction details|Nominee Details|of 5/);

        expect(result.document.rows[1].values[2]).toBe(
            "1315.20",
        );
        expect(result.document.rows[1].values[7]).toBe(
            "1353.00",
        );
        expect(
            result.document.rows[1].values[1],
        ).not.toMatch(/Customer Id|Transaction details|Nominee Details|of 5/);
    });
});

// Regression for a real failing import (an overdraft-account statement
// whose tab-separated table prints the unused Debit/Credit cell as 0.00):
//
//   02-APR-2025 <tab> 02-APR-2025 <tab> NET TXN: BILLPAY TESTREF0001
//   CARDPAY
//   111600000001 <tab> 1,000.00 <tab> 0.00 <tab> -56,500.00
//
// The old tail parser only modelled "amount [DR/CR] balance", so it took
// the LAST two numbers - the 0.00 filler became the amount and the row
// failed validation ("A valid positive amount is required") - and the
// "B/F" carry-forward row became a fake 50,000.00 debit. Traced through
// the whole import path here: PDF bytes -> pdf-parse text -> structural
// parse -> column mapping -> canonical normalization -> validation.
describe("PDF import - zero-filled Debit/Credit cells (traced regression)", () => {
    const T = " 	";

    const statement = [
        "TXN DATE" + T + "VALUE DATE" + T + "DESCRIPTION" + T + "REFERENCE" + T + "DEBITS" + T + "CREDITS" + T + "BALANCE",
        "01-APR-2025" + T + "01-APR-2025" + T + "B/F ..." + T + "50,000.00" + T + "0.00" + T + "-50,000.00",
        "02-APR-2025" + T + "02-APR-2025" + T + "NET TXN: BILLPAY TESTREF0001",
        "CARDPAY",
        "111600000001" + T + "1,000.00" + T + "0.00" + T + "-51,000.00",
        "05-APR-2025" + T + "05-APR-2025" + T + "LAP DOD INT MAR25" + T + "000000000000" + T + "0.00" + T + "20,000.00" + T + "-31,000.00",
    ];

    it("parses the debit from its own column, not the 0.00 filler, and drops the B/F row", async () => {
        setPdfText(statement);

        const result = await parsePdf(
            new ArrayBuffer(0),
        );

        expect(
            result.document.rows.map(
                (row) => row.values,
            ),
        ).toEqual([
            [
                "02-APR-2025",
                "NET TXN: BILLPAY TESTREF0001 CARDPAY",
                "1000.00",
                "DR",
                "111600000001",
                "1000.00",
                "",
                "-51000.00",
            ],
            [
                "05-APR-2025",
                "LAP DOD INT MAR25",
                "20000.00",
                "CR",
                "000000000000",
                "",
                "20000.00",
                "-31000.00",
            ],
        ]);
    });

    it("imports as valid canonical transactions end to end", async () => {
        setPdfText(statement);

        const result = await processPdf(
            new ArrayBuffer(0),
            "BANK_PDF",
        );

        expect(result.validation.errors).toEqual([]);

        expect(
            result.candidates.map((candidate) => ({
                date: candidate.transactionDate,
                type: candidate.type,
                amount: candidate.amount,
                balance: candidate.balance,
                reference:
                    candidate.referenceNumber,
            })),
        ).toEqual([
            {
                date: "2025-04-02",
                type: "expense",
                amount: 1000,
                balance: -51000,
                reference: "111600000001",
            },
            {
                date: "2025-04-05",
                type: "income",
                amount: 20000,
                balance: -31000,
                reference: "000000000000",
            },
        ]);

        expect(
            result.balanceReconciliation,
        ).toEqual({
            checkedRows: 1,
            mismatchedRowNumbers: [],
            mismatches: [],
            order: "ascending",
        });
    });
});
