import { describe, expect, it, vi } from "vitest";

import {
    InvestmentReportingService,
} from "./InvestmentReportingService";

import {
    Investment,
    InvestmentStatus,
    InvestmentTransaction,
    InvestmentTransactionType,
} from "../../types";

const INR = { id: "cur-inr", code: "INR", isDefault: true };
const USD = { id: "cur-usd", code: "USD", isDefault: false };

function investment(
    overrides: Partial<Investment> & { id: string }
): Investment {
    return {
        accountId: null,
        businessEntityId: null,
        name: "Investment",
        investmentType: "Stocks",
        investmentSubtype: null,
        symbol: null,
        isin: null,
        currencyId: INR.id,
        brokerInstitutionId: null,
        quantity: 0,
        averageCost: 0,
        currentPrice: 0,
        currentValue: 0,
        priceUpdatedAt: null,
        purchaseDate: null,
        status: InvestmentStatus.ACTIVE,
        notes: undefined,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
        ...overrides,
    };
}

let sequence = 0;

function tx(
    investmentId: string,
    overrides: Partial<InvestmentTransaction> & {
        transactionType: InvestmentTransactionType;
    }
): InvestmentTransaction {
    sequence += 1;

    return {
        id: `tx-${sequence}`,
        investmentId,
        transactionDate: "2025-01-01",
        quantity: 0,
        price: 0,
        amount: 0,
        fees: 0,
        taxes: 0,
        referenceNumber: null,
        notes: undefined,
        createdAt: `2025-01-01T00:00:0${sequence % 10}.000Z`,
        updatedAt: `2025-01-01T00:00:0${sequence % 10}.000Z`,
        ...overrides,
    };
}

function createService(
    investments: Investment[],
    transactionsByInvestmentId: Record<
        string,
        InvestmentTransaction[]
    >,
    currencies: { id: string; code: string; isDefault: boolean }[] = [
        INR,
    ]
): InvestmentReportingService {
    const service = new InvestmentReportingService();

    const investmentRepository = {
        getAll: vi.fn().mockResolvedValue(investments),
    };

    const transactionRepository = {
        getAllByInvestmentId: vi
            .fn()
            .mockImplementation(
                async (investmentId: string) =>
                    transactionsByInvestmentId[
                        investmentId
                    ] ?? []
            ),
    };

    const currencyRepository = {
        getAll: vi.fn().mockResolvedValue(currencies),
    };

    Object.defineProperty(
        service,
        "investmentRepository",
        { value: investmentRepository }
    );
    Object.defineProperty(
        service,
        "transactionRepository",
        { value: transactionRepository }
    );
    Object.defineProperty(
        service,
        "currencyRepository",
        { value: currencyRepository }
    );

    return service;
}

