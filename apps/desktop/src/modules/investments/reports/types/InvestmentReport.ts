import {
    InvestmentTransactionType,
} from "../../types";

export interface InvestmentReportDateRange {
    fromDate?: string;
    toDate?: string;
}

export interface InvestmentPortfolioReport {
    totalInvestments: number;
    activeInvestments: number;
    investedCost: number;
    currentValue: number;
    unrealizedGainLoss: number;
    realizedGainLoss: number;
    income: number;
    totalReturn: number;
    /**
     * null when there is no valid basis to divide by (no investment
     * ever had money put into it - e.g. only BONUS/DIVIDEND activity)
     * - never fabricated as 0% in that case. See buildPortfolioReport.
     */
    returnPercentage: number | null;
    /** The single currency these totals are aggregated over - see hasOtherCurrencies. */
    currencyId: string | null;
    currencyCode: string | null;
    /**
     * True when investments exist in more than one currency. The
     * totals above only ever cover currencyId's investments - amounts
     * are never summed or converted across currencies (mirrors the
     * Budgets module's resolveBudgetCurrencyScopes pattern).
     */
    hasOtherCurrencies: boolean;
}

export interface InvestmentReportRow {
    investmentId: string;
    name: string;
    symbol: string | null;
    investmentType: string;
    quantity: number;
    averageCost: number;
    currentPrice: number;
    investedCost: number;
    /**
     * Cumulative cost of every OPENING_BALANCE/BUY ever recorded for
     * this investment - unlike investedCost (residual cost basis of
     * the currently-held quantity), this never decreases on a SELL.
     * It is the denominator returnPercentage is computed against.
     */
    totalInvested: number;
    currentValue: number;
    unrealizedGainLoss: number;
    realizedGainLoss: number;
    income: number;
    totalReturn: number;
    /** null when totalInvested is 0 - no valid basis for a percentage. */
    returnPercentage: number | null;
}

export interface InvestmentTransactionReportRow {
    transactionId: string;
    investmentId: string;
    investmentName: string;
    symbol: string | null;
    transactionType: InvestmentTransactionType;
    transactionDate: string;
    quantity: number;
    price: number;
    amount: number;
    fees: number;
    taxes: number;
    netAmount: number;
    referenceNumber: string | null;
    notes?: string;
}

export interface InvestmentIncomeReportRow {
    transactionId: string;
    investmentId: string;
    investmentName: string;
    symbol: string | null;
    transactionType:
        | InvestmentTransactionType.DIVIDEND
        | InvestmentTransactionType.INTEREST;
    transactionDate: string;
    grossAmount: number;
    fees: number;
    taxes: number;
    netIncome: number;
}

export interface InvestmentRealizedGainLossReportRow {
    transactionId: string;
    investmentId: string;
    investmentName: string;
    symbol: string | null;
    transactionDate: string;
    quantity: number;
    salePrice: number;
    saleAmount: number;
    fees: number;
    taxes: number;
    netSaleProceeds: number;
    costBasis: number;
    realizedGainLoss: number;
}

export interface InvestmentReport {
    portfolio: InvestmentPortfolioReport;
    investments: InvestmentReportRow[];
    transactions: InvestmentTransactionReportRow[];
    income: InvestmentIncomeReportRow[];
    realizedGainLoss: InvestmentRealizedGainLossReportRow[];
}
