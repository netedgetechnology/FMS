import { describe, expect, it } from "vitest";

import {
    computeOutstandingLoanSummary,
    resolvePrimaryLoanCurrencyId,
} from "./loanCurrencyScope";

const INR = { id: "cur-inr", code: "INR", isDefault: true };
const USD = { id: "cur-usd", code: "USD", isDefault: false };
const EUR = { id: "cur-eur", code: "EUR", isDefault: false };

const currencies = [INR, USD, EUR];

describe("resolvePrimaryLoanCurrencyId", () => {
    it("returns the single currency when every loan shares one (the common, unaffected case)", () => {
        const result = resolvePrimaryLoanCurrencyId(
            [
                { currencyId: "cur-inr" },
                { currencyId: "cur-inr" },
            ],
            currencies
        );

        expect(result).toBe("cur-inr");
    });

    it("prefers the default currency when loans span more than one currency", () => {
        const result = resolvePrimaryLoanCurrencyId(
            [
                { currencyId: "cur-usd" },
                { currencyId: "cur-inr" },
                { currencyId: "cur-eur" },
            ],
            currencies
        );

        expect(result).toBe("cur-inr");
    });

    it("falls back to the alphabetically-first currency code when none of the loans use the default currency", () => {
        const result = resolvePrimaryLoanCurrencyId(
            [
                { currencyId: "cur-usd" },
                { currencyId: "cur-eur" },
            ],
            currencies
        );

        expect(result).toBe("cur-eur");
    });

    it("returns null for an empty loan list", () => {
        const result = resolvePrimaryLoanCurrencyId(
            [],
            currencies
        );

        expect(result).toBeNull();
    });
});

function loan(overrides: {
    currencyId: string;
    status?: string;
    outstandingPrincipal?: number;
}) {
    return {
        currencyId: overrides.currencyId,
        status: overrides.status ?? "ACTIVE",
        outstandingPrincipal:
            overrides.outstandingPrincipal ?? 0,
    };
}

describe("computeOutstandingLoanSummary", () => {
    it("sums outstanding principal across loans sharing one currency (unchanged from before)", () => {
        const result = computeOutstandingLoanSummary(
            [
                loan({
                    currencyId: "cur-inr",
                    outstandingPrincipal: 50000,
                }),
                loan({
                    currencyId: "cur-inr",
                    outstandingPrincipal: 25000,
                }),
            ],
            currencies
        );

        expect(result.outstandingPrincipal).toBe(75000);
        expect(result.currencyCode).toBe("INR");
        expect(result.hasOtherCurrencies).toBe(false);
    });

    it("scopes to the primary currency and flags hasOtherCurrencies for a mixed-currency loan list", () => {
        const result = computeOutstandingLoanSummary(
            [
                loan({
                    currencyId: "cur-inr",
                    outstandingPrincipal: 50000,
                }),
                loan({
                    currencyId: "cur-usd",
                    outstandingPrincipal: 10000,
                }),
            ],
            currencies
        );

        // Only the INR loan's 50000 - never summed with the USD
        // loan's 10000 as one meaningless number.
        expect(result.outstandingPrincipal).toBe(50000);
        expect(result.currencyCode).toBe("INR");
        expect(result.hasOtherCurrencies).toBe(true);
    });

    it("returns an empty, non-crashing summary for an empty loan list", () => {
        const result = computeOutstandingLoanSummary(
            [],
            currencies
        );

        expect(result.outstandingPrincipal).toBe(0);
        expect(result.currencyCode).toBeNull();
        expect(result.hasOtherCurrencies).toBe(false);
    });

    it("excludes CLOSED loans from the total and from currency-mix detection", () => {
        const result = computeOutstandingLoanSummary(
            [
                loan({
                    currencyId: "cur-inr",
                    outstandingPrincipal: 50000,
                    status: "ACTIVE",
                }),
                // A closed loan in a different currency with a
                // (data-entry-error) leftover balance must not be
                // summed in, and must not trigger the "other
                // currencies" note either.
                loan({
                    currencyId: "cur-usd",
                    outstandingPrincipal: 999,
                    status: "CLOSED",
                }),
            ],
            currencies
        );

        expect(result.outstandingPrincipal).toBe(50000);
        expect(result.currencyCode).toBe("INR");
        expect(result.hasOtherCurrencies).toBe(false);
    });

    it("returns an empty summary when every loan is CLOSED", () => {
        const result = computeOutstandingLoanSummary(
            [
                loan({
                    currencyId: "cur-inr",
                    outstandingPrincipal: 0,
                    status: "CLOSED",
                }),
            ],
            currencies
        );

        expect(result.outstandingPrincipal).toBe(0);
        expect(result.currencyCode).toBeNull();
        expect(result.hasOtherCurrencies).toBe(false);
    });
});
