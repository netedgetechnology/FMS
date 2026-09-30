import { describe, expect, it } from "vitest";

import { loanSchema } from "./loanSchema";
import { optionalNumberValue } from "../components/LoanForm";

// Regression: Tenure is optional in the schema, but leaving it blank in
// the Add Loan form used to fail with "Invalid input: expected number,
// received NaN" before the user had entered any loan data. Root cause:
// react-hook-form's `valueAsNumber` reads the native <input>'s own
// `.valueAsNumber`, which is NaN (not undefined) for a blank number
// input - see optionalNumberValue in LoanForm.tsx for the fix.

function validLoanInput() {
    return {
        name: "HDFC Home Loan",
        loanType: "Home Loan",
        currencyId: "INR",
        principalAmount: 1000000,
        interestRate: 8.5,
        interestType: "REDUCING" as const,
        startDate: "2026-01-01",
        outstandingPrincipal: 1000000,
        outstandingInterest: 0,
        status: "ACTIVE" as const,
    };
}

describe("optionalNumberValue (blank -> undefined, not NaN)", () => {
    it("represents a blank input as undefined", () => {
        expect(optionalNumberValue("")).toBeUndefined();
    });

    it("parses an entered numeric string as a number", () => {
        expect(optionalNumberValue("12")).toBe(12);
    });
});

describe("loanSchema - Tenure (optional numeric field)", () => {
    it("1. accepts a blank/omitted Tenure", () => {
        const result = loanSchema.safeParse(
            validLoanInput()
        );

        expect(result.success).toBe(true);
        if (result.success) {
            expect(
                result.data.tenureMonths
            ).toBeUndefined();
        }
    });

    it("1b. accepts Tenure represented as undefined (the fixed blank-input value)", () => {
        const result = loanSchema.safeParse({
            ...validLoanInput(),
            tenureMonths: undefined,
        });

        expect(result.success).toBe(true);
    });

    it("2. accepts a valid Tenure number", () => {
        const result = loanSchema.safeParse({
            ...validLoanInput(),
            tenureMonths: 24,
        });

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.tenureMonths).toBe(24);
        }
    });

    it("3. still rejects an invalid numeric Tenure (zero)", () => {
        const result = loanSchema.safeParse({
            ...validLoanInput(),
            tenureMonths: 0,
        });

        expect(result.success).toBe(false);
    });

    it("3b. still rejects an invalid numeric Tenure (negative)", () => {
        const result = loanSchema.safeParse({
            ...validLoanInput(),
            tenureMonths: -5,
        });

        expect(result.success).toBe(false);
    });

    it("3c. still rejects a non-numeric Tenure", () => {
        const result = loanSchema.safeParse({
            ...validLoanInput(),
            tenureMonths: "not-a-number",
        });

        expect(result.success).toBe(false);
    });

    it("4. leaves existing required-field validation unchanged", () => {
        const missingName = loanSchema.safeParse({
            ...validLoanInput(),
            name: "",
        });

        expect(missingName.success).toBe(false);

        const missingPrincipal = loanSchema.safeParse({
            ...validLoanInput(),
            principalAmount: 0,
        });

        expect(missingPrincipal.success).toBe(false);

        const validAsBefore = loanSchema.safeParse(
            validLoanInput()
        );

        expect(validAsBefore.success).toBe(true);
    });
});
