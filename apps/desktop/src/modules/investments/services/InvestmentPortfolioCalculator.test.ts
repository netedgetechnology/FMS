import { describe, expect, it } from "vitest";

import {
    InvestmentPortfolioCalculator,
} from "./InvestmentPortfolioCalculator";

import {
    InvestmentTransaction,
    InvestmentTransactionType,
} from "../types";

const calculator = new InvestmentPortfolioCalculator();

let sequence = 0;

function tx(
    overrides: Partial<InvestmentTransaction> & {
        transactionType: InvestmentTransactionType;
    }
): InvestmentTransaction {
    sequence += 1;

    return {
        id: `tx-${sequence}`,
        investmentId: "inv-1",
        transactionDate: "2025-01-01",
        quantity: 0,
        price: 0,
        amount: 0,
        fees: 0,
        taxes: 0,
        referenceNumber: null,
        notes: undefined,
        createdAt: `2025-01-01T00:00:0${sequence}.000Z`,
        updatedAt: `2025-01-01T00:00:0${sequence}.000Z`,
        ...overrides,
    };
}

describe("InvestmentPortfolioCalculator.calculate", () => {
    it("no-sale investment: totalCost and totalInvested are equal, quantity/averageCost derived correctly", () => {
        const result = calculator.calculate([
            tx({
                transactionType:
                    InvestmentTransactionType.OPENING_BALANCE,
                transactionDate: "2025-01-01",
                quantity: 10,
                price: 100,
                amount: 1000,
            }),
            tx({
                transactionType:
                    InvestmentTransactionType.BUY,
                transactionDate: "2025-02-01",
                quantity: 5,
                price: 120,
                amount: 600,
            }),
        ]);

        expect(result.quantity).toBe(15);
        expect(result.totalCost).toBe(1600);
        expect(result.totalInvested).toBe(1600);
        expect(result.averageCost).toBeCloseTo(
            1600 / 15
        );
        expect(result.realizedGainLoss).toBe(0);
        expect(result.income).toBe(0);
    });

    it("partial sell: totalCost (residual basis) drops but totalInvested stays at the full cumulative amount", () => {
        const result = calculator.calculate([
            tx({
                transactionType:
                    InvestmentTransactionType.BUY,
                transactionDate: "2025-01-01",
                quantity: 10,
                price: 100,
                amount: 1000,
            }),
            tx({
                transactionType:
                    InvestmentTransactionType.SELL,
                transactionDate: "2025-03-01",
                quantity: 4,
                price: 150,
                amount: 600,
            }),
        ]);

        // Average cost at time of sale was 100/unit - 4 units sold
        // cost 400, proceeds 600, so realized gain is 200.
        expect(result.realizedGainLoss).toBe(200);

        // Residual cost basis: 10 - 4 = 6 units remaining at ~100 each.
        expect(result.quantity).toBe(6);
        expect(result.totalCost).toBeCloseTo(600);

        // totalInvested never drops - still the original 1000 BUY,
        // regardless of the later sell.
        expect(result.totalInvested).toBe(1000);
    });

    it("fully sold investment: totalCost resets to 0 but totalInvested still reflects the original purchase", () => {
        const result = calculator.calculate([
            tx({
                transactionType:
                    InvestmentTransactionType.BUY,
                transactionDate: "2025-01-01",
                quantity: 10,
                price: 100,
                amount: 1000,
            }),
            tx({
                transactionType:
                    InvestmentTransactionType.SELL,
                transactionDate: "2025-06-01",
                quantity: 10,
                price: 130,
                amount: 1300,
            }),
        ]);

        expect(result.quantity).toBe(0);
        expect(result.totalCost).toBe(0);
        expect(result.totalInvested).toBe(1000);
        expect(result.realizedGainLoss).toBe(300);
    });

    it("SELL correctly allocates cost basis using the running weighted-average cost, not the original per-lot price", () => {
        const result = calculator.calculate([
            tx({
                transactionType:
                    InvestmentTransactionType.BUY,
                transactionDate: "2025-01-01",
                quantity: 10,
                price: 100,
                amount: 1000,
            }),
            tx({
                transactionType:
                    InvestmentTransactionType.BUY,
                transactionDate: "2025-02-01",
                quantity: 10,
                price: 200,
                amount: 2000,
            }),
            // Average cost is now (1000 + 2000) / 20 = 150/unit.
            tx({
                transactionType:
                    InvestmentTransactionType.SELL,
                transactionDate: "2025-03-01",
                quantity: 10,
                price: 150,
                amount: 1500,
            }),
        ]);

        // Cost of the 10 units sold at the 150 weighted-average = 1500,
        // proceeds were also 1500, so realized gain/loss is 0.
        expect(result.realizedGainLoss).toBe(0);
        expect(result.quantity).toBe(10);
        expect(result.totalCost).toBeCloseTo(1500);
        expect(result.totalInvested).toBe(3000);
    });

    it("BONUS shares dilute average cost without adding to totalInvested (they cost nothing)", () => {
        const result = calculator.calculate([
            tx({
                transactionType:
                    InvestmentTransactionType.BUY,
                transactionDate: "2025-01-01",
                quantity: 10,
                price: 100,
                amount: 1000,
            }),
            tx({
                transactionType:
                    InvestmentTransactionType.BONUS,
                transactionDate: "2025-02-01",
                quantity: 10,
            }),
        ]);

        expect(result.quantity).toBe(20);
        expect(result.totalCost).toBe(1000);
        expect(result.totalInvested).toBe(1000);
        expect(result.averageCost).toBeCloseTo(50);
    });

    it("DIVIDEND and INTEREST add net income without affecting cost basis or totalInvested", () => {
        const result = calculator.calculate([
            tx({
                transactionType:
                    InvestmentTransactionType.BUY,
                transactionDate: "2025-01-01",
                quantity: 10,
                price: 100,
                amount: 1000,
            }),
            tx({
                transactionType:
                    InvestmentTransactionType.DIVIDEND,
                transactionDate: "2025-04-01",
                amount: 50,
                fees: 2,
                taxes: 3,
            }),
            tx({
                transactionType:
                    InvestmentTransactionType.INTEREST,
                transactionDate: "2025-05-01",
                amount: 20,
            }),
        ]);

        expect(result.income).toBe(45 + 20);
        expect(result.totalCost).toBe(1000);
        expect(result.totalInvested).toBe(1000);
        expect(result.quantity).toBe(10);
    });

    it("zero cost basis: an investment with only BONUS/DIVIDEND activity (no BUY ever) has totalInvested 0", () => {
        const result = calculator.calculate([
            tx({
                transactionType:
                    InvestmentTransactionType.BONUS,
                transactionDate: "2025-01-01",
                quantity: 5,
            }),
            tx({
                transactionType:
                    InvestmentTransactionType.DIVIDEND,
                transactionDate: "2025-02-01",
                amount: 10,
            }),
        ]);

        expect(result.quantity).toBe(5);
        expect(result.totalCost).toBe(0);
        expect(result.totalInvested).toBe(0);
        expect(result.income).toBe(10);
    });

    it("throws when a SELL would exceed the available quantity", () => {
        expect(() =>
            calculator.calculate([
                tx({
                    transactionType:
                        InvestmentTransactionType.BUY,
                    transactionDate: "2025-01-01",
                    quantity: 5,
                    price: 100,
                    amount: 500,
                }),
                tx({
                    transactionType:
                        InvestmentTransactionType.SELL,
                    transactionDate: "2025-02-01",
                    quantity: 6,
                    price: 100,
                    amount: 600,
                }),
            ])
        ).toThrow(/Only 5 units are available/);
    });

    it("returns all-zero figures (including totalInvested) for no transactions at all", () => {
        const result = calculator.calculate([]);

        expect(result).toEqual({
            quantity: 0,
            averageCost: 0,
            totalCost: 0,
            totalInvested: 0,
            realizedGainLoss: 0,
            income: 0,
        });
    });
});
