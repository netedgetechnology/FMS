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

        /**
         * Interest Rate History (Stage 4), Overdraft / Cash Credit / Dropline
         * only: rate changes the customer confirmed from a lender statement,
         * recorded (never recalculated) in the same transaction as the loan.
         * The original rate applies from the start date; each change after
         * it, in date order. A Term Loan never sends this - its changes go
         * through the reviewed Record Rate Change workflow after creation.
         */
        statementRateHistory?: {
            originalRate: number;
            changes: Array<{
                effectiveFrom: string;
                rate: number;
                rateType: "FIXED" | "FLOATING" | null;
                reference: string;
                notes: string;
            }>;
        } | null;
    };
