import { describe, expect, it } from "vitest";

import { transactionSchema } from "./transactionSchema";

function validInput(
    overrides: Record<string, unknown> = {}
): Record<string, unknown> {
    return {
        accountId: "account-1",
        payee: "Grocery Store",
        type: "expense",
        amount: 500,
        transactionDate: "2026-08-01",
        status: "CLEARED",
        ...overrides,
    };
}

describe("transactionSchema - Category is intentionally optional", () => {
    it("accepts a transaction with categoryId entirely omitted", () => {
        const result = transactionSchema.safeParse(validInput());

        expect(result.success).toBe(true);
    });

    it("accepts a transaction with categoryId explicitly set to '' (the form's 'None' option)", () => {
        const result = transactionSchema.safeParse(
            validInput({ categoryId: "" })
        );

        expect(result.success).toBe(true);
    });

    it("still rejects Amount = 0, confirming Category's optionality isn't a broader validation gap", () => {
        const result = transactionSchema.safeParse(
            validInput({ amount: 0 })
        );

        expect(result.success).toBe(false);
    });

    it("still requires Account and Payee, confirming Category is deliberately the exception, not an oversight", () => {
        expect(
            transactionSchema.safeParse(
                validInput({ accountId: "" })
            ).success
        ).toBe(false);

        expect(
            transactionSchema.safeParse(
                validInput({ payee: "" })
            ).success
        ).toBe(false);
    });
});
