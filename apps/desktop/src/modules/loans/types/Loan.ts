export interface Loan {
    id: string;

    accountId: string | null;

    lenderInstitutionId: string | null;

    loanType: string;

    name: string;

    principalAmount: number;

    interestRate: number;

    interestType: "REDUCING" | "FLAT";

    tenureMonths: number | null;

    emiAmount: number | null;

    startDate: string;

    maturityDate: string | null;

    outstandingPrincipal: number;

    outstandingInterest: number;

    currencyId: string;

    status: "ACTIVE" | "CLOSED" | "ON_HOLD" | "DEFAULTED";

    notes?: string;

    createdAt: string;

    updatedAt: string;
}
