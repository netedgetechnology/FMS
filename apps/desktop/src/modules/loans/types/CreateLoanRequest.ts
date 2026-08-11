import { Loan } from "./Loan";

export type CreateLoanRequest =
    Omit<
        Loan,
        | "id"
        | "lenderInstitutionId"
        | "createdAt"
        | "updatedAt"
        | "accountId"
        | "tenureMonths"
        | "emiAmount"
        | "maturityDate"
        | "notes"
    > & {
        accountId?: string | null;
        lenderInstitutionId?: string | null;
        lenderInstitutionName?: string | null;

        tenureMonths?: number | null;
        emiAmount?: number | null;
        maturityDate?: string | null;
        notes?: string;
    };
