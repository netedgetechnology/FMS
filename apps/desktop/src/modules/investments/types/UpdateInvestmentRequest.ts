import {
    InvestmentStatus,
} from "./InvestmentStatus";

export interface UpdateInvestmentRequest {
    id: string;

    businessEntityId: string;

    name: string;

    investmentType: string;

    investmentSubtype?: string | null;

    symbol?: string | null;

    isin?: string | null;

    currencyId: string;

    brokerInstitutionId?: string | null;

    brokerInstitutionName?: string | null;

    quantity: number;

    averageCost: number;

    currentPrice: number;

    currentValue: number;

    purchaseDate?: string | null;

    status: InvestmentStatus;

    notes?: string;
}
