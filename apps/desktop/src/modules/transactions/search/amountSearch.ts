// ---------------------------------------------------------------------
// Amount search for the Transactions list. A search like "10,004",
// "₹10,004.00" or "10004" is read as an amount and matches a transaction
// whose amount is exactly that value - never a substring of a longer one
// (10,004 does not match 110,004 or 10,004.50). Income and expense, and a
// negative stored amount, all match by their absolute value. Text that is
// not an amount returns null, so only the existing text search applies.
// Pure: no database, no React.
// ---------------------------------------------------------------------

// Currency markers allowed before or after the number: ₹, Rs, Rs., INR.
const CURRENCY = /^(?:₹|rs\.?|inr)\s*|\s*(?:₹|rs\.?|inr)$/i;

// Digits with optional comma grouping (Indian 1,00,004 or Western
// 100,004 - commas only between digits), and at most two decimals.
const AMOUNT = /^\d+(?:,\d+)*(?:\.\d{1,2})?$/;

/**
 * The amount a search query names, in paise (integer), or null when the
 * query is not an amount. Accepts an optional sign and currency marker in
 * either order, e.g. "-₹10,004", "₹ 10,004.00", "10004 INR".
 */
export function parseAmountQuery(query: string): number | null {
    let text = query.trim();
    if (!text) return null;

    let sign = "";
    const takeSign = () => {
        if (text.startsWith("-") || text.startsWith("+")) {
            sign = sign || text[0]!;
            text = text.slice(1).trim();
        }
    };

    takeSign();
    const withoutCurrency = text.replace(CURRENCY, "").trim();
    if (withoutCurrency !== text) {
        text = withoutCurrency;
        takeSign();
    }

    if (!AMOUNT.test(text)) return null;

    const value = Number(text.replace(/,/g, ""));
    if (!Number.isFinite(value)) return null;
    return Math.round(value * 100);
}

/** True when the transaction's amount (absolute, to the paisa) is exactly the queried amount. */
export function matchesAmount(amount: number | null | undefined, queryPaise: number): boolean {
    const value = Number(amount);
    if (!Number.isFinite(value)) return false;
    return Math.round(Math.abs(value) * 100) === queryPaise;
}
