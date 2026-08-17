import {
    Investment,
    InvestmentTransaction,
    InvestmentTransactionType,
} from "../../types";

import {
    InvestmentRepository,
    InvestmentTransactionRepository,
} from "../../repositories";

import {
    InvestmentPortfolioCalculator,
} from "../../services/InvestmentPortfolioCalculator";

import {
    InvestmentReport,
    InvestmentReportDateRange,
    InvestmentReportRow,
    InvestmentTransactionReportRow,
    InvestmentIncomeReportRow,
    InvestmentRealizedGainLossReportRow,
} from "../types";

export class InvestmentReportingService {
    private readonly investmentRepository =
        new InvestmentRepository();

    private readonly transactionRepository =
        new InvestmentTransactionRepository();

    private readonly calculator =
        new InvestmentPortfolioCalculator();

    async generateReport(
        dateRange?: InvestmentReportDateRange
    ): Promise<InvestmentReport> {
        const investments =
            await this.investmentRepository.getAll();

        const transactionResults =
            await Promise.all(
                investments.map(
                    async (investment) => ({
                        investment,
                        transactions:
                            await this.transactionRepository
                                .getAllByInvestmentId(
                                    investment.id
                                ),
                    })
                )
            );

        const filteredResults =
            transactionResults.map(
                ({ investment, transactions }) => ({
                    investment,
                    allTransactions:
                        transactions,
                    reportTransactions:
                        this.filterTransactions(
                            transactions,
                            dateRange
                        ),
                })
            );

        const investmentRows =
            filteredResults.map(
                ({ investment, allTransactions }) =>
                    this.buildInvestmentRow(
                        investment,
                        allTransactions
                    )
            );

        const transactions =
            filteredResults
                .flatMap(
                    ({
                        investment,
                        reportTransactions,
                    }) =>
                        reportTransactions.map(
                            (transaction) =>
                                this.buildTransactionRow(
                                    investment,
                                    transaction
                                )
                        )
                )
                .sort(
                    (a, b) =>
                        b.transactionDate.localeCompare(
                            a.transactionDate
                        )
                );

        const income =
            filteredResults
                .flatMap(
                    ({
                        investment,
                        reportTransactions,
                    }) =>
                        reportTransactions
                            .filter(
                                (transaction) =>
                                    transaction.transactionType ===
                                        InvestmentTransactionType.DIVIDEND ||
                                    transaction.transactionType ===
                                        InvestmentTransactionType.INTEREST
                            )
                            .map(
                                (transaction) =>
                                    this.buildIncomeRow(
                                        investment,
                                        transaction
                                    )
                            )
                )
                .sort(
                    (a, b) =>
                        b.transactionDate.localeCompare(
                            a.transactionDate
                        )
                );

        const realizedGainLoss =
            filteredResults
                .flatMap(
                    ({
                        investment,
                        allTransactions,
                    }) =>
                        this.buildRealizedGainLossRows(
                            investment,
                            allTransactions,
                            dateRange
                        )
                )
                .sort(
                    (a, b) =>
                        b.transactionDate.localeCompare(
                            a.transactionDate
                        )
                );

        const portfolio =
            this.buildPortfolioReport(
                investments,
                investmentRows
            );

        return {
            portfolio,
            investments: investmentRows,
            transactions,
            income,
            realizedGainLoss,
        };
    }

    private isWithinDateRange(
        transactionDate: string,
        dateRange?: InvestmentReportDateRange
    ): boolean {
        if (
            dateRange?.fromDate &&
            transactionDate <
                dateRange.fromDate
        ) {
            return false;
        }

        if (
            dateRange?.toDate &&
            transactionDate >
                dateRange.toDate
        ) {
            return false;
        }

        return true;
    }

    private filterTransactions(
        transactions: InvestmentTransaction[],
        dateRange?: InvestmentReportDateRange
    ): InvestmentTransaction[] {
        return transactions.filter(
            (transaction) => {
                return this.isWithinDateRange(
                    transaction.transactionDate,
                    dateRange
                );
            }
        );
    }

    private buildInvestmentRow(
        investment: Investment,
        transactions: InvestmentTransaction[]
    ): InvestmentReportRow {
        const calculation =
            this.calculator.calculate(
                transactions
            );

        const currentValue =
            calculation.quantity *
            investment.currentPrice;

        const unrealizedGainLoss =
            currentValue -
            calculation.totalCost;

        const totalReturn =
            unrealizedGainLoss +
            calculation.realizedGainLoss +
            calculation.income;

        const returnPercentage =
            calculation.totalCost !== 0
                ? (totalReturn /
                      calculation.totalCost) *
                  100
                : 0;

        return {
            investmentId:
                investment.id,

            name:
                investment.name,

            symbol:
                investment.symbol,

            investmentType:
                investment.investmentType,

            quantity:
                calculation.quantity,

            averageCost:
                calculation.averageCost,

            currentPrice:
                investment.currentPrice,

            investedCost:
                calculation.totalCost,

            currentValue,

            unrealizedGainLoss,

            realizedGainLoss:
                calculation.realizedGainLoss,

            income:
                calculation.income,

            totalReturn,

            returnPercentage,
        };
    }

