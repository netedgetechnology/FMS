import { IMigration } from "../types/IMigration";

export const LoanPaidInstallmentsMigration: IMigration = {
    version: 22,
    name: "Loan Paid Installments",
    // How many EMI instalments were already paid when a running loan is
    // created / imported. Used only to derive the loan's current outstanding
    // balances and mark the leading rows of the generated EMI schedule as
    // paid - it never creates payment transactions or replaces real payment
    // records. Existing loans default to 0.
    //
    // The ALTER runs once (guarded by the migration runner).
    sql: `
ALTER TABLE loans ADD COLUMN paid_installments INTEGER NOT NULL DEFAULT 0;
`
};
