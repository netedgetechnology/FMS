import { describe, expect, it } from "vitest";

import { resolveDefaultCurrencyId } from "./FinancialGoalForm";

const INR = { id: "cur-inr", code: "INR" };
const USD = { id: "cur-usd", code: "USD" };
const EUR = { id: "cur-eur", code: "EUR" };

describe("resolveDefaultCurrencyId", () => {
    it("new Financial Goal defaults to the application's configured default currency (INR), not currencies[0]/USD", () => {
        // currencies[0] is USD here on purpose - reproduces the reported
        // bug shape (the Add Financial Goal form defaulted to "USD - US
        // Dollar" via currencies.find(c => c.isDefault) / list order,
        // instead of the app's Settings > General default currency).
        const currencies = [USD, INR, EUR];

        expect(
            resolveDefaultCurrencyId(currencies, "INR")
        ).toBe(INR.id);
    });

    it("resolves the current app default (INR) to INR specifically", () => {
        expect(
            resolveDefaultCurrencyId(
                [INR, USD, EUR],
                "INR"
            )
        ).toBe(INR.id);
    });

    it("follows the global default currency setting rather than hard-coding INR", () => {
        // If the application's configured default currency were changed
        // to USD (Settings > General), the goal form must follow that
        // setting, not a hard-coded INR.
        expect(
            resolveDefaultCurrencyId(
                [INR, USD, EUR],
                "USD"
            )
        ).toBe(USD.id);

        expect(
            resolveDefaultCurrencyId(
                [INR, USD, EUR],
                "EUR"
            )
        ).toBe(EUR.id);
    });

    it("falls back to empty string when no currency matches the configured default - never currencies[0]", () => {
        expect(
            resolveDefaultCurrencyId([USD, EUR], "INR")
        ).toBe("");
    });
});
