import { IMigration } from "../types/IMigration";

export const LoanSchedulePaymentsMigration: IMigration = {
    version: 37,
    name: "Loan Schedule Payments",
    // Loans Phase 4 correction - a schedule row's single transaction_id
    // column cannot represent more than one payment against the same
    // instalment (a first partial payment, then a later one that
    // completes it) without either overwriting the earlier link or
    // silently losing which transaction paid what. This table is the
    // authoritative, append-only history of every payment recorded
    // against a schedule row - one row per LoanPaymentService.
    // processPayment() call, each with its own immutable transaction
    // link and its own principal/interest allocation snapshot (interest
    // allocated first, cumulative across prior payments - see
    // loanPaymentAllocation.ts). loan_payment_schedule's own
    // transaction_id/paid_amount/paid_date/status remain as a fast,
    // backward-compatible summary (paid_amount becomes the running
    // total across every row here; transaction_id is set once, from the
    // first payment, and never overwritten by a later one).
    sql: `

CREATE TABLE IF NOT EXISTS loan_schedule_payments (
    id TEXT PRIMARY KEY,
    loan_id TEXT NOT NULL,
    schedule_id TEXT NOT NULL,
    transaction_id TEXT NOT NULL,
    payment_date TEXT NOT NULL,
    amount REAL NOT NULL,
    principal_amount REAL NOT NULL,
    interest_amount REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (loan_id) REFERENCES loans(id),
    FOREIGN KEY (schedule_id) REFERENCES loan_payment_schedule(id),
    FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_loan_schedule_payments_schedule
ON loan_schedule_payments(schedule_id);

CREATE INDEX IF NOT EXISTS idx_loan_schedule_payments_loan
ON loan_schedule_payments(loan_id);

`
};
