import { InvestmentStatus } from "./InvestmentStatus";

export interface Investment {
    id: string;

    accountId: string | null;

    businessEntityId: string | null;

    name: string;

    investmentType: string;

    investmentSubtype: string | null;

    symbol: string | null;

    isin: string | null;

    currencyId: string;

    brokerInstitutionId: string | null;

    quantity: number;

    averageCost: number;

    currentPrice: number;

    currentValue: number;

    /**
     * When currentPrice was last changed - set at creation, and
     * whenever InvestmentService.update sees a different currentPrice
     * than what is stored. Never touched by transaction-driven
     * recalculation (updatePortfolioValues), since that only re-derives
     * quantity/averageCost/currentValue from the ledger and never
     * changes currentPrice itself. null means unknown (e.g. rows that
     * predate this field).
     */
    priceUpdatedAt: string | null;

    purchaseDate: string | null;

    status: InvestmentStatus;

    notes?: string;

    createdAt: string;

    updatedAt: string;
}
