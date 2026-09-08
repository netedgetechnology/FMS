import {
    describe,
    expect,
    it,
} from "vitest";

import {
    normalizeLoanScheduleRows,
} from "../normalizer/loanScheduleNormalizer";

import {
    validateLoanScheduleCandidates,
} from "../validation/loanScheduleValidator";

import type {
    CsvDocument,
} from "../types";

describe("normalizeLoanScheduleRows", () => {
    const document: CsvDocument = {
        headers: [
            "Installment No",
            "Due Date",
            "EMI",
            "Principal",
            "Interest",
            "Outstanding Principal",
            "Loan Number",
            "Description",
        ],
        rows: [
            {
                rowNumber: 2,
                values: [
                    "1",
                    "15/09/2026",
                    "49,312.00",
                    "45,000.00",
                    "4,312.00",
                    "455,000.00",
                    "LN-12345",
                    "Monthly EMI",
                ],
            },
            {
                rowNumber: 3,
                values: [
                    "2",
                    "15/10/2026",
                    "49,312.00",
                    "45,500.00",
                    "3,812.00",
                    "409,500.00",
                    "LN-12345",
                    "Monthly EMI",
                ],
            },
        ],
    };

    const mapping = {
        installmentNumber: "Installment No",
        dueDate: "Due Date",
        emi: "EMI",
        principal: "Principal",
        interest: "Interest",
        outstandingPrincipal: "Outstanding Principal",
        loanNumber: "Loan Number",
        description: "Description",
    };

    it("normalizes a loan schedule CSV", () => {
        const result =
            normalizeLoanScheduleRows(
                document,
                mapping
            );

        expect(result).toHaveLength(2);

        expect(result[0]).toMatchObject({
            rowNumber: 2,
            installmentNumber: 1,
            dueDate: "2026-09-15",
            paymentDate: null,
            emi: 49312,
            principal: 45000,
            interest: 4312,
            outstandingPrincipal: 455000,
            loanNumber: "LN-12345",
            description: "Monthly EMI",
        });
    });

    it("preserves raw CSV data", () => {
        const result =
            normalizeLoanScheduleRows(
                document,
                mapping
            );

        expect(
            result[0].rawData["EMI"]
        ).toBe("49,312.00");
    });

    it("handles parenthesized monetary values", () => {
        const negativeDocument: CsvDocument = {
            headers: [
                "Due Date",
                "EMI",
                "Principal",
                "Interest",
                "Outstanding Balance",
            ],
            rows: [
                {
                    rowNumber: 2,
                    values: [
                        "2026-09-15",
                        "(49,312.00)",
                        "45,000.00",
                        "4,312.00",
                        "455,000.00",
                    ],
                },
            ],
        };

        const result =
            normalizeLoanScheduleRows(
                negativeDocument,
                {
                    dueDate: "Due Date",
                    emi: "EMI",
                    principal: "Principal",
                    interest: "Interest",
                    outstandingBalance:
                        "Outstanding Balance",
                }
            );

        expect(result[0].emi).toBe(-49312);
        expect(result[0].outstandingPrincipal)
            .toBe(455000);
    });

    it("returns null for invalid dates and amounts", () => {
        const invalidDocument: CsvDocument = {
            headers: [
                "Due Date",
                "EMI",
                "Principal",
                "Interest",
                "Outstanding Balance",
            ],
            rows: [
                {
                    rowNumber: 2,
                    values: [
                        "not-a-date",
                        "abc",
                        "xyz",
                        "",
                        "invalid",
                    ],
                },
            ],
        };

        const result =
            normalizeLoanScheduleRows(
                invalidDocument,
                {
                    dueDate: "Due Date",
                    emi: "EMI",
                    principal: "Principal",
                    interest: "Interest",
                    outstandingBalance:
                        "Outstanding Balance",
                }
            );

        expect(result[0].dueDate).toBeNull();
        expect(result[0].emi).toBeNull();
        expect(result[0].principal).toBeNull();
        expect(result[0].interest).toBeNull();
        expect(result[0].outstandingPrincipal)
            .toBeNull();
    });
});

describe("validateLoanScheduleCandidates", () => {
    it("accepts a complete loan schedule row", () => {
        const result =
            validateLoanScheduleCandidates([
                {
                    rowNumber: 2,
                    installmentNumber: 1,
                    dueDate: "2026-09-15",
                    paymentDate: null,
                    emi: 49312,
                    principal: 45000,
                    interest: 4312,
                    outstandingPrincipal: 455000,
                    loanNumber: "LN-12345",
                    description: "Monthly EMI",
                    referenceNumber: null,
                    rawData: {},
                },
            ]);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it("rejects incomplete loan schedule rows", () => {
        const result =
            validateLoanScheduleCandidates([
                {
                    rowNumber: 2,
                    installmentNumber: 1,
                    dueDate: null,
                    paymentDate: null,
                    emi: null,
                    principal: null,
                    interest: null,
                    outstandingPrincipal: null,
                    loanNumber: null,
                    description: "",
                    referenceNumber: null,
                    rawData: {},
                },
            ]);

        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(5);
    });
});