    private buildPortfolioReport(
        investments: Investment[],
        rows: InvestmentReportRow[]
    ) {
        const investedCost =
            rows.reduce(
                (total, row) =>
                    total + row.investedCost,
                0
            );

        const currentValue =
            rows.reduce(
                (total, row) =>
                    total + row.currentValue,
                0
            );

        const unrealizedGainLoss =
            rows.reduce(
                (total, row) =>
                    total +
                    row.unrealizedGainLoss,
                0
            );

        const realizedGainLoss =
            rows.reduce(
                (total, row) =>
                    total +
                    row.realizedGainLoss,
                0
            );

        const income =
            rows.reduce(
                (total, row) =>
                    total + row.income,
                0
            );

        const totalReturn =
            unrealizedGainLoss +
            realizedGainLoss +
            income;

        const returnPercentage =
            investedCost !== 0
                ? (totalReturn /
                      investedCost) *
                  100
                : 0;

        const activeInvestments =
            investments.filter(
                (investment) =>
                    investment.status === "ACTIVE"
            ).length;

        return {
            totalInvestments:
                investments.length,

            activeInvestments,

            investedCost,

            currentValue,

            unrealizedGainLoss,

            realizedGainLoss,

            income,

            totalReturn,

            returnPercentage,
        };
    }

    private buildTransactionRow(
        investment: Investment,
        transaction: InvestmentTransaction
    ): InvestmentTransactionReportRow {
        const netAmount =
            transaction.transactionType ===
                InvestmentTransactionType.SELL ||
            transaction.transactionType ===
                InvestmentTransactionType.DIVIDEND ||
            transaction.transactionType ===
                InvestmentTransactionType.INTEREST
                ? transaction.amount -
                  transaction.fees -
                  transaction.taxes
                : transaction.amount +
                  transaction.fees +
                  transaction.taxes;

        return {
            transactionId:
                transaction.id,

            investmentId:
                investment.id,

            investmentName:
                investment.name,

            symbol:
                investment.symbol,

            transactionType:
                transaction.transactionType,

            transactionDate:
                transaction.transactionDate,

            quantity:
                transaction.quantity,

            price:
                transaction.price,

            amount:
                transaction.amount,

            fees:
                transaction.fees,

            taxes:
                transaction.taxes,

            netAmount,

            referenceNumber:
                transaction.referenceNumber,

            notes:
                transaction.notes,
        };
    }

    private buildIncomeRow(
        investment: Investment,
        transaction: InvestmentTransaction
    ): InvestmentIncomeReportRow {
        return {
            transactionId:
                transaction.id,

            investmentId:
                investment.id,

            investmentName:
                investment.name,

            symbol:
                investment.symbol,

            transactionType:
                transaction.transactionType as
                    | InvestmentTransactionType.DIVIDEND
                    | InvestmentTransactionType.INTEREST,

            transactionDate:
                transaction.transactionDate,

            grossAmount:
                transaction.amount,

            fees:
                transaction.fees,

            taxes:
                transaction.taxes,

            netIncome:
                transaction.amount -
                transaction.fees -
                transaction.taxes,
        };
    }

    private buildRealizedGainLossRows(
        investment: Investment,
        transactions: InvestmentTransaction[],
        dateRange?: InvestmentReportDateRange
    ): InvestmentRealizedGainLossReportRow[] {
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

        const rows: InvestmentRealizedGainLossReportRow[] =
            [];

        for (const transaction of orderedTransactions) {
            switch (transaction.transactionType) {
                case InvestmentTransactionType.OPENING_BALANCE:
                case InvestmentTransactionType.BUY: {
                    quantity +=
                        transaction.quantity;

                    totalCost +=
                        transaction.amount +
                        transaction.fees +
                        transaction.taxes;

                    break;
                }

                case InvestmentTransactionType.BONUS: {
                    quantity +=
                        transaction.quantity;

                    break;
                }

                case InvestmentTransactionType.SELL: {
                    const averageCost =
                        quantity > 0
                            ? totalCost / quantity
                            : 0;

                    const costBasis =
                        transaction.quantity *
                        averageCost;

                    const netSaleProceeds =
                        transaction.amount -
                        transaction.fees -
                        transaction.taxes;

                    const realizedGainLoss =
                        netSaleProceeds -
                        costBasis;

                    if (
                        this.isWithinDateRange(
                            transaction.transactionDate,
                            dateRange
                        )
                    ) {
                        rows.push({
                            transactionId:
                                transaction.id,

                        investmentId:
                            investment.id,

                        investmentName:
                            investment.name,

                        symbol:
                            investment.symbol,

                        transactionDate:
                            transaction.transactionDate,

                        quantity:
                            transaction.quantity,

                        salePrice:
                            transaction.price,

                        saleAmount:
                            transaction.amount,

                        fees:
                            transaction.fees,

                        taxes:
                            transaction.taxes,

                        netSaleProceeds,

                        costBasis,

                            realizedGainLoss,
                        });
                    }

                    quantity -=
                        transaction.quantity;

                    totalCost -=
                        costBasis;

                    if (quantity === 0) {
                        totalCost = 0;
                    }

                    break;
                }

                default:
                    break;
            }
        }

        return rows;
    }
}