describe("InvestmentReportingService.generateReport - return percentage", () => {
    it("is null (not a fabricated 0%) when the investment has no cost basis at all", async () => {
        const service = createService(
            [investment({ id: "inv-1" })],
            {
                "inv-1": [
                    tx("inv-1", {
                        transactionType:
                            InvestmentTransactionType.DIVIDEND,
                        transactionDate: "2025-02-01",
                        amount: 10,
                    }),
                ],
            }
        );

        const report = await service.generateReport();

        expect(
            report.investments[0].returnPercentage
        ).toBeNull();
        expect(
            report.portfolio.returnPercentage
        ).toBeNull();
    });

    it("reflects lifetime performance for a fully-sold investment instead of flooring at 0%", async () => {
        const service = createService(
            [
                investment({
                    id: "inv-1",
                    currentPrice: 999,
                }),
            ],
            {
                "inv-1": [
                    tx("inv-1", {
                        transactionType:
                            InvestmentTransactionType.BUY,
                        transactionDate: "2025-01-01",
                        quantity: 10,
                        price: 10,
                        amount: 100,
                    }),
                    tx("inv-1", {
                        transactionType:
                            InvestmentTransactionType.SELL,
                        transactionDate: "2025-02-01",
                        quantity: 10,
                        price: 13,
                        amount: 130,
                    }),
                ],
            }
        );

        const report = await service.generateReport();
        const row = report.investments[0];

        // quantity 0 -> currentValue/unrealizedGainLoss are 0
        // regardless of currentPrice, but the 30 realized gain is
        // still visible - not silently zeroed out.
        expect(row.quantity).toBe(0);
        expect(row.currentValue).toBe(0);
        expect(row.realizedGainLoss).toBe(30);
        expect(row.returnPercentage).toBeCloseTo(30);
    });

    it("does not overstate return% after a partial sell (denominator stays the full amount ever invested)", async () => {
        const service = createService(
            [
                investment({
                    id: "inv-1",
                    currentPrice: 20,
                }),
            ],
            {
                "inv-1": [
                    tx("inv-1", {
                        transactionType:
                            InvestmentTransactionType.BUY,
                        transactionDate: "2025-01-01",
                        quantity: 10,
                        price: 10,
                        amount: 100,
                    }),
                    tx("inv-1", {
                        transactionType:
                            InvestmentTransactionType.SELL,
                        transactionDate: "2025-02-01",
                        quantity: 4,
                        price: 15,
                        amount: 60,
                    }),
                ],
            }
        );

        const report = await service.generateReport();
        const row = report.investments[0];

        // realized: 60 - 4*10 = 20. unrealized: 6*20 - 6*10 = 60.
        // total return 80, on a full 100 ever invested = 80%.
        expect(row.realizedGainLoss).toBe(20);
        expect(row.unrealizedGainLoss).toBe(60);
        expect(row.totalReturn).toBe(80);
        expect(row.returnPercentage).toBeCloseTo(80);
    });

    it("is unaffected by dividend/interest income beyond adding it to totalReturn's numerator", async () => {
        const service = createService(
            [
                investment({
                    id: "inv-1",
                    currentPrice: 10,
                }),
            ],
            {
                "inv-1": [
                    tx("inv-1", {
                        transactionType:
                            InvestmentTransactionType.BUY,
                        transactionDate: "2025-01-01",
                        quantity: 10,
                        price: 10,
                        amount: 100,
                    }),
                    tx("inv-1", {
                        transactionType:
                            InvestmentTransactionType.DIVIDEND,
                        transactionDate: "2025-03-01",
                        amount: 15,
                    }),
                ],
            }
        );

        const report = await service.generateReport();
        const row = report.investments[0];

        expect(row.income).toBe(15);
        expect(row.totalReturn).toBe(15);
        expect(row.returnPercentage).toBeCloseTo(15);
    });
});

describe("InvestmentReportingService.generateReport - mixed-currency portfolio totals", () => {
    it("scopes portfolio totals to one primary currency and flags hasOtherCurrencies, without dropping the other investment from the row list", async () => {
        const service = createService(
            [
                investment({
                    id: "inv-inr",
                    currencyId: INR.id,
                    currentPrice: 10,
                }),
                investment({
                    id: "inv-usd",
                    currencyId: USD.id,
                    currentPrice: 10,
                }),
            ],
            {
                "inv-inr": [
                    tx("inv-inr", {
                        transactionType:
                            InvestmentTransactionType.BUY,
                        transactionDate: "2025-01-01",
                        quantity: 10,
                        price: 5,
                        amount: 50,
                    }),
                ],
                "inv-usd": [
                    tx("inv-usd", {
                        transactionType:
                            InvestmentTransactionType.BUY,
                        transactionDate: "2025-01-01",
                        quantity: 100,
                        price: 5,
                        amount: 500,
                    }),
                ],
            },
            [INR, USD]
        );

        const report = await service.generateReport();

        expect(
            report.portfolio.hasOtherCurrencies
        ).toBe(true);
        expect(report.portfolio.currencyId).toBe(
            INR.id
        );
        // Only the INR investment's 100 currentValue (10 qty x 10
        // price), not the USD investment's 1000 - never summed
        // together as one meaningless number.
        expect(report.portfolio.currentValue).toBe(
            100
        );
        expect(report.portfolio.investedCost).toBe(50);

        // The row-level list still lists both investments - only the
        // aggregate is currency-scoped.
        expect(report.investments).toHaveLength(2);
    });

    it("behaves exactly as before when every investment shares one currency", async () => {
        const service = createService(
            [
                investment({
                    id: "inv-1",
                    currencyId: INR.id,
                    currentPrice: 10,
                }),
                investment({
                    id: "inv-2",
                    currencyId: INR.id,
                    currentPrice: 10,
                }),
            ],
            {
                "inv-1": [
                    tx("inv-1", {
                        transactionType:
                            InvestmentTransactionType.BUY,
                        transactionDate: "2025-01-01",
                        quantity: 10,
                        price: 5,
                        amount: 50,
                    }),
                ],
                "inv-2": [
                    tx("inv-2", {
                        transactionType:
                            InvestmentTransactionType.BUY,
                        transactionDate: "2025-01-01",
                        quantity: 10,
                        price: 5,
                        amount: 50,
                    }),
                ],
            }
        );

        const report = await service.generateReport();

        expect(
            report.portfolio.hasOtherCurrencies
        ).toBe(false);
        expect(report.portfolio.currentValue).toBe(
            200
        );
        expect(report.portfolio.investedCost).toBe(
            100
        );
    });
});

