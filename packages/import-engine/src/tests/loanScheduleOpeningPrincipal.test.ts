import { describe, expect, it } from "vitest";

import { processLoanScheduleCsv } from "../pipeline";

// A lender's official repayment schedule in its usual shape: opening and
// closing principal per instalment, Indian number formatting, DD-MM-YYYY.
describe("processLoanScheduleCsv - opening principal and lender header spellings", () => {
    it("detects Instalment / Opening Balance / Closing Balance columns and keeps the lender's opening figure", () => {
        const result = processLoanScheduleCsv(
            [
                "Instalment No,EMI Date,Opening Balance,EMI Amount,Principal Component,Interest Component,Closing Balance",
                '1,05-03-2026,"7,50,000.00","8,291.00","1,728.50","6,562.50","7,48,271.50"',
                '2,05-04-2026,"7,48,271.50","8,291.00","1,743.62","6,547.38","7,46,527.88"',
            ].join("\n")
        );

        expect(result.mapping).toEqual({
            installmentNumber: "Instalment No",
            dueDate: "EMI Date",
            openingPrincipal: "Opening Balance",
            emi: "EMI Amount",
            principal: "Principal Component",
            interest: "Interest Component",
            outstandingBalance: "Closing Balance",
        });
        expect(result.missingRequiredFields).toEqual([]);
        expect(result.validation.valid).toBe(true);

        expect(result.candidates.map(row => [row.installmentNumber, row.dueDate, row.openingPrincipal, row.outstandingPrincipal])).toEqual([
            [1, "2026-03-05", 750000, 748271.50],
            [2, "2026-04-05", 748271.50, 746527.88],
        ]);
    });

    it("leaves openingPrincipal null when the file has no opening column", () => {
        const result = processLoanScheduleCsv(
            ["Installment No,Due Date,EMI,Principal,Interest,Outstanding Principal", "1,2026-03-05,100,90,10,910"].join("\n")
        );

        expect(result.mapping.openingPrincipal).toBeUndefined();
        expect(result.candidates[0]!.openingPrincipal).toBeNull();
    });
});
