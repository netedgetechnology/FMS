import {
    InvestmentTransaction,
    InvestmentTransactionType,
} from "../types";

export interface InvestmentPortfolioCalculation {
    quantity: number;
    averageCost: number;
    totalCost: number;
    /**
     * Cumulative cost of every OPENING_BALANCE/BUY ever recorded -
     * unlike totalCost (the residual cost basis of only the
     * currently-held quantity, which SELL reduces), this never goes
     * down. It is the safe, unambiguous denominator for a lifetime
     * return percentage: total return (realized + unrealized + income)
     * is meaningful relative to "everything ever put in," but not
     * relative to totalCost, which drops to 0 the moment a position is
     * fully sold and would make return% blow up or floor at 0 for any
     * investment with a partial or full sell in its history (Phase 6).
     */
    totalInvested: number;
    realizedGainLoss: number;
    income: number;
}

export class InvestmentPortfolioCalculator {
    calculate(
        transactions: InvestmentTransaction[]
    ): InvestmentPortfolioCalculation {
        const orderedTransactions =
            [...transactions].sort(
                (a, b) => {
                    const dateComparison =
                        a.transactionDate.localeCompare(
                            b.transactionDate
                        );

                    if (dateComparison !== 0) {
                        return dateComparison;
                    }

                    return a.createdAt.localeCompare(
                        b.createdAt
                    );
                }
            );

        let quantity = 0;
        let totalCost = 0;
        let totalInvested = 0;
        let realizedGainLoss = 0;
        let income = 0;

        for (const transaction of orderedTransactions) {
            switch (transaction.transactionType) {
                case InvestmentTransactionType.OPENING_BALANCE: {
                    const cost =
                        transaction.amount +
                        transaction.fees +
                        transaction.taxes;

                    quantity += transaction.quantity;
                    totalCost += cost;
                    totalInvested += cost;

                    break;
                }

                case InvestmentTransactionType.BUY: {
                    const purchaseCost =
                        transaction.amount +
                        transaction.fees +
                        transaction.taxes;

                    quantity += transaction.quantity;
                    totalCost += purchaseCost;
                    totalInvested += purchaseCost;

                    break;
                }

                case InvestmentTransactionType.SELL: {
                    if (
                        transaction.quantity >
                        quantity
                    ) {
                        throw new Error(
                            `Cannot sell ${transaction.quantity} units. Only ${quantity} units are available.`
                        );
                    }

                    const averageCost =
                        quantity > 0
                            ? totalCost / quantity
                            : 0;

                    const costOfUnitsSold =
                        transaction.quantity *
                        averageCost;

                    const netSaleProceeds =
                        transaction.amount -
                        transaction.fees -
                        transaction.taxes;

                    realizedGainLoss +=
                        netSaleProceeds -
                        costOfUnitsSold;

                    quantity -=
                        transaction.quantity;

                    totalCost -=
                        costOfUnitsSold;

                    if (quantity === 0) {
                        totalCost = 0;
                    }

                    break;
                }

                case InvestmentTransactionType.BONUS: {
                    quantity += transaction.quantity;
                    break;
                }

                case InvestmentTransactionType.DIVIDEND:
                case InvestmentTransactionType.INTEREST: {
                    income +=
                        transaction.amount -
                        transaction.fees -
                        transaction.taxes;

                    break;
                }

                case InvestmentTransactionType.OTHER: {
                    break;
                }

                case InvestmentTransactionType.SPLIT: {
                    throw new Error(
                        "SPLIT transactions require a split ratio before they can be calculated."
                    );
                }

                default: {
                    const exhaustiveCheck: never =
                        transaction.transactionType;

                    throw new Error(
                        `Unsupported investment transaction type: ${exhaustiveCheck}`
                    );
                }
            }
        }

        const averageCost =
            quantity > 0
                ? totalCost / quantity
                : 0;

        return {
            quantity,
            averageCost,
            totalCost,
            totalInvested,
            realizedGainLoss,
            income,
        };
    }
}
