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
    returnPercentage: number;
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
    currentValue: number;
    unrealizedGainLoss: number;
    realizedGainLoss: number;
    income: number;
    totalReturn: number;
    returnPercentage: number;
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
