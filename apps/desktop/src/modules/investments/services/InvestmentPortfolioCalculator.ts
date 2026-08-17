import {
    InvestmentTransaction,
    InvestmentTransactionType,
} from "../types";

export interface InvestmentPortfolioCalculation {
    quantity: number;
    averageCost: number;
    totalCost: number;
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
        let realizedGainLoss = 0;
        let income = 0;

        for (const transaction of orderedTransactions) {
            switch (transaction.transactionType) {
                case InvestmentTransactionType.OPENING_BALANCE: {
                    quantity += transaction.quantity;

                    totalCost +=
                        transaction.amount +
                        transaction.fees +
                        transaction.taxes;

                    break;
                }

                case InvestmentTransactionType.BUY: {
                    const purchaseCost =
                        transaction.amount +
                        transaction.fees +
                        transaction.taxes;

                    quantity += transaction.quantity;
                    totalCost += purchaseCost;

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
            realizedGainLoss,
            income,
        };
    }
}
