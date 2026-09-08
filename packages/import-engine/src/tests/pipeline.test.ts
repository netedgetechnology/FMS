import { describe, expect, it } from "vitest";

import {
    detectCsvColumns,
} from "../parser/columnDetector";

import {
    parseCsv,
} from "../parser";

import {
    processCsv,
    processDocumentWithMapping,
} from "../pipeline";

describe("processCsv", () => {
    it("processes a standard bank CSV end-to-end", () => {
        const result = processCsv(
            [
                "Date,Description,Amount,Type,Reference",
                "21/08/2026,Amazon,1250.50,Debit,REF001",
                "22/08/2026,Salary,75000,Credit,REF002",
            ].join("\n")
        );

        expect(result.document.headers).toEqual([
            "Date",
            "Description",
            "Amount",
            "Type",
            "Reference",
        ]);

        expect(result.document.rows).toHaveLength(2);

        expect(result.mapping).toEqual({
            date: "Date",
            description: "Description",
            amount: "Amount",
            type: "Type",
            referenceNumber: "Reference",
        });

        expect(result.candidates).toHaveLength(2);

        expect(
            result.candidates[0]
        ).toMatchObject({
            transactionDate: "2026-08-21",
            payee: "Amazon",
            description: "Amazon",
            amount: 1250.5,
            type: "expense",
            referenceNumber: "REF001",
        });

        expect(
            result.candidates[1]
        ).toMatchObject({
            transactionDate: "2026-08-22",
            payee: "Salary",
            description: "Salary",
            amount: 75000,
            type: "income",
            referenceNumber: "REF002",
        });

        expect(
            result.validation.valid
        ).toBe(true);

        expect(
            result.validation.errors
        ).toEqual([]);
    });

    it("processes Indian bank withdrawal and deposit columns", () => {
        const result = processCsv(
            [
                "Transaction Date,Narration,Withdrawal,Deposit,UTR",
                "21/08/2026,ATM,5000,,UTR001",
                "22/08/2026,Salary,,75000,UTR002",
            ].join("\n")
        );

        expect(result.mapping).toEqual({
            date: "Transaction Date",
            description: "Narration",
            debit: "Withdrawal",
            credit: "Deposit",
            referenceNumber: "UTR",
        });

        expect(
            result.candidates[0]
        ).toMatchObject({
            transactionDate: "2026-08-21",
            amount: 5000,
            type: "expense",
            referenceNumber: "UTR001",
        });

        expect(
            result.candidates[1]
        ).toMatchObject({
            transactionDate: "2026-08-22",
            amount: 75000,
            type: "income",
            referenceNumber: "UTR002",
        });

        expect(
            result.validation.valid
        ).toBe(true);
    });

    it("returns validation errors for invalid rows", () => {
        const result = processCsv(
            [
                "Date,Description,Amount",
                "not-a-date,Unknown,not-an-amount",
            ].join("\n")
        );

        expect(
            result.candidates
        ).toHaveLength(1);

        expect(
            result.validation.valid
        ).toBe(false);

        expect(
            result.validation.errors.length
        ).toBeGreaterThan(0);
    });

    it("preserves raw CSV values", () => {
        const result = processCsv(
            [
                "Date,Merchant,Amount,Reference",
                "21/08/2026,Amazon,1250.50,REF001",
            ].join("\n")
        );

        expect(
            result.candidates[0]?.rawData
        ).toEqual({
            Date: "21/08/2026",
            Merchant: "Amazon",
            Amount: "1250.50",
            Reference: "REF001",
        });
    });

    it("processes multiple transactions", () => {
        const result = processCsv(
            [
                "Date,Description,Amount,Type",
                "01/08/2026,Coffee,250,Debit",
                "02/08/2026,Salary,50000,Credit",
                "03/08/2026,Rent,20000,Debit",
                "04/08/2026,Refund,1000,Credit",
            ].join("\n")
        );

        expect(
            result.candidates
        ).toHaveLength(4);

        expect(
            result.candidates.map(
                candidate => candidate.type
            )
        ).toEqual([
            "expense",
            "income",
            "expense",
            "income",
        ]);
    });

    it("processes an Axis-style export end-to-end (metadata preamble, DR/CR, currency-suffixed headers, unquoted comma in a trailing field) and excludes trailing disclaimer/footer text from the transaction body entirely", () => {
        const result = processCsv(
            [
                "Name :- NETEDGE TECHNOLOGY",
                "Joint Holder :- -",
                "10, 4TH FLOOR, AMRAPALI AXIOM, OPP. BHOPAL",
                "BRIDGE, AMBALI, BHOPAL, AHMEDABAD",
                "Currency :- INR",
                "Statement of Account No - 912020020993999 for the period (From : 01-08-2026 To : 31-08-2026)",
                "Tran Date,Value Date,CHQNO,Transaction Particulars,Amount(INR),DR|CR,Balance(INR),Branch Name",
                "01-08-2026,01-08-2026,-,ACH-DR-KOTAKMAHPRIMELTKKBK,9260.00,DR,54981.96,BOPAL, AHMEDABAD [GJ]",
                "01-08-2026,01-08-2026,-,UPI/P2A/621333332818,150.00,DR,54831.96,BOPAL, AHMEDABAD [GJ]",
                "02-08-2026,02-08-2026,-,NEFT/IN42621556482010,50000.00,CR,104831.96,RTGS HUB",
                '"Unless the constituent notifies the bank immediately, this statement stands correct."',
                '"The closing balance shown includes funds under clearing."',
                "Legend : ",
                " ICONN , Transaction through Internet Banking ",
                "BRN ,  Branch ",
            ].join("\n")
        );

        expect(result.document.headers).toHaveLength(
            8
        );

        // Only the 3 real transaction rows survive as candidates - the
        // trailing disclaimer paragraphs and the 2-column legend table
        // never become rows at all, because they break the contiguous,
        // structurally-consistent run that starts right after the header.
        expect(result.candidates).toHaveLength(
            3
        );

        expect(result.mapping.date).toBeTruthy();
        expect(result.mapping.description).toBe(
            "Transaction Particulars"
        );
        expect(result.mapping.amount).toBe(
            "Amount(INR)"
        );
        expect(result.mapping.type).toBe(
            "DR|CR"
        );
        expect(result.mapping.balance).toBe(
            "Balance(INR)"
        );

        expect(result.mapping.branch).toBe(
            "Branch Name"
        );

        const [first, second, third] =
            result.candidates;

        expect(first).toMatchObject({
            amount: 9260,
            type: "expense",
            balance: 54981.96,
            branch: "BOPAL,AHMEDABAD [GJ]",
            // "ACH-DR-..." has no recognizable channel token - left
            // blank rather than guessed.
            transactionType: null,
        });

        expect(second).toMatchObject({
            amount: 150,
            type: "expense",
            branch: "BOPAL,AHMEDABAD [GJ]",
            transactionType: "UPI",
        });

        expect(third).toMatchObject({
            amount: 50000,
            type: "income",
            balance: 104831.96,
            branch: "RTGS HUB",
            transactionType: "NEFT",
        });

        // Branch never leaks into payee/description or reference.
        expect(first.description).not.toContain(
            "BOPAL"
        );
        expect(
            first.referenceNumber
        ).toBeNull();

        expect(result.validation.valid).toBe(
            true
        );

        expect(result.validation.errors).toEqual(
            []
        );
    });

    it("still reports a genuinely malformed row inside the transaction body as a validation error, rather than dropping it", () => {
        const result = processCsv(
            [
                "Tran Date,Transaction Particulars,Amount(INR),DR|CR",
                "01-08-2026,ACH-DR-KOTAKMAHPRIMELTKKBK,9260.00,DR",
                // Same column count as the header/table (still part of
                // the structural run) but the date is garbled - this is a
                // malformed transaction, not trailing footer text, and
                // must still surface as a row-level error.
                "NOT-A-DATE,Garbled Row,not-a-number,DR",
                "02-08-2026,NEFT/IN42621556482010,50000.00,CR",
                '"Unless the constituent notifies the bank immediately, this statement stands correct."',
            ].join("\n")
        );

        expect(result.candidates).toHaveLength(
            3
        );

        const [first, second, third] =
            result.candidates;

        expect(first.amount).toBe(9260);
        expect(third.amount).toBe(50000);

        expect(second.transactionDate).toBeNull();
        expect(second.amount).toBeNull();

        expect(result.validation.valid).toBe(
            false
        );

        expect(
            result.validation.errors.every(
                error =>
                    error.rowNumber ===
                    second.rowNumber
            )
        ).toBe(true);
    });

    it("handles quoted CSV fields correctly", () => {
        const result = processCsv(
            [
                "Date,Description,Amount,Type",
                '21/08/2026,"Amazon, India",1250,Debit',
            ].join("\n")
        );

        expect(
            result.candidates[0]?.description
        ).toBe("Amazon, India");

        expect(
            result.candidates[0]?.payee
        ).toBe("Amazon, India");
    });
});

