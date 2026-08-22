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

    it("does not map unrelated headers", () => {
        const result = detectCsvColumns({
            headers: [
                "Account Number",
                "Branch",
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
});
