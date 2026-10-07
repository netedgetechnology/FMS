import { IMigration } from "../types/IMigration";

export const LoanPaymentLinkSettlementMigration: IMigration = {
    version: 46,
    name: "Loan Payment Link And Settlement",
    // Two facts about each loan_schedule_payments row that were implied
    // before and must now be stored:
    //
    // transaction_linked - 1 when the payment records an EXISTING
    // transaction (a statement debit, or one the user linked by hand from
    // Transactions) rather than one the payment itself created. Reversing
    // a linked payment only unlinks that transaction, never deletes it.
    // Every existing payment whose transaction was imported is such a link
    // (that was the only way to link before), so those are backfilled.
    //
    // settles_installment - 1 when the user said this payment settles the
    // instalment in full although it is less than the scheduled amount
    // (a lender whose actual debit differs from FinWea's calculated EMI).
    // The instalment becomes PAID and the difference is kept, not hidden:
    // its total_amount stays the calculated EMI and paid_amount is what was
    // really paid. 0 for every existing payment (none did this).
    sql: `
ALTER TABLE loan_schedule_payments ADD COLUMN transaction_linked INTEGER NOT NULL DEFAULT 0;

ALTER TABLE loan_schedule_payments ADD COLUMN settles_installment INTEGER NOT NULL DEFAULT 0;

UPDATE loan_schedule_payments
SET transaction_linked = 1
WHERE transaction_id IN (
    SELECT id FROM transactions WHERE is_imported = 1
);
`
};
