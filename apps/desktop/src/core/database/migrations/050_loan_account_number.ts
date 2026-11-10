import { IMigration } from "../types/IMigration";

export const LoanAccountNumberMigration: IMigration = {
    version: 50,
    name: "Loan Account Number",
    // The lender's own account number for the loan (e.g. "0099000123" or
    // "XLNA0999000000000017"), entered in Add / Edit Loan. TEXT, never a
    // number, so leading zeros and letters are kept exactly as typed.
    //
    // Purely additive and nullable: every existing loan gets NULL, and no
    // loan, schedule, payment or transaction row is changed.
    sql: `
ALTER TABLE loans ADD COLUMN loan_account_number TEXT;
`
};
