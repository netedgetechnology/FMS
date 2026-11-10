import { IMigration } from "../types/IMigration";

export const HistoricalInstalmentSettlementMigration: IMigration = {
    version: 52,
    name: "Historical Instalment Settlement",
    // An instalment the user explicitly declared "Settled before FinWea"
    // when adding a loan that was already running: it is PAID, but there is
    // no bank transaction and no loan_schedule_payments row behind it, and
    // the flag says so. A PAID instalment backed by a real (linked) payment
    // keeps 0 and has its loan_schedule_payments row, so the two can always
    // be told apart.
    //
    // Purely additive: every existing instalment gets 0 and no loan,
    // schedule, payment or transaction row is changed. Existing PAID rows
    // that have no payment record (made by the old "instalments already
    // paid" count) stay exactly as they are - they are neither relabelled
    // nor recalculated.
    sql: `
ALTER TABLE loan_payment_schedule ADD COLUMN settled_before_finwea INTEGER NOT NULL DEFAULT 0 CHECK (settled_before_finwea IN (0, 1));
`
};
