import { IMigration } from "../types/IMigration";

export const LoanFirstInstallmentMigration: IMigration = {
    version: 45,
    name: "Loan First Installment",
    // Optional irregular first instalment: the broken-period (pre-EMI)
    // interest a lender collects as instalment 1 before the regular EMIs
    // start. Interest only - it reduces no principal - and it is followed
    // by the loan's `tenure_months` regular EMIs (so the schedule has
    // tenure_months + 1 instalments). NULL (every existing loan) keeps the
    // schedule exactly as before: every instalment is the regular EMI.
    sql: `
ALTER TABLE loans ADD COLUMN first_installment_amount REAL;
`
};
