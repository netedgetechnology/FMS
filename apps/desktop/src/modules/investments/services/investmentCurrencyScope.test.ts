import { describe, expect, it } from "vitest";

import {
    resolvePrimaryInvestmentCurrencyId,
} from "./investmentCurrencyScope";

const INR = { id: "cur-inr", code: "INR", isDefault: true };
const USD = { id: "cur-usd", code: "USD", isDefault: false };
const EUR = { id: "cur-eur", code: "EUR", isDefault: false };

const currencies = [INR, USD, EUR];

describe("resolvePrimaryInvestmentCurrencyId", () => {
    it("returns the single currency when every investment shares one (the common, unaffected case)", () => {
        const result = resolvePrimaryInvestmentCurrencyId(
            [
                { currencyId: "cur-inr" },
                { currencyId: "cur-inr" },
            ],
            currencies
        );

        expect(result).toBe("cur-inr");
    });

    it("prefers the default currency when investments span more than one currency", () => {
        const result = resolvePrimaryInvestmentCurrencyId(
            [
                { currencyId: "cur-usd" },
                { currencyId: "cur-inr" },
                { currencyId: "cur-eur" },
            ],
            currencies
        );

        expect(result).toBe("cur-inr");
    });

    it("falls back to the alphabetically-first currency code when none of the investments use the default currency", () => {
        const result = resolvePrimaryInvestmentCurrencyId(
            [
                { currencyId: "cur-usd" },
                { currencyId: "cur-eur" },
            ],
            currencies
        );

        expect(result).toBe("cur-eur");
    });

    it("returns null when there are no investments to scope", () => {
        const result = resolvePrimaryInvestmentCurrencyId(
            [],
            currencies
        );

        expect(result).toBeNull();
    });
});
