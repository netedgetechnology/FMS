import { Loan } from "./Loan";
import type { LoanSetupDetails } from "../setup/loanSetupTypes";

export type CreateLoanRequest =
    Omit<
        Loan,
        | "id"
        | "lenderInstitutionId"
        | "createdAt"
        | "updatedAt"
        | "accountId"
        | "loanAccountId"
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

        /**
         * The Add Loan setup workflow's extra details - lender terms,
         * disbursements, initial expenses and (optionally) the lender's
         * official schedule. Absent: creation is exactly as before.
         */
        setup?: LoanSetupDetails | null;
    };
