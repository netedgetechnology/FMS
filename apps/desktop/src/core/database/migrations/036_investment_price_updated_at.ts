import { IMigration } from "../types/IMigration";

export const InvestmentPriceUpdatedAtMigration: IMigration = {
    version: 36,
    name: "Investment Price Updated At",
    // Tracks when current_price was last changed (set at creation, and
    // whenever InvestmentService.update sees a different currentPrice
    // than what is stored - see InvestmentService.ts). Never touched by
    // transaction-driven recalculation (updatePortfolioValues), since
    // that only re-derives quantity/average_cost/current_value from the
    // ledger and never changes current_price itself. NULL for existing
    // rows - "unknown", not "stale" - the UI treats that as its own
    // distinct label rather than guessing a date.
    sql: `
ALTER TABLE investments ADD COLUMN price_updated_at TEXT;
`
};