describe("InvestmentReportingService.generateReport - date range semantics", () => {
    it("keeps portfolio totals and per-investment rows all-time/current-price, unaffected by a date range that excludes every transaction", async () => {
        const investments = [
            investment({
                id: "inv-1",
                currentPrice: 25,
            }),
        ];

        const transactionsByInvestmentId = {
            "inv-1": [
                tx("inv-1", {
                    transactionType:
                        InvestmentTransactionType.BUY,
                    transactionDate: "2020-01-01",
                    quantity: 10,
                    price: 10,
                    amount: 100,
                }),
                tx("inv-1", {
                    transactionType:
                        InvestmentTransactionType.SELL,
                    transactionDate: "2025-06-15",
                    quantity: 5,
                    price: 20,
                    amount: 100,
                }),
            ],
        };

        const baseline = await createService(
            investments,
            transactionsByInvestmentId
        ).generateReport();

        // A date range that excludes every transaction above.
        const scoped = await createService(
            investments,
            transactionsByInvestmentId
        ).generateReport({
            fromDate: "2030-01-01",
            toDate: "2030-12-31",
        });

        // The detail lists ARE scoped to the date range...
        expect(scoped.transactions).toHaveLength(0);
        expect(scoped.realizedGainLoss).toHaveLength(0);

        // ...but the portfolio summary and per-investment row are
        // not - both calls agree, since they always reflect all-time
        // transactions and today's price regardless of the range.
        expect(scoped.portfolio.currentValue).toBe(
            baseline.portfolio.currentValue
        );
        expect(scoped.portfolio.investedCost).toBe(
            baseline.portfolio.investedCost
        );
        expect(
            scoped.portfolio.unrealizedGainLoss
        ).toBe(baseline.portfolio.unrealizedGainLoss);
        expect(scoped.portfolio.totalReturn).toBe(
            baseline.portfolio.totalReturn
        );
        expect(
            scoped.portfolio.returnPercentage
        ).toBe(baseline.portfolio.returnPercentage);
        expect(scoped.investments[0].currentValue).toBe(
            baseline.investments[0].currentValue
        );
    });

    it("does scope the transactions/income/realized-gain-loss lists to the given date range", async () => {
        const investments = [investment({ id: "inv-1" })];

        const transactionsByInvestmentId = {
            "inv-1": [
                tx("inv-1", {
                    transactionType:
                        InvestmentTransactionType.BUY,
                    transactionDate: "2025-01-01",
                    quantity: 10,
                    price: 10,
                    amount: 100,
                }),
                tx("inv-1", {
                    transactionType:
                        InvestmentTransactionType.SELL,
                    transactionDate: "2025-06-15",
                    quantity: 5,
                    price: 20,
                    amount: 100,
                }),
            ],
        };

        const service = createService(
            investments,
            transactionsByInvestmentId
        );

        const report = await service.generateReport({
            fromDate: "2025-06-01",
            toDate: "2025-06-30",
        });

        expect(report.transactions).toHaveLength(1);
        expect(
            report.transactions[0].transactionType
        ).toBe(InvestmentTransactionType.SELL);
        expect(report.realizedGainLoss).toHaveLength(
            1
        );
    });
});
