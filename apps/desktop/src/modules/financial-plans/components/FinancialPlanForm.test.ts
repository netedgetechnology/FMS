import { describe, expect, it } from "vitest";

import {
    resolveDefaultCurrencyId,
    shouldApplyFallbackCurrency,
} from "./FinancialPlanForm";

const INR = { id: "cur-inr", code: "INR" };
const USD = { id: "cur-usd", code: "USD" };
const EUR = { id: "cur-eur", code: "EUR" };

describe("resolveDefaultCurrencyId", () => {
    it("new Financial Plan defaults to the application's configured default currency (INR in the current app context), not currencies[0]/USD", () => {
        // currencies[0] is USD here on purpose - reproduces the reported
        // bug shape (list order happens to put USD first) to prove the
        // fix reads Settings' default currency instead of list order.
        const currencies = [USD, INR, EUR];

        expect(
            resolveDefaultCurrencyId(currencies, "INR")
        ).toBe(INR.id);
    });

    it("resolves the current app default (INR) to INR specifically", () => {
        expect(
            resolveDefaultCurrencyId([INR, USD, EUR], "INR")
        ).toBe(INR.id);
    });

    it("follows the global default currency setting rather than hard-coding INR - proves it isn't a hard-coded 'INR' string", () => {
        // If the application's configured default currency were changed
        // to USD (Settings > General), the plan form must follow that
        // setting, not a hard-coded INR.
        expect(
            resolveDefaultCurrencyId([INR, USD, EUR], "USD")
        ).toBe(USD.id);

        expect(
            resolveDefaultCurrencyId([INR, USD, EUR], "EUR")
        ).toBe(EUR.id);
    });

    it("falls back to empty string when no currency matches the configured default", () => {
        expect(
            resolveDefaultCurrencyId([USD, EUR], "INR")
        ).toBe("");
    });
});

describe("shouldApplyFallbackCurrency", () => {
    it("applies the fallback for a brand-new plan with nothing selected yet", () => {
        expect(
            shouldApplyFallbackCurrency(
                undefined,
                "",
                INR.id
            )
        ).toBe(true);
    });

    it("preserves a manually selected currency - does not override USD/EUR/etc. once the user has picked one", () => {
        expect(
            shouldApplyFallbackCurrency(
                undefined,
                USD.id,
                INR.id
            )
        ).toBe(false);
    });

    it("preserves an existing/editing plan's stored currency", () => {
        expect(
            shouldApplyFallbackCurrency(
                USD.id,
                "",
                INR.id
            )
        ).toBe(false);

        expect(
            shouldApplyFallbackCurrency(
                USD.id,
                USD.id,
                INR.id
            )
        ).toBe(false);
    });

    it("does not fire before the fallback currency has resolved to anything real", () => {
        expect(
            shouldApplyFallbackCurrency(undefined, "", "")
        ).toBe(false);
    });
});
