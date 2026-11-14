import { IMigration } from "../types/IMigration";

// ---------------------------------------------------------------------
// Interest Rate History (Stage 1): one row per rate a loan has carried,
// from the date it took effect. Additive only - no existing table, row or
// loan rate changes, and existing loans get no rows (their history starts
// when one is recorded). Stage 3.1: loans.interest_rate is a snapshot of
// the rate in force on the day of the last save; for a loan with history
// the current rate is derived from its live rows (an upcoming row's date
// can pass between saves). See setup/interestRateHistory.ts.
//
//   effective_from           the date the rate applies from (YYYY-MM-DD).
//                            "Effective until" is never stored: it is the
//                            day before the next live row's effective_from.
//   rate / previous_rate     % per year; previous_rate NULL for the first.
//   rate_type                FIXED | FLOATING, when known.
//   source                   INITIAL (with the loan) | MANUAL |
//                            STATEMENT_IMPORT | LENDER_NOTICE.
//   reference, document_id   supporting reference / an existing document.
//   applied_from_instalment  the first instalment the rate priced, when a
//                            schedule was re-priced from it (Stage 2+).
//   superseded_by / _at,     a row is never edited: a correction adds a new
//   correction_reason        row and marks this one superseded, with why.
//
// Live rows (superseded_at IS NULL) are unique per loan and date: a loan
// has ONE rate in force from any date, so neither the same change twice nor
// two different rates on one date can be stored (pre-activation audit M2).
// A correction on the same date supersedes the old row first, then inserts
// its replacement, in one transaction (rate_change.rs, with deferred
// foreign keys for superseded_by).
//
// NOT REGISTERED in registry.ts yet: applying it to the live database is
// the user's decision (back up first; see the migration test for what it
// does). create_loan_atomic only writes the initial row when this table
// exists.
// ---------------------------------------------------------------------

export const LoanInterestRateHistoryMigration: IMigration = {
    version: 54,
    name: "Loan Interest Rate History",
    sql: `
CREATE TABLE IF NOT EXISTS loan_interest_rate_history (
    id TEXT PRIMARY KEY,
    loan_id TEXT NOT NULL,
    effective_from TEXT NOT NULL CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
    rate REAL NOT NULL CHECK (rate >= 0 AND rate <= 100),
    previous_rate REAL CHECK (previous_rate IS NULL OR (previous_rate >= 0 AND previous_rate <= 100)),
    rate_type TEXT CHECK (rate_type IS NULL OR rate_type IN ('FIXED', 'FLOATING')),
    source TEXT NOT NULL CHECK (source IN ('INITIAL', 'MANUAL', 'STATEMENT_IMPORT', 'LENDER_NOTICE')),
    reference TEXT,
    document_id TEXT,
    notes TEXT,
    applied_from_instalment INTEGER CHECK (applied_from_instalment IS NULL OR applied_from_instalment >= 1),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    superseded_by TEXT,
    superseded_at TEXT,
    correction_reason TEXT,
    CHECK ((superseded_by IS NULL) = (superseded_at IS NULL)),
    CHECK (superseded_by IS NULL OR superseded_by <> id),
    CHECK (superseded_at IS NULL OR length(trim(coalesce(correction_reason, ''))) > 0),
    FOREIGN KEY (loan_id) REFERENCES loans(id),
    FOREIGN KEY (document_id) REFERENCES documents(id),
    FOREIGN KEY (superseded_by) REFERENCES loan_interest_rate_history(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_loan_interest_rate_history_live
ON loan_interest_rate_history(loan_id, effective_from)
WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_loan_interest_rate_history_loan
ON loan_interest_rate_history(loan_id, effective_from)
`,
};
