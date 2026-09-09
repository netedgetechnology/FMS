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
    // line reading "...Chrgs 100.00 DR 4502.92..." is amount=100.00
    // (first number), balance=4502.92 (last number) - never the other
    // way around.
    it("assigns amount (first number) and balance (last number) correctly for a DR line - not swapped", async () => {
        setPdfText([
            "Statement of Account",
            "20-12-2025 20-12-2025 Monthly Service Chrgs 100.00 DR 4502.92 BOPAL, AHMEDABAD [GJ]",
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
            "4502.92",
        ]);
    });

    it("assigns amount and balance correctly for a CR line too, and extracts an ECS reference", async () => {
        setPdfText([
            "02-01-2026 02-01-2026 ECS/CS017663762184/BAJAJ FINANCE LTD 5300.00 CR 1119632.53 RAJPATH RANGOLI AHM GJ",
        ]);

        const result = await parsePdf(
            new ArrayBuffer(0),
        );

        expect(result.document.rows[0].values).toEqual([
            "02-01-2026",
            "ECS/CS017663762184/BAJAJ FINANCE LTD",
            "5300.00",
            "CR",
            "ECS/CS017663762184/BAJAJ",
            "",
            "5300.00",
            "1119632.53",
        ]);
    });

    it("reconstructs a transaction whose date and description span multiple physical lines (real Axis PDF wrapping)", async () => {
        setPdfText([
            "26-12-2025 26-12-2025",
            "NEFT/IN22536009266196/SME CARGO PRIVATE",
            "LIMITED/ICICI BANK LIMITED/SME CARGO PRIVATE",
            "LIMITED 10800.00 CR 15284.92 RTGS HUB",
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
            "NEFT/IN22536009266196/SME CARGO PRIVATE LIMITED/ICICI BANK LIMITED/SME CARGO PRIVATE LIMITED",
        );
        expect(amount).toBe("10800.00");
        expect(type).toBe("CR");
        expect(reference).toBe(
            "NEFT/IN22536009266196/SME",
        );
        expect(debit).toBe("");
        expect(credit).toBe("10800.00");
        expect(balance).toBe("15284.92");
    });

    it("extracts multiple consecutive transactions with running balance, in order", async () => {
        setPdfText([
            "Tran Date Value Date Transaction Particulars Chq No Amount(INR) DR/CR Balance(INR) Branch Name",
            "OPENING BALANCE 4602.92",
            "20-12-2025 20-12-2025 Monthly Service Chrgs 100.00 DR 4502.92 BOPAL, AHMEDABAD [GJ]",
            "20-12-2025 20-12-2025 GST @18% on Monthly Service Chrgs 18.00 DR 4484.92 BOPAL, AHMEDABAD [GJ]",
            "31-12-2025 31-12-2025 IMPS/P2A/536596482103/NETEDGET/YesBankL/Transfer/9198",
            "240288767217000 500000.00 CR 1010831.53 BOPAL, AHMEDABAD [GJ]",
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
            "4502.92",
        );

        expect(result.document.rows[1].values[2]).toBe(
            "18.00",
        );
        expect(result.document.rows[1].values[7]).toBe(
            "4484.92",
        );

        expect(result.document.rows[2].values[2]).toBe(
            "500000.00",
        );
        expect(result.document.rows[2].values[3]).toBe(
            "CR",
        );
        expect(result.document.rows[2].values[7]).toBe(
            "1010831.53",
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
            "Statement of Axis Account No :912020020993999 for the period (From : 20-12-2025 To : 19-06-2026)",
            "Tran Date Value Date Transaction Particulars Chq No Amount(INR) DR/CR Balance(INR) Branch Name",
            "OPENING BALANCE 4602.92",
            "20-12-2025 20-12-2025 Monthly Service Chrgs 100.00 DR 4502.92 BOPAL, AHMEDABAD [GJ]",
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
            "20-12-2025 20-12-2025 Monthly Service Chrgs 100.00 DR 4502.92",
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
            "4502.92",
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
            "30 May 2026 30 May 2026 YBS6150574779130 UPI/109908507961/",
            "From:726d92a56c1943bc862ff40e46175cb2@ptyes/",
            "To:tataplayltd.bdsi@icici/MandateRequest",
            "649.00 856.07",
            "28 May 2026 28 May 2026 10000171220260528002200021172 CMS-TPT-BT26052858269621 -MOR000701069115 -",
            "RETAIL ASSET BULK LO",
            "1,486.95 1,505.07",
            "21 Apr 2026 21 Apr 2026 YBS6111236887022 UPI/301187200738/From:9824028876@ptyes/",
            "To:9638423637@axl/Sent using Paytm UPI",
            "100.00 18.12",
            "05 Apr 2026 05 Apr 2026 YBS6095096002934 UPI/203368660141/From:9824028876@ptyes/",
            "To:paytmqr181r0yqaip@paytm/NA",
            "20.00 118.12",
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

        // 30 May 2026: balance fell 1,505.07 -> 856.07, a fall of
        // exactly the transaction's own amount (649.00) - a debit.
        expect(newest?.[0]).toBe("30 May 2026");
        expect(newest?.[2]).toBe("649.00");
        expect(newest?.[3]).toBe("DR");
        expect(newest?.[5]).toBe("649.00");
        expect(newest?.[6]).toBe("");
        expect(newest?.[7]).toBe("856.07");

        // 28 May 2026: balance rose 18.12 -> 1,505.07, a rise of
        // exactly 1,486.95 - a credit.
        expect(secondNewest?.[2]).toBe("1486.95");
        expect(secondNewest?.[3]).toBe("CR");
        expect(secondNewest?.[6]).toBe("1486.95");

        // 21 Apr 2026: balance fell 118.12 -> 18.12, a fall of
        // exactly 100.00 - a debit.
        expect(thirdNewest?.[2]).toBe("100.00");
        expect(thirdNewest?.[3]).toBe("DR");
        expect(thirdNewest?.[5]).toBe("100.00");

        // 05 Apr 2026 is the oldest transaction in this excerpt - there
        // is no earlier balance (and no Opening Balance line) to
        // compare against, so direction is left undetermined rather
        // than guessed.
        expect(oldest?.[0]).toBe("05 Apr 2026");
        expect(oldest?.[2]).toBe("20.00");
        expect(oldest?.[3]).toBe("");
        expect(oldest?.[5]).toBe("");
        expect(oldest?.[6]).toBe("");
        expect(oldest?.[7]).toBe("118.12");
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
            "03 Apr 2026 03 Apr 2026 YBS6093077461441 UPI/203226128787/From:9824028876@ptyes/",
            "To:vilposguj@ptybl/Payment for UPI Autopay",
            "827.18 580.12",
            "-- 1 of 5 --",
            "Customer Id: 10626372",
            "Primary Account Holder Name: ACHARYA HARDIK",
            "Transaction details for your account number 000763400002790 (CURRENT) (Currency - INR)",
            "Primary Holder: ACHARYA HARDIK A/C Opening Date: 23/03/2021 Account Variant/ Description: FREEDOM FLEXI 25",
            "Nominee Details: Registered Account Status: ACTIVE Joint Holder's names:",
            "Transaction",
            "Date Value Date Cheque No/Reference No Description Withdrawals Deposits Running Balance",
            "03 Apr 2026 03 Apr 2026 YBS6093077449081 UPI/203226005678/From:9824028876@ptyes/",
            "To:airtel-billpayment.paytm@ptybl/Airtel Postpaid Bill",
            "Payment",
            "1,826.64 1,407.30",
        ]);

        const result = await parsePdf(
            new ArrayBuffer(0),
        );

        expect(result.document.rows).toHaveLength(2);

        expect(result.document.rows[0].values[2]).toBe(
            "827.18",
        );
        expect(result.document.rows[0].values[7]).toBe(
            "580.12",
        );
        expect(
            result.document.rows[0].values[1],
        ).not.toMatch(/Customer Id|Transaction details|Nominee Details|of 5/);

        expect(result.document.rows[1].values[2]).toBe(
            "1826.64",
        );
        expect(result.document.rows[1].values[7]).toBe(
            "1407.30",
        );
        expect(
            result.document.rows[1].values[1],
        ).not.toMatch(/Customer Id|Transaction details|Nominee Details|of 5/);
    });
});
