import { IMigration } from "../types/IMigration";

// Registered 2026-11-10 with the owner's explicit approval.
export const DroplineDrawingPowerScheduleMigration: IMigration = {
    version: 53,
    name: "Dropline Drawing Power Schedule",
    // A Dropline Overdraft is an OVERDRAFT (loan_kind is unchanged, so every
    // existing OD path - links, Used, import matching - still applies) whose
    // drawing power falls on dated steps. Having rows here is what makes an
    // overdraft a dropline; the amount in force on a date is the latest step
    // on or before it (loans/setup/droplineSchedule.ts).
    //
    // Purely additive: a new empty table. No loan, schedule, payment or
    // transaction row is read or changed.
    sql: `
CREATE TABLE IF NOT EXISTS loan_drawing_power_schedule (
    id TEXT PRIMARY KEY,
    loan_id TEXT NOT NULL,
    effective_date TEXT NOT NULL,
    drawing_power REAL NOT NULL CHECK (drawing_power >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (loan_id, effective_date),
    FOREIGN KEY (loan_id) REFERENCES loans(id)
);

CREATE INDEX IF NOT EXISTS idx_loan_drawing_power_schedule_loan
ON loan_drawing_power_schedule(loan_id, effective_date)
`,
};
