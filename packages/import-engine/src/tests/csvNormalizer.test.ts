import { describe, expect, it } from "vitest";

import {
    normalizeCsvRows,
} from "../normalizer/csvNormalizer";

describe("normalizeCsvRows", () => {
    it("normalizes a standard bank CSV", () => {
        const result = normalizeCsvRows(
            [
                {
                    rowNumber: 2,
                    values: [
                        "21/08/2026",
                        "Amazon",
                        "1,250.50",
                        "Debit",
                        "REF001",
                    ],
                },
            ],
            {
                date: "Date",
                description: "Description",
                amount: "Amount",
                type: "Type",
                referenceNumber: "Reference",
            },
            [
                "Date",
                "Description",
                "Amount",
                "Type",
                "Reference",
            ]
        );

        expect(result[0]).toEqual({
            rowNumber: 2,
            transactionDate: "2026-08-21",
            payee: "Amazon",
            description: "Amazon",
            amount: 1250.5,
            type: "expense",
            referenceNumber: "REF001",
            rawData: {
                Date: "21/08/2026",
                Description: "Amazon",
                Amount: "1,250.50",
                Type: "Debit",
                Reference: "REF001",
            },
        });
    });

    it("uses withdrawal as expense", () => {
        const result = normalizeCsvRows(
            [
                {
                    rowNumber: 2,
                    values: [
                        "21/08/2026",
                        "ATM",
                        "5,000.00",
                        "",
                    ],
                },
            ],
            {
                date: "Date",
                description: "Description",
                debit: "Withdrawal",
            },
            [
                "Date",
                "Description",
                "Withdrawal",
            ]
        );

        expect(result[0]?.amount).toBe(5000);
        expect(result[0]?.type).toBe(
            "expense"
        );
    });

    it("uses deposit as income", () => {
        const result = normalizeCsvRows(
            [
                {
                    rowNumber: 2,
                    values: [
                        "21-08-2026",
                        "Salary",
                        "",
                        "75,000",
                    ],
                },
            ],
            {
                date: "Date",
                description: "Description",
                debit: "Withdrawal",
                credit: "Deposit",
            },
            [
                "Date",
                "Description",
                "Withdrawal",
                "Deposit",
            ]
        );

        expect(result[0]?.amount).toBe(75000);
        expect(result[0]?.type).toBe(
            "income"
        );
    });

    it("uses merchant as payee", () => {
        const result = normalizeCsvRows(
            [
                {
                    rowNumber: 2,
                    values: [
                        "2026-08-21",
                        "Flipkart",
                        "899",
                    ],
                },
            ],
            {
                date: "Date",
                payee: "Merchant",
                amount: "Amount",
            },
            [
                "Date",
                "Merchant",
                "Amount",
            ]
        );

        expect(result[0]?.payee).toBe(
            "Flipkart"
        );

        expect(result[0]?.description).toBe(
            ""
        );
    });

    it("falls back to description when payee is empty", () => {
        const result = normalizeCsvRows(
            [
                {
                    rowNumber: 2,
                    values: [
                        "2026-08-21",
                        "UPI PAYMENT",
                        "250",
                    ],
                },
            ],
            {
                date: "Date",
                description: "Description",
                amount: "Amount",
            },
            [
                "Date",
                "Description",
                "Amount",
            ]
        );

        expect(result[0]?.payee).toBe(
            "UPI PAYMENT"
        );

        expect(result[0]?.description).toBe(
            "UPI PAYMENT"
        );
    });

    it("normalizes currency and parenthesized amounts", () => {
        const result = normalizeCsvRows(
            [
                {
                    rowNumber: 2,
                    values: [
                        "2026-08-21",
                        "Purchase",
                        "(₹1,250.75)",
                    ],
                },
            ],
            {
                date: "Date",
                description: "Description",
                amount: "Amount",
            },
            [
                "Date",
                "Description",
                "Amount",
            ]
        );

        expect(result[0]?.amount).toBe(
            1250.75
        );

        expect(result[0]?.type).toBe(
            "expense"
        );
    });

    it("normalizes two-digit years", () => {
        const result = normalizeCsvRows(
            [
                {
                    rowNumber: 2,
                    values: [
                        "21/08/26",
                        "Test",
                        "100",
                    ],
                },
            ],
            {
                date: "Date",
                description: "Description",
                amount: "Amount",
            },
            [
                "Date",
                "Description",
                "Amount",
            ]
        );

        expect(
            result[0]?.transactionDate
        ).toBe("2026-08-21");
    });

    it("preserves complete raw CSV data", () => {
        const result = normalizeCsvRows(
            [
                {
                    rowNumber: 7,
                    values: [
                        "2026-08-21",
                        "Merchant",
                        "100",
                        "Extra value",
                    ],
                },
            ],
            {
                date: "Date",
                payee: "Merchant",
                amount: "Amount",
            },
            [
                "Date",
                "Merchant",
                "Amount",
                "Extra",
            ]
        );

        expect(result[0]?.rawData).toEqual({
            Date: "2026-08-21",
            Merchant: "Merchant",
            Amount: "100",
            Extra: "Extra value",
        });
    });

    it("treats a negative explicit amount as a credit-card expense", () => {
        const result = normalizeCsvRows(
            [
                {
                    rowNumber: 2,
                    values: [
                        "2026-08-21",
                        "Amazon",
                        "-1250.50",
                    ],
                },
            ],
            {
                date: "Date",
                description: "Description",
                amount: "Amount",
            },
            [
                "Date",
                "Description",
                "Amount",
            ],
            "CREDIT_CARD_CSV"
        );

        expect(result[0]?.amount).toBe(1250.5);
        expect(result[0]?.type).toBe(
            "expense"
        );
    });

    it("treats a positive explicit amount as credit-card income", () => {
        const result = normalizeCsvRows(
            [
                {
                    rowNumber: 2,
                    values: [
                        "2026-08-21",
                        "Refund",
                        "750",
                    ],
                },
            ],
            {
                date: "Date",
                description: "Description",
                amount: "Amount",
            },
            [
                "Date",
                "Description",
                "Amount",
            ],
            "CREDIT_CARD_CSV"
        );

        expect(result[0]?.amount).toBe(750);
        expect(result[0]?.type).toBe(
            "income"
        );
    });
    it("returns null for invalid dates and amounts", () => {
        const result = normalizeCsvRows(
            [
                {
                    rowNumber: 2,
                    values: [
                        "not-a-date",
                        "Unknown",
                        "not-an-amount",
                    ],
                },
            ],
            {
                date: "Date",
                description: "Description",
                amount: "Amount",
            },
            [
                "Date",
                "Description",
                "Amount",
            ]
        );

        expect(
            result[0]?.transactionDate
        ).toBeNull();

        expect(
            result[0]?.amount
        ).toBeNull();

        expect(
            result[0]?.type
        ).toBeNull();
    });
});

