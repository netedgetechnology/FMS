import { IMigration } from "../types/IMigration";

export const LoansEMIMigration: IMigration = {
    version: 5,
    name: "Loans and EMI Schedules",
    sql: `

CREATE TABLE IF NOT EXISTS loans (
    id TEXT PRIMARY KEY,
    account_id TEXT,
    lender_institution_id TEXT,
    loan_type TEXT NOT NULL,
    name TEXT NOT NULL,
    principal_amount REAL NOT NULL,
    interest_rate REAL NOT NULL DEFAULT 0,
    interest_type TEXT NOT NULL DEFAULT 'REDUCING',
    tenure_months INTEGER,
    emi_amount REAL,
    start_date TEXT NOT NULL,
    maturity_date TEXT,
    outstanding_principal REAL NOT NULL DEFAULT 0,
    outstanding_interest REAL NOT NULL DEFAULT 0,
    currency_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    FOREIGN KEY (account_id) REFERENCES accounts(id),
    FOREIGN KEY (lender_institution_id) REFERENCES institutions(id),
    FOREIGN KEY (currency_id) REFERENCES currencies(id)
);

CREATE INDEX IF NOT EXISTS idx_loans_account
ON loans(account_id);

CREATE INDEX IF NOT EXISTS idx_loans_status
ON loans(status);

CREATE TABLE IF NOT EXISTS loan_payment_schedule (
    id TEXT PRIMARY KEY,
    loan_id TEXT NOT NULL,
    installment_number INTEGER NOT NULL,
    due_date TEXT NOT NULL,
    principal_amount REAL NOT NULL DEFAULT 0,
    interest_amount REAL NOT NULL DEFAULT 0,
    total_amount REAL NOT NULL,
    outstanding_principal REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'UPCOMING',
    paid_date TEXT,
    paid_amount REAL,
    transaction_id TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (loan_id) REFERENCES loans(id),
    FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_loan_schedule_loan
ON loan_payment_schedule(loan_id);

CREATE INDEX IF NOT EXISTS idx_loan_schedule_due
ON loan_payment_schedule(due_date);

CREATE INDEX IF NOT EXISTS idx_loan_schedule_status
ON loan_payment_schedule(status);

`
};
