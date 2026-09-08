import { describe, expect, it } from "vitest";

import {
    detectCsvColumns,
} from "../parser/columnDetector";

describe("detectCsvColumns", () => {
    it("detects a standard bank CSV", () => {
        const result = detectCsvColumns({
            headers: [
                "Date",
                "Description",
                "Debit",
                "Credit",
                "Reference",
            ],
            rows: [],
        });

        expect(result.mapping).toEqual({
            date: "Date",
            description: "Description",
            debit: "Debit",
            credit: "Credit",
            referenceNumber: "Reference",
        });

        expect(
            result.missingRequiredFields
        ).toEqual([]);

        expect(
            result.ambiguousFields
        ).toEqual([]);
    });

    it("detects common Indian bank headers", () => {
        const result = detectCsvColumns({
            headers: [
                "Transaction Date",
                "Narration",
                "Withdrawal",
                "Deposit",
                "UTR",
            ],
            rows: [],
        });

        expect(result.mapping).toEqual({
            date: "Transaction Date",
            description: "Narration",
            debit: "Withdrawal",
            credit: "Deposit",
            referenceNumber: "UTR",
        });
    });

    it("detects abbreviated bank headers using fallback detection", () => {
        const result = detectCsvColumns({
            headers: [
                "Tran Date",
                "Txn Desc",
                "Withdrawal Amt.",
                "Deposit Amt.",
                "Chq/Ref No.",
            ],
            rows: [],
        });

        expect(result.mapping.date).toBe(
            "Tran Date"
        );

        expect(
            result.mapping.description
        ).toBe("Txn Desc");

        expect(result.mapping.debit).toBe(
            "Withdrawal Amt."
        );

        expect(result.mapping.credit).toBe(
            "Deposit Amt."
        );

        expect(
            result.mapping.referenceNumber
        ).toBe("Chq/Ref No.");
    });

    it("detects merchant and amount based CSV", () => {
        const result = detectCsvColumns({
            headers: [
                "Date",
                "Merchant",
                "Amount",
                "Type",
                "Transaction ID",
            ],
            rows: [],
        });

        expect(result.mapping).toEqual({
            date: "Date",
            payee: "Merchant",
            amount: "Amount",
            type: "Type",
            referenceNumber:
                "Transaction ID",
        });
    });

    it("reports duplicate amount columns as ambiguous", () => {
        const result = detectCsvColumns({
            headers: [
                "Date",
                "Description",
                "Amount",
                "Transaction Amount",
            ],
            rows: [],
        });

        expect(
            result.ambiguousFields
        ).toContain("amount");

        expect(
            result.mapping.amount
        ).toBe("Amount");
    });

    it("reports missing required fields", () => {
        const result = detectCsvColumns({
            headers: [
                "Date",
                "Reference",
            ],
            rows: [],
        });

        expect(
            result.missingRequiredFields
        ).toContain("description");

        expect(
            result.missingRequiredFields
        ).toContain("amount");
    });

    it("detects currency-suffixed headers (e.g. Axis Bank export)", () => {
        const result = detectCsvColumns({
            headers: [
                "Tran Date",
                "Value Date",
                "CHQNO",
                "Transaction Particulars",
                "Amount(INR)",
                "DR|CR",
                "Balance(INR)",
                "Branch Name",
            ],
            rows: [],
        });

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

        expect(
            result.missingRequiredFields
        ).toEqual([]);
    });

    it("detects common branch-header variants generically (no bank-specific logic)", () => {
        expect(
            detectCsvColumns({
                headers: [
                    "Date",
                    "Description",
                    "Amount",
                    "Branch",
                ],
                rows: [],
            }).mapping.branch
        ).toBe("Branch");

        expect(
            detectCsvColumns({
                headers: [
                    "Date",
                    "Description",
                    "Amount",
                    "Branch Name",
                ],
                rows: [],
            }).mapping.branch
        ).toBe("Branch Name");

        expect(
            detectCsvColumns({
                headers: [
                    "Date",
                    "Description",
                    "Amount",
                    "Branch Name/Location",
                ],
                rows: [],
            }).mapping.branch
        ).toBe("Branch Name/Location");

        expect(
            detectCsvColumns({
                headers: [
                    "Date",
                    "Description",
                    "Amount",
                    "Bank Branch",
                ],
                rows: [],
            }).mapping.branch
        ).toBe("Bank Branch");

        expect(
            detectCsvColumns({
                headers: [
                    "Date",
                    "Description",
                    "Amount",
                    "Branch Code",
                ],
                rows: [],
            }).mapping.branch
        ).toBe("Branch Code");
    });

    it("does not mistake unrelated '*Code'/'*Location' columns for Branch", () => {
        const result = detectCsvColumns({
            headers: [
                "Date",
                "Description",
                "Amount",
                "IFSC Code",
                "Cheque Number",
            ],
            rows: [],
        });

        expect(result.mapping.branch).toBeUndefined();
    });

    it("detects an explicit Transaction Type / Mode source column without colliding with the DR/CR Type field", () => {
        const result = detectCsvColumns({
            headers: [
                "Date",
                "Description",
                "Amount",
                "DR|CR",
                "Mode",
            ],
            rows: [],
        });

        expect(result.mapping.type).toBe(
            "DR|CR"
        );

        expect(
            result.mapping.transactionType
        ).toBe("Mode");
    });

    it("also recognizes 'Transaction Channel' as the Transaction Type source column", () => {
        const result = detectCsvColumns({
            headers: [
                "Date",
                "Description",
                "Amount",
                "Transaction Channel",
            ],
            rows: [],
        });

        expect(
            result.mapping.transactionType
        ).toBe("Transaction Channel");
    });

    it("prefers the higher-confidence exact match over a lower-confidence fallback for the same field", () => {
        const result = detectCsvColumns({
            headers: [
                "Tran Date",
                "Value Date",
                "Narration",
                "Amount",
            ],
            rows: [],
        });

        // "Value Date" is an exact (high-confidence) match while
        // "Tran Date" only matches via the fallback (medium-confidence)
        // pattern - the exact match should win outright, not be treated
        // as ambiguous.
        expect(result.mapping.date).toBe(
            "Value Date"
        );

        expect(
            result.ambiguousFields
        ).not.toContain("date");
    });

    it("detects a DR/CR type column and separate Debit/Credit headers independently", () => {
        const drCr = detectCsvColumns({
            headers: [
                "Date",
                "Narration",
                "Amount",
                "DR/CR",
            ],
            rows: [],
        });

        expect(drCr.mapping.type).toBe(
            "DR/CR"
        );

        const debitCredit = detectCsvColumns({
            headers: [
                "Date",
                "Narration",
                "Debit",
                "Credit",
            ],
            rows: [],
        });

        expect(debitCredit.mapping.debit).toBe(
            "Debit"
        );
        expect(debitCredit.mapping.credit).toBe(
            "Credit"
        );
        expect(
            debitCredit.mapping.type
        ).toBeUndefined();
    });

    it("does not let a generic amount fallback override a specific Withdrawal/Deposit Amt. match", () => {
        const result = detectCsvColumns({
            headers: [
                "Tran Date",
                "Txn Desc",
                "Withdrawal Amt.",
                "Deposit Amt.",
            ],
            rows: [],
        });

        expect(result.mapping.debit).toBe(
            "Withdrawal Amt."
        );
        expect(result.mapping.credit).toBe(
            "Deposit Amt."
        );
    });

    it("does not map unrelated headers", () => {
        const result = detectCsvColumns({
            headers: [
                "Account Number",
                "IFSC",
                "Currency",
            ],
            rows: [],
        });

        expect(result.mapping).toEqual({});

        expect(
            result.missingRequiredFields
        ).toEqual([
            "date",
            "description",
            "amount",
        ]);
    });

    // externalTransactionId (the manual-only "Transaction ID" mapping
    // option - see MAPPING_FIELD_OPTIONS in ImportsPage.tsx) is
    // deliberately absent from HEADER_RULES/FALLBACK_RULES, so it must
    // never be auto-detected - even from a header that literally reads
    // "Transaction ID" (which stays referenceNumber's, unchanged).
    it("never auto-detects externalTransactionId, even from a 'Transaction ID' header", () => {
        const result = detectCsvColumns({
            headers: [
                "Transaction ID",
                "Date",
                "Description",
                "Amount",
            ],
            rows: [],
        });

        expect(result.mapping.referenceNumber).toBe(
            "Transaction ID"
        );
        expect(
            result.mapping.externalTransactionId
        ).toBeUndefined();
    });
});
