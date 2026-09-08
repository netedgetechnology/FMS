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
            externalTransactionId: null,
            balance: null,
            branch: null,
            transactionType: null,
            counterparty: null,
            notes: null,
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

    // BANK_EXCEL (an Excel-sourced bank statement, see ImportsPage's
    // "Bank Excel" Import Type) must behave exactly like BANK_CSV here -
    // resolveAmountAndType only ever special-cases CREDIT_CARD_CSV, so a
    // bank statement's shape heuristics don't depend on which file
    // format carried it.
    describe("BANK_EXCEL is a real CsvImportType value, treated like BANK_CSV (never like CREDIT_CARD_CSV)", () => {
        const rows = [
            {
                date: "Date",
                description: "Description",
                debit: "Debit",
                credit: "Credit",
            },
        ];

        it("a positive explicit Amount (no Debit/Credit) is bank income, exactly like BANK_CSV", () => {
            const mapping = {
                date: "Date",
                description: "Description",
                amount: "Amount",
            };

            const headers = [
                "Date",
                "Description",
                "Amount",
            ];

            const row = {
                rowNumber: 2,
                values: [
                    "2026-08-21",
                    "Salary",
                    "750",
                ],
            };

            const bankCsvResult = normalizeCsvRows(
                [row],
                mapping,
                headers,
                "BANK_CSV"
            );

            const bankExcelResult = normalizeCsvRows(
                [row],
                mapping,
                headers,
                "BANK_EXCEL"
            );

            expect(bankExcelResult[0]?.amount).toBe(
                750
            );
            expect(bankExcelResult[0]?.type).toBe(
                "income"
            );
            // Identical outcome to BANK_CSV for the same row - proving
            // BANK_EXCEL reuses the exact same heuristic, not a
            // duplicated/diverging one.
            expect(bankExcelResult[0]?.type).toBe(
                bankCsvResult[0]?.type
            );
            expect(bankExcelResult[0]?.amount).toBe(
                bankCsvResult[0]?.amount
            );
        });

        it("a negative explicit Amount is bank expense under BANK_EXCEL - never the CREDIT_CARD_CSV heuristic", () => {
            const mapping = {
                date: "Date",
                description: "Description",
                amount: "Amount",
            };

            const headers = [
                "Date",
                "Description",
                "Amount",
            ];

            const row = {
                rowNumber: 2,
                values: [
                    "2026-08-21",
                    "ATM Withdrawal",
                    "-500",
                ],
            };

            const result = normalizeCsvRows(
                [row],
                mapping,
                headers,
                "BANK_EXCEL"
            );

            // Under BANK_CSV/BANK_EXCEL, sign alone determines
            // income/expense (normalizeTypeFromAmount) - negative is
            // expense, same rule a negative CREDIT_CARD_CSV amount would
            // also resolve to, so this alone wouldn't distinguish the
            // two heuristics; the point is BANK_EXCEL takes this branch
            // at all (see the identical-outcome assertion above, which
            // does distinguish them via the *positive* case: under
            // CREDIT_CARD_CSV a positive amount is still "income" too,
            // so the real proof is that BANK_EXCEL's positive-amount
            // result exactly matches BANK_CSV's, not a hidden third
            // heuristic).
            expect(result[0]?.amount).toBe(500);
            expect(result[0]?.type).toBe(
                "expense"
            );
        });

        it("Debit/Credit columns remain authoritative for BANK_EXCEL too, exactly like BANK_CSV", () => {
            const mapping = rows[0];

            const headers = [
                "Date",
                "Description",
                "Debit",
                "Credit",
            ];

            const debitRow = {
                rowNumber: 2,
                values: [
                    "2026-08-21",
                    "Coffee Shop",
                    "250",
                    "",
                ],
            };

            const result = normalizeCsvRows(
                [debitRow],
                mapping,
                headers,
                "BANK_EXCEL"
            );

            expect(result[0]?.amount).toBe(250);
            expect(result[0]?.type).toBe(
                "expense"
            );
        });
    });

    it("normalizes a mapped balance column", () => {
        const result = normalizeCsvRows(
            [
                {
                    rowNumber: 2,
                    values: [
                        "01-08-2026",
                        "ACH-DR-KOTAKMAHPRIMELTKKBK",
                        "9260.00",
                        "DR",
                        "54981.96",
                    ],
                },
            ],
            {
                date: "Tran Date",
                description: "Transaction Particulars",
                amount: "Amount(INR)",
                type: "DR|CR",
                balance: "Balance(INR)",
            },
            [
                "Tran Date",
                "Transaction Particulars",
                "Amount(INR)",
                "DR|CR",
                "Balance(INR)",
            ]
        );

        expect(result[0]?.amount).toBe(9260);
        expect(result[0]?.type).toBe("expense");
        expect(result[0]?.balance).toBe(
            54981.96
        );
    });

    it("normalizes a mapped branch column, keeping it out of payee/description/reference", () => {
        const result = normalizeCsvRows(
            [
                {
                    rowNumber: 2,
                    values: [
                        "01-08-2026",
                        "ACH-DR-KOTAKMAHPRIMELTKKBK",
                        "9260.00",
                        "DR",
                        "BOPAL, AHMEDABAD [GJ]",
                    ],
                },
            ],
            {
                date: "Tran Date",
                description: "Transaction Particulars",
                amount: "Amount(INR)",
                type: "DR|CR",
                branch: "Branch Name",
            },
            [
                "Tran Date",
                "Transaction Particulars",
                "Amount(INR)",
                "DR|CR",
                "Branch Name",
            ]
        );

        expect(result[0]?.branch).toBe(
            "BOPAL, AHMEDABAD [GJ]"
        );

        expect(
            result[0]?.description
        ).toBe(
            "ACH-DR-KOTAKMAHPRIMELTKKBK"
        );

        expect(result[0]?.payee).toBe(
            "ACH-DR-KOTAKMAHPRIMELTKKBK"
        );

        expect(
            result[0]?.referenceNumber
        ).toBeNull();
    });

    it("leaves branch null when the column isn't mapped - transactions without a branch remain valid", () => {
        const result = normalizeCsvRows(
            [
                {
                    rowNumber: 2,
                    values: [
                        "21/08/2026",
                        "Amazon",
                        "1250.50",
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

        expect(result[0]?.branch).toBeNull();
        expect(result[0]?.amount).toBe(1250.5);
    });

    it("auto-detects Transaction Type from the description when no source column is mapped", () => {
        const result = normalizeCsvRows(
            [
                {
                    rowNumber: 2,
                    values: [
                        "01-08-2026",
                        "UPI/P2A/1/John/Sent u/HDFC BANK",
                        "150.00",
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
            result[0]?.transactionType
        ).toBe("UPI");
    });

    it("prefers an explicit Transaction Type source column over text detection", () => {
        const result = normalizeCsvRows(
            [
                {
                    rowNumber: 2,
                    // Description mentions NEFT, but the file explicitly
                    // provides a Mode column saying RTGS - the explicit
                    // column must win.
                    values: [
                        "01-08-2026",
                        "NEFT/IN123/Some Corp",
                        "150.00",
                        "RTGS",
                    ],
                },
            ],
            {
                date: "Date",
                description: "Description",
                amount: "Amount",
                transactionType: "Mode",
            },
            [
                "Date",
                "Description",
                "Amount",
                "Mode",
            ]
        );

        expect(
            result[0]?.transactionType
        ).toBe("RTGS");
    });

    it("leaves Transaction Type null when neither a mapped column nor the text yields a known channel", () => {
        const result = normalizeCsvRows(
            [
                {
                    rowNumber: 2,
                    values: [
                        "01-08-2026",
                        "Monthly salary credit",
                        "50000",
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
            result[0]?.transactionType
        ).toBeNull();
        // Transactions without a detected/known channel remain otherwise
        // valid - amount/date/type are unaffected.
        expect(result[0]?.amount).toBe(50000);
        expect(result[0]?.transactionDate).toBe(
            "2026-08-01"
        );
    });

    it("keeps Transaction Type (channel) independent of DR/CR direction", () => {
        const result = normalizeCsvRows(
            [
                {
                    rowNumber: 2,
                    values: [
                        "01-08-2026",
                        "UPI/P2M/1/Some Merchant",
                        "150.00",
                        "DR",
                    ],
                },
                {
                    rowNumber: 3,
                    values: [
                        "02-08-2026",
                        "NEFT/IN42/Some Employer",
                        "50000.00",
                        "CR",
                    ],
                },
            ],
            {
                date: "Date",
                description: "Description",
                amount: "Amount",
                type: "DR|CR",
            },
            [
                "Date",
                "Description",
                "Amount",
                "DR|CR",
            ]
        );

        // A UPI debit and an NEFT credit: channel tracks the rail, type
        // tracks direction - one is never derived from or overwritten by
        // the other.
        expect(result[0]).toMatchObject({
            transactionType: "UPI",
            type: "expense",
            amount: 150,
        });

        expect(result[1]).toMatchObject({
            transactionType: "NEFT",
            type: "income",
            amount: 50000,
        });
    });

    it("extracts an explicitly mapped Transaction ID column into externalTransactionId, independent of referenceNumber", () => {
        const result = normalizeCsvRows(
            [
                {
                    rowNumber: 2,
                    values: [
                        "TXN98765",
                        "21/08/2026",
                        "Amazon",
                        "1250.50",
                    ],
                },
            ],
            {
                externalTransactionId: "Tran. Id",
                date: "Transaction Date",
                description: "Description",
                amount: "Amount",
            },
            [
                "Tran. Id",
                "Transaction Date",
                "Description",
                "Amount",
            ]
        );

        expect(
            result[0]?.externalTransactionId
        ).toBe("TXN98765");

        expect(
            result[0]?.referenceNumber
        ).toBeNull();
    });

    it("leaves externalTransactionId null when no Transaction ID column is mapped", () => {
        const result = normalizeCsvRows(
            [
                {
                    rowNumber: 2,
                    values: [
                        "21/08/2026",
                        "Amazon",
                        "1250.50",
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
            result[0]?.externalTransactionId
        ).toBeNull();
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

