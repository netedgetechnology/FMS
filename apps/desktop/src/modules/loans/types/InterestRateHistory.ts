// Interest Rate History (migration 054). One row per rate a loan has
// carried, from the date it took effect. Rows are never edited: a
// correction adds a new row and marks the old one superseded.

export const INTEREST_RATE_SOURCES = ["INITIAL", "MANUAL", "STATEMENT_IMPORT", "LENDER_NOTICE"] as const;

export type InterestRateSource = (typeof INTEREST_RATE_SOURCES)[number];

export const INTEREST_RATE_SOURCE_LABELS: Record<InterestRateSource, string> = {
    INITIAL: "Initial rate",
    MANUAL: "Entered manually",
    STATEMENT_IMPORT: "Lender statement",
    LENDER_NOTICE: "Lender notice",
};

export interface InterestRateHistoryEntry {
    id: string;
    loanId: string;
    /** YYYY-MM-DD: the rate applies from this date. */
    effectiveFrom: string;
    /**
     * Derived, never stored: the day before the next live entry's
     * effectiveFrom; null for the current rate and for superseded entries.
     */
    effectiveUntil: string | null;
    /** % per year. */
    rate: number;
    previousRate: number | null;
    rateType: "FIXED" | "FLOATING" | null;
    source: InterestRateSource;
    reference: string | null;
    documentId: string | null;
    notes: string | null;
    /** The first instalment re-priced from this rate, when one was. */
    appliedFromInstalment: number | null;
    createdAt: string;
    supersededBy: string | null;
    supersededAt: string | null;
    correctionReason: string | null;
}