// Manual "Transaction ID" mapping (see MAPPING_FIELD_OPTIONS in
// ImportsPage.tsx) - mirrors the "Detected Mapping" UI flow: a document
// is parsed/auto-detected once, then re-normalized against a
// user-edited mapping via processDocumentWithMapping, exactly as
// ImportsPage's handleMappingChange does.
describe("Transaction ID (externalTransactionId) manual mapping", () => {
    it("survives preview -> mapping change -> re-normalization: Tran. Id -> Transaction ID, Transaction Date -> Date, Value Date -> Ignore", () => {
        const document = parseCsv(
            [
                "Tran. Id,Transaction Date,Value Date,Description,Amount",
                "TXN001,21/08/2026,22/08/2026,Amazon,1250.50",
            ].join("\n")
        );

        const result = processDocumentWithMapping(
            document,
            {
                externalTransactionId: "Tran. Id",
                date: "Transaction Date",
                description: "Description",
                amount: "Amount",
                // Value Date intentionally left unmapped ("Ignore").
            },
            "BANK_CSV"
        );

        expect(
            result.candidates[0]?.externalTransactionId
        ).toBe("TXN001");

        expect(
            result.candidates[0]?.transactionDate
        ).toBe("2026-08-21");

        expect(
            result.candidates[0]?.referenceNumber
        ).toBeNull();

        expect(result.validation.valid).toBe(true);
    });

    it("is never auto-detected - a literal 'Transaction Id' header is still auto-mapped to referenceNumber, exactly as before", () => {
        const document = parseCsv(
            [
                "Transaction Id,Date,Description,Amount",
                "TXN001,21/08/2026,Amazon,1250.50",
            ].join("\n")
        );

        const detection = detectCsvColumns(document);

        expect(detection.mapping.referenceNumber).toBe(
            "Transaction Id"
        );
        expect(
            detection.mapping.externalTransactionId
        ).toBeUndefined();

        const result = processCsv(
            [
                "Transaction Id,Date,Description,Amount",
                "TXN001,21/08/2026,Amazon,1250.50",
            ].join("\n")
        );

        expect(
            result.candidates[0]?.referenceNumber
        ).toBe("TXN001");
        expect(
            result.candidates[0]?.externalTransactionId
        ).toBeNull();
    });

    it("leaves externalTransactionId null when unmapped, without affecting any other field", () => {
        const document = parseCsv(
            [
                "Date,Description,Amount",
                "21/08/2026,Amazon,1250.50",
            ].join("\n")
        );

        const result = processDocumentWithMapping(
            document,
            {
                date: "Date",
                description: "Description",
                amount: "Amount",
            },
            "BANK_CSV"
        );

        expect(
            result.candidates[0]?.externalTransactionId
        ).toBeNull();
        expect(result.candidates[0]?.amount).toBe(1250.5);
        expect(result.validation.valid).toBe(true);
    });
});
