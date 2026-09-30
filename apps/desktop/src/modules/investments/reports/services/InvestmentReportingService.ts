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
    resolvePrimaryInvestmentCurrencyId,
} from "../../services/investmentCurrencyScope";

import { CurrencyRepository } from "@/modules/currencies/repositories/CurrencyRepository";

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

    private readonly currencyRepository =
        new CurrencyRepository();

    private readonly calculator =
        new InvestmentPortfolioCalculator();

    async generateReport(
        dateRange?: InvestmentReportDateRange
    ): Promise<InvestmentReport> {
        const [investments, currencies] =
            await Promise.all([
                this.investmentRepository.getAll(),
                this.currencyRepository.getAll(),
            ]);

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
                investmentRows,
                currencies
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

        // totalInvested (cumulative OPENING_BALANCE/BUY cost, never
        // reduced by a SELL) is the only basis that stays consistent
        // with totalReturn's scope across a no-sale, partial-sell or
        // fully-sold history - see the field's doc comment on
        // InvestmentPortfolioCalculation. totalCost (residual basis)
        // would overstate the % after a partial sell and floor it at
        // 0% after a full sell regardless of actual performance.
        // null (not 0%) when there is no valid basis to divide by.
        const returnPercentage =
            calculation.totalInvested > 0
                ? (totalReturn /
                      calculation.totalInvested) *
                  100
                : null;

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

            totalInvested:
                calculation.totalInvested,

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
        rows: InvestmentReportRow[],
        currencies: readonly {
            id: string;
            code: string;
            isDefault: boolean;
        }[]
    ) {
        const investmentById = new Map(
            investments.map(
                (investment) => [investment.id, investment]
            )
        );

        const primaryCurrencyId =
            resolvePrimaryInvestmentCurrencyId(
                investments,
                currencies
            );

        // Mixed-currency portfolios must never be summed together
        // (INR + USD is not a meaningful number) - aggregate only the
        // rows in the resolved primary currency, same as the Budgets
        // module's resolveBudgetCurrencyScopes pattern. When every
        // investment shares one currency this is a no-op: every row
        // is in scope and totals are unchanged from before.
        const scopedRows = rows.filter((row) => {
            const investment = investmentById.get(
                row.investmentId
            );

            return (
                investment?.currencyId ===
                primaryCurrencyId
            );
        });

        const investedCost =
            scopedRows.reduce(
                (total, row) =>
                    total + row.investedCost,
                0
            );

        const totalInvested =
            scopedRows.reduce(
                (total, row) =>
                    total + row.totalInvested,
                0
            );

        const currentValue =
            scopedRows.reduce(
                (total, row) =>
                    total + row.currentValue,
                0
            );

        const unrealizedGainLoss =
            scopedRows.reduce(
                (total, row) =>
                    total +
                    row.unrealizedGainLoss,
                0
            );

        const realizedGainLoss =
            scopedRows.reduce(
                (total, row) =>
                    total +
                    row.realizedGainLoss,
                0
            );

        const income =
            scopedRows.reduce(
                (total, row) =>
                    total + row.income,
                0
            );

        const totalReturn =
            unrealizedGainLoss +
            realizedGainLoss +
            income;

        const returnPercentage =
            totalInvested > 0
                ? (totalReturn /
                      totalInvested) *
                  100
                : null;

        const activeInvestments =
            investments.filter(
                (investment) =>
                    investment.status === "ACTIVE"
            ).length;

        const distinctCurrencyCount =
            new Set(
                investments.map(
                    (investment) => investment.currencyId
                )
            ).size;

        const currencyCode =
            currencies.find(
                (currency) =>
                    currency.id === primaryCurrencyId
            )?.code ?? null;

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

            currencyId: primaryCurrencyId,

            currencyCode,

            hasOtherCurrencies:
                distinctCurrencyCount > 1,
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


