import { describe, expect, it } from "vitest";

import { computeDashboardInvestmentSummary } from "./DashboardService";

const INR = "cur-inr";
const USD = "cur-usd";

const currencies = [
    { id: INR, code: "INR", isDefault: true },
    { id: USD, code: "USD", isDefault: false },
];

describe("computeDashboardInvestmentSummary", () => {
    it("always reports monthlyChangePercentage as null, never a fabricated 0%", () => {
        const result = computeDashboardInvestmentSummary(
            [
                {
                    currencyId: INR,
                    currentValue: 1000,
                    investmentType: "Stocks",
                },
            ],
            currencies
        );

        expect(
            result.monthlyChangePercentage
        ).toBeNull();
    });

    it("behaves exactly as before when every investment shares one currency", () => {
        const result = computeDashboardInvestmentSummary(
            [
                {
                    currencyId: INR,
                    currentValue: 1000,
                    investmentType: "Stocks",
                },
                {
                    currencyId: INR,
                    currentValue: 500,
                    investmentType: "Gold",
                },
            ],
            currencies
        );

        expect(result.totalValue).toBe(1500);
        expect(result.hasOtherCurrencies).toBe(false);
        expect(result.currencyCode).toBe("INR");
        expect(result.allocation).toEqual([
            { name: "Stocks", value: 66.67, amount: 1000 },
            { name: "Gold", value: 33.33, amount: 500 },
        ]);
    });

    it("scopes totalValue/allocation to the primary currency and flags hasOtherCurrencies for a mixed-currency portfolio", () => {
        const result = computeDashboardInvestmentSummary(
            [
                {
                    currencyId: INR,
                    currentValue: 1000,
                    investmentType: "Stocks",
                },
                {
                    currencyId: USD,
                    currentValue: 5000,
                    investmentType: "Stocks",
                },
            ],
            currencies
        );

        expect(result.hasOtherCurrencies).toBe(true);
        expect(result.currencyCode).toBe("INR");
        // Only the INR investment's 1000 - never summed with the USD
        // investment's 5000 as one meaningless number.
        expect(result.totalValue).toBe(1000);
        expect(result.allocation).toEqual([
            { name: "Stocks", value: 100, amount: 1000 },
        ]);
    });

    it("returns an empty, non-crashing summary when there are no investments", () => {
        const result = computeDashboardInvestmentSummary(
            [],
            currencies
        );

        expect(result.totalValue).toBe(0);
        expect(result.allocation).toEqual([]);
        expect(result.hasOtherCurrencies).toBe(false);
        expect(result.currencyCode).toBeNull();
        expect(
            result.monthlyChangePercentage
        ).toBeNull();
    });
});
