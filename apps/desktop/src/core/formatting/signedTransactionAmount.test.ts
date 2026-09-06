import { describe, expect, it } from "vitest";

import { signedTransactionAmount } from "./signedTransactionAmount";

describe("signedTransactionAmount", () => {
    it("negates an expense/debit amount", () => {
        expect(
            signedTransactionAmount(10005.9, "expense")
        ).toBe(-10005.9);
    });

    it("keeps an income/credit amount positive", () => {
        expect(
            signedTransactionAmount(11790.48, "income")
        ).toBe(11790.48);
    });

    it("never double-negates an already-negative stored amount for an expense", () => {
        // The stored amount is always a positive magnitude, but this must
        // stay idempotent even if a negative number is ever passed in.
        expect(
            signedTransactionAmount(-500, "expense")
        ).toBe(-500);
    });

    it("leaves a transfer's amount as plain magnitude - no invented sign", () => {
        expect(
            signedTransactionAmount(250, "transfer")
        ).toBe(250);
    });

    it("leaves an amount with no type (null) as plain magnitude", () => {
        expect(
            signedTransactionAmount(250, null)
        ).toBe(250);
    });

    it("leaves an amount with no type (undefined) as plain magnitude", () => {
        expect(
            signedTransactionAmount(250, undefined)
        ).toBe(250);
    });

    it("handles zero the same as any other amount of that type", () => {
        expect(
            Object.is(
                signedTransactionAmount(0, "expense"),
                -0
            )
        ).toBe(true);

        expect(
            signedTransactionAmount(0, "income")
        ).toBe(0);
    });
});
