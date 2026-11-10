import { IMigration } from "../types/IMigration";

export const LoanSetupMigration: IMigration = {
    version: 51,
    name: "Loan Setup Workflow",
    // The complete Add Loan setup: the loan's own lender terms, how it was
    // disbursed, what it cost to take, and where its schedule came from.
    //
    // Purely additive and backward compatible:
    //   - every new loans column is nullable, so every existing loan reads
    //     NULL ("not recorded") and keeps working exactly as before. No
    //     existing balance, schedule, payment or transaction is changed or
    //     recalculated.
    //   - loan_payment_schedule.opening_principal is nullable: existing rows
    //     keep NULL (their opening is the previous row's closing, as
    //     always). A lender-imported schedule stores the lender's own
    //     opening figure here, so it is never replaced by a calculation.
    //   - two new tables. A disbursement or an initial expense can point at
    //     an EXISTING bank transaction (transaction_id); nothing here ever
    //     creates a bank transaction. A transaction can back at most one
    //     disbursement and at most one expense (the partial UNIQUE indexes),
    //     and LoanService / create_loan_atomic also refuse a transaction
    //     already used by an OD link, an EMI payment or the other table, so
    //     one bank movement is never counted twice.
    //
    // loans columns:
    //   loan_purpose                 free text
    //   rate_type                    FIXED | FLOATING
    //   interest_calculation_method  MONTHLY_RATE (rate / 12) | ACTUAL_365
    //   sanction_date, sanctioned_amount
    //   first_emi_date               the lender's actual first EMI date
    //   repayment_frequency          MONTHLY
    //   payment_day, grace_period_months, balloon_amount
    //   schedule_source              GENERATED | LENDER_CSV (NULL = legacy)
    //   drawing_power                OVERDRAFT only: caps the available limit
    sql: `
ALTER TABLE loans ADD COLUMN loan_purpose TEXT;
ALTER TABLE loans ADD COLUMN rate_type TEXT CHECK (rate_type IS NULL OR rate_type IN ('FIXED', 'FLOATING'));
ALTER TABLE loans ADD COLUMN interest_calculation_method TEXT CHECK (interest_calculation_method IS NULL OR interest_calculation_method IN ('MONTHLY_RATE', 'ACTUAL_365'));
ALTER TABLE loans ADD COLUMN sanction_date TEXT;
ALTER TABLE loans ADD COLUMN sanctioned_amount REAL;
ALTER TABLE loans ADD COLUMN first_emi_date TEXT;
ALTER TABLE loans ADD COLUMN repayment_frequency TEXT CHECK (repayment_frequency IS NULL OR repayment_frequency IN ('MONTHLY'));
ALTER TABLE loans ADD COLUMN payment_day INTEGER;
ALTER TABLE loans ADD COLUMN grace_period_months INTEGER;
ALTER TABLE loans ADD COLUMN balloon_amount REAL;
ALTER TABLE loans ADD COLUMN schedule_source TEXT CHECK (schedule_source IS NULL OR schedule_source IN ('GENERATED', 'LENDER_CSV'));
ALTER TABLE loans ADD COLUMN drawing_power REAL;

ALTER TABLE loan_payment_schedule ADD COLUMN opening_principal REAL;

CREATE TABLE IF NOT EXISTS loan_disbursements (
    id TEXT PRIMARY KEY,
    loan_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    disbursement_date TEXT NOT NULL,
    gross_amount REAL NOT NULL CHECK (gross_amount > 0),
    deductions_amount REAL NOT NULL DEFAULT 0 CHECK (deductions_amount >= 0),
    net_amount REAL NOT NULL CHECK (net_amount >= 0),
    destination_account_id TEXT,
    reference TEXT,
    transaction_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (loan_id, sequence),
    FOREIGN KEY (loan_id) REFERENCES loans(id),
    FOREIGN KEY (destination_account_id) REFERENCES accounts(id),
    FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_loan_disbursements_transaction
    ON loan_disbursements(transaction_id)
    WHERE transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_loan_disbursements_loan
    ON loan_disbursements(loan_id);

CREATE TABLE IF NOT EXISTS loan_initial_expenses (
    id TEXT PRIMARY KEY,
    loan_id TEXT NOT NULL,
    expense_type TEXT NOT NULL CHECK (expense_type IN ('PROCESSING_FEE', 'GST', 'INSURANCE_PREMIUM', 'LEGAL_CHARGES', 'DOCUMENTATION_CHARGES', 'VALUATION_CHARGES', 'STAMP_DUTY', 'OTHER_CHARGES')),
    description TEXT,
    expense_date TEXT NOT NULL,
    base_amount REAL NOT NULL CHECK (base_amount >= 0),
    gst_rate REAL CHECK (gst_rate IS NULL OR gst_rate >= 0),
    gst_amount REAL NOT NULL DEFAULT 0 CHECK (gst_amount >= 0),
    total_amount REAL NOT NULL CHECK (total_amount > 0),
    settlement TEXT NOT NULL CHECK (settlement IN ('DEDUCTED_FROM_DISBURSEMENT', 'PAID_SEPARATELY', 'CHARGED_TO_LOAN_ACCOUNT')),
    disbursement_id TEXT,
    payment_method TEXT,
    payment_account_id TEXT,
    transaction_reference TEXT,
    transaction_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (loan_id) REFERENCES loans(id),
    FOREIGN KEY (disbursement_id) REFERENCES loan_disbursements(id),
    FOREIGN KEY (payment_account_id) REFERENCES accounts(id),
    FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_loan_initial_expenses_transaction
    ON loan_initial_expenses(transaction_id)
    WHERE transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_loan_initial_expenses_loan
    ON loan_initial_expenses(loan_id);
`
};
