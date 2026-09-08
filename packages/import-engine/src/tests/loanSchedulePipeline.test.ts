import {
    describe,
    expect,
    it,
} from "vitest";

import {
    processLoanScheduleCsv,
} from "../pipeline";

describe("processLoanScheduleCsv", () => {
    it("processes a loan schedule CSV end-to-end", () => {
        const result =
            processLoanScheduleCsv(
                [
                    "Installment No,Due Date,EMI,Principal,Interest,Outstanding Principal,Loan Number,Description,Reference",
                    '1,15/09/2026,"49,312.00","45,000.00","4,312.00","455,000.00",LN-12345,Monthly EMI,EMI001',
                    '2,15/10/2026,"49,312.00","45,500.00","3,812.00","409,500.00",LN-12345,Monthly EMI,EMI002',
                ].join("\n"),
            );

        expect(result.document.headers).toEqual([
            "Installment No",
            "Due Date",
            "EMI",
            "Principal",
            "Interest",
            "Outstanding Principal",
            "Loan Number",
            "Description",
            "Reference",
        ]);

        expect(result.mapping).toEqual({
            installmentNumber: "Installment No",
            dueDate: "Due Date",
            emi: "EMI",
            principal: "Principal",
            interest: "Interest",
            outstandingPrincipal: "Outstanding Principal",
            loanNumber: "Loan Number",
            description: "Description",
            referenceNumber: "Reference",
        });

        expect(result.candidates).toHaveLength(2);

        expect(result.candidates[0]).toMatchObject({
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
            referenceNumber: "EMI001",
        });

        expect(result.candidates[1]).toMatchObject({
            rowNumber: 3,
            installmentNumber: 2,
            dueDate: "2026-10-15",
            emi: 49312,
            principal: 45500,
            interest: 3812,
            outstandingPrincipal: 409500,
        });

        expect(result.validation.valid).toBe(true);
        expect(result.validation.errors).toEqual([]);
        expect(result.missingRequiredFields).toEqual([]);
        expect(result.ambiguousFields).toEqual([]);
    });

    it("supports payment date instead of due date", () => {
        const result =
            processLoanScheduleCsv(
                [
                    "Installment,Payment Date,EMI,Principal,Interest,Outstanding Balance",
                    "1,15/09/2026,49312,45000,4312,455000",
                ].join("\n"),
            );

        expect(result.mapping).toEqual({
            installmentNumber: "Installment",
            paymentDate: "Payment Date",
            emi: "EMI",
            principal: "Principal",
            interest: "Interest",
            outstandingBalance: "Outstanding Balance",
        });

        expect(result.candidates[0]).toMatchObject({
            installmentNumber: 1,
            dueDate: null,
            paymentDate: "2026-09-15",
            emi: 49312,
            principal: 45000,
            interest: 4312,
            outstandingPrincipal: 455000,
        });

        expect(result.validation.valid).toBe(true);
    });

    it("reports missing loan schedule columns", () => {
        const result =
            processLoanScheduleCsv(
                [
                    "Installment,Due Date,EMI",
                    "1,15/09/2026,49312",
                ].join("\n"),
            );

        expect(result.missingRequiredFields).toContain("principal");
        expect(result.missingRequiredFields).toContain("interest");
        expect(result.missingRequiredFields).toContain("outstandingBalance");
    });
});
