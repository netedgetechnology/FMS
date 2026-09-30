import { describe, expect, it, vi } from "vitest";

import { submitLoanCreate } from "./AddLoanDialog";
import type { LoanFormValues } from "../validation";

// This repo has no jsdom / component-render test setup (vitest runs
// with environment: "node") - see DeletePlanComponentDialog.test.ts for
// the same convention - so the dialog's create-and-report-outcome logic
// is exercised through the exported pure function instead of rendering
// the dialog and clicking through it.
//
// Regression: creating a loan with the Linked Account left blank got
// permanently stuck on "Saving..." after a failed database write left
// a dangling transaction. Fixed at the transaction layer (see
// LoanService.create / src-tauri/src/loan_create.rs) so the create()
// promise always settles, and here so a settled-but-rejected promise
// is always turned into a resolved outcome the dialog's `finally` can
// act on - never a re-thrown error the dialog would have to remember
// to catch.

function values(
    overrides: Partial<LoanFormValues> = {}
): LoanFormValues {
    return {
        name: "Production Test Loan",
        loanType: "Home Loan",
        currencyId: "cur-inr",
        principalAmount: 10000,
        interestRate: 12,
        interestType: "REDUCING",
        tenureMonths: 12,
        startDate: "2026-09-20",
        outstandingPrincipal: 10000,
        outstandingInterest: 661.86,
        paidInstallments: 0,
        status: "ACTIVE",
        ...overrides,
    } as LoanFormValues;
}

describe("submitLoanCreate", () => {
    it("5. resolves with the new loan id on success, and calls onSuccess", async () => {
        const service = {
            create: vi.fn().mockResolvedValue("loan-1"),
        };
        const onSuccess = vi.fn().mockResolvedValue(undefined);

        const result = await submitLoanCreate(
            service,
            values(),
            onSuccess
        );

        expect(result).toEqual({
            success: true,
            loanId: "loan-1",
        });
        expect(onSuccess).toHaveBeenCalledTimes(1);
    });

    it("4. resolves (never throws) when the create call rejects, so a caller's finally always runs", async () => {
        const service = {
            create: vi
                .fn()
                .mockRejectedValue(
                    new Error("Loan tenure is required.")
                ),
        };

        // No try/catch here - a throw from submitLoanCreate itself
        // would fail this test, proving it always settles.
        const result = await submitLoanCreate(
            service,
            values(),
            undefined
        );

        expect(result.success).toBe(false);
    });

    it("surfaces the real underlying error even when it rejects with a plain string (the actual shape of a Tauri/SQL failure, not an Error instance)", async () => {
        const service = {
            create: vi
                .fn()
                .mockRejectedValue(
                    "FOREIGN KEY constraint failed"
                ),
        };

        const result = await submitLoanCreate(
            service,
            values(),
            undefined
        );

        expect(result).toEqual({
            success: false,
            message: "FOREIGN KEY constraint failed",
        });
    });

    it("falls back to a generic message only when the rejection carries no real text", async () => {
        const service = {
            create: vi.fn().mockRejectedValue(null),
        };

        const result = await submitLoanCreate(
            service,
            values(),
            undefined
        );

        expect(result).toEqual({
            success: false,
            message: "Failed to create loan. Please try again.",
        });
    });

    it("does not call onSuccess when create fails", async () => {
        const service = {
            create: vi
                .fn()
                .mockRejectedValue(new Error("boom")),
        };
        const onSuccess = vi.fn();

        await submitLoanCreate(service, values(), onSuccess);

        expect(onSuccess).not.toHaveBeenCalled();
    });
});
