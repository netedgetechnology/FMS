import { describe, expect, it } from "vitest";

import {
    processCsv,
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
