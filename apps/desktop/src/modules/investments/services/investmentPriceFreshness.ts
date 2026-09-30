import { toISODateString } from "@/core/formatting";

// ---------------------------------------------------------------------
// Investments - Phase 3 (price staleness rules)
//
// Single, reusable classification for how fresh a manually-entered
// investment price is, based on investments.price_updated_at
// (InvestmentService.ts sets this at creation and whenever
// currentPrice itself changes - see that file's top-of-class comment).
// Pure, no I/O - every component/page renders from this instead of
// re-deriving the rule itself.
//
// Rule (agreed, fixed - not user-configurable): a price is STALE once
// more than 30 full calendar days have passed since priceUpdatedAt.
// The boundary is inclusive of day 30 itself - a price updated exactly
// 30 days ago is still "fresh"; it becomes "stale" starting day 31.
// "unknown" (priceUpdatedAt is null, missing, or unparseable) is a
// distinct state from both - it is never treated as stale, since there
// is no date to measure staleness from and fabricating one would be
// worse than saying "unknown".
//
// Day counting uses local calendar dates (toISODateString), not a raw
// millisecond/UTC difference - the same convention already established
// for date-window logic in financial-goals/services/goalActuals.ts,
// and for the same reason: it keeps "how many days ago" answering the
// question the way a user would count it on a calendar, consistent
// regardless of what time of day the price happened to be saved at,
// and avoids ever taking the UTC calendar day of an ISO timestamp
// instead of the local one.
// ---------------------------------------------------------------------

/** A price is stale once more than this many calendar days have passed. */
export const INVESTMENT_PRICE_STALE_AFTER_DAYS = 30;

export type InvestmentPriceFreshness =
    | "unknown"
    | "fresh"
    | "stale";

function isValidDate(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0) {
        return false;
    }

    return !Number.isNaN(Date.parse(value));
}

/** Whole calendar days between two YYYY-MM-DD local-date strings (b - a). */
function daysBetween(
    fromDateStr: string,
    toDateStr: string
): number {
    const from = new Date(`${fromDateStr}T00:00:00Z`);
    const to = new Date(`${toDateStr}T00:00:00Z`);

    return Math.round(
        (to.getTime() - from.getTime()) / 86_400_000
    );
}

/**
 * Classifies an investment's price freshness from its stored
 * priceUpdatedAt. `asOf` is injectable for deterministic tests -
 * defaults to the local "today" (toISODateString(new Date())), the
 * same convention GoalActualsService uses for its own "as of" date.
 */
export function getInvestmentPriceFreshness(
    priceUpdatedAt: string | null | undefined,
    asOf: Date = new Date()
): InvestmentPriceFreshness {
    if (!isValidDate(priceUpdatedAt)) {
        return "unknown";
    }

    const updatedDate = toISODateString(
        new Date(priceUpdatedAt)
    );
    const asOfDate = toISODateString(asOf);

    const daysSinceUpdate = daysBetween(
        updatedDate,
        asOfDate
    );

    // A priceUpdatedAt in the future (clock skew, imported data, a
    // manual DB edit) is not stale - there is nothing to have gone
    // stale yet. Treat it as fresh rather than raise it as a problem.
    if (daysSinceUpdate < 0) {
        return "fresh";
    }

    return daysSinceUpdate >
        INVESTMENT_PRICE_STALE_AFTER_DAYS
        ? "stale"
        : "fresh";
}
