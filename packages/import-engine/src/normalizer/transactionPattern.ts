// A stable, generic "shape" of a transaction's narration text, used to
// recognize "this is the same kind of transaction I've seen before" (e.g.
// a recurring UPI payment to the same person) so a previously-confirmed
// Counterparty can be suggested again - without any bank-specific parsing.
//
// The only normalization applied is collapsing every run of digits to a
// single placeholder and canonicalizing whitespace/case. Bank narrations
// for the *same* recurring transaction are typically identical except for
// a transaction id / reference number / amount, all of which are purely
// numeric, so this alone is enough to make repeats collapse to the same
// pattern while genuinely different transactions (different counterparty
// name, different words) do not.
const DIGIT_RUN_PATTERN = /\d+/g;
const WHITESPACE_PATTERN = /\s+/g;

// Patterns shorter than this carry too little identifying information to
// safely learn from (avoids ambiguous/overly-broad matches, e.g. a bare
// "ATM WDL" pattern accidentally applying to unrelated cash withdrawals).
const MIN_PATTERN_LENGTH = 8;

export function extractTransactionPattern(
    text: string | null | undefined
): string | null {
    if (!text) {
        return null;
    }

    const pattern = text
        .toUpperCase()
        .replace(DIGIT_RUN_PATTERN, "#")
        .replace(WHITESPACE_PATTERN, " ")
        .trim();

    return pattern.length >= MIN_PATTERN_LENGTH
        ? pattern
        : null;
}
