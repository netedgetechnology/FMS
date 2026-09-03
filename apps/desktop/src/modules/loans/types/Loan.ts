export interface Loan {
    id: string;

    // Bank account used for EMI payments (chosen in the loan form).
    accountId: string | null;

    // 1:1 liability account (account_type = LOAN) that represents this loan in
    // the unified Accounts list. Managed by LoanService, never edited via the
    // form. Analogous to investments.account_id / the Investment ↔ Account link.
    loanAccountId: string | null;

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
