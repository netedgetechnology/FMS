import { describe, expect, it } from "vitest";

import {
    computeHeaderSignature,
} from "../mapping/mappingSignature";

describe("computeHeaderSignature", () => {
    it("is stable regardless of header order", () => {
        const a = computeHeaderSignature(
            [
                "Tran Date",
                "Value Date",
                "Amount(INR)",
                "DR|CR",
            ],
            "BANK_CSV"
        );

        const b = computeHeaderSignature(
            [
                "DR|CR",
                "Amount(INR)",
                "Tran Date",
                "Value Date",
            ],
            "BANK_CSV"
        );

        expect(a).toBe(b);
    });

    it("is case- and whitespace-insensitive", () => {
        const a = computeHeaderSignature(
            ["Tran Date", "Amount(INR)"],
            "BANK_CSV"
        );

        const b = computeHeaderSignature(
            ["  tran   date  ", "AMOUNT(INR)"],
            "BANK_CSV"
        );

        expect(a).toBe(b);
    });

    it("differs when the header set genuinely differs (different statement format)", () => {
        const axisSavings = computeHeaderSignature(
            [
                "Tran Date",
                "Transaction Particulars",
                "Amount(INR)",
                "DR|CR",
            ],
            "BANK_CSV"
        );

        const axisCreditCard = computeHeaderSignature(
            [
                "Transaction Date",
                "Merchant",
                "Amount",
                "Type",
            ],
            "BANK_CSV"
        );

        expect(axisSavings).not.toBe(
            axisCreditCard
        );
    });

    it("differs by import type even with identical headers", () => {
        const bankCsv = computeHeaderSignature(
            ["Date", "Description", "Amount"],
            "BANK_CSV"
        );

        const creditCardCsv = computeHeaderSignature(
            ["Date", "Description", "Amount"],
            "CREDIT_CARD_CSV"
        );

        expect(bankCsv).not.toBe(
            creditCardCsv
        );
    });
});
