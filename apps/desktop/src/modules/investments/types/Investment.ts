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

    purchaseDate: string | null;

    status: InvestmentStatus;

    notes?: string;

    createdAt: string;

    updatedAt: string;
}
