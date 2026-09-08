import {
    detectDelimiterAndHeader,
} from "./tableDetector";

import {
    splitCsvLines,
    stripBom,
} from "./csvParser";

// Virtually every bank statement export self-identifies somewhere in its
// letterhead/metadata or its terms-and-conditions/branch-address footer as
// "<Proper Noun(s)> Bank" (e.g. "Axis Bank", "HDFC BANK LTD", "State Bank
// of India"...). Matching that generic shape - a run of capitalized words
// immediately followed by the word "Bank" - lets us surface a sensible
// institution name for ANY bank without a lookup table of known bank
// names or any bank-specific parsing.
const BANK_NAME_PATTERN =
    /\b((?:[A-Z][A-Za-z.&]*\s+){1,3}(?:Bank|BANK))\b/;

function toTitleCase(text: string): string {
    return text
        .toLowerCase()
        .replace(/\b\w/g, char => char.toUpperCase());
}

function findBankName(
    lines: string[]
): string | null {
    for (const line of lines) {
        const match = line.match(
            BANK_NAME_PATTERN
        );

        if (match?.[1]) {
            return toTitleCase(
                match[1].trim()
            );
        }
    }

    return null;
}

// Detects the source institution/bank name from a CSV's non-transaction
// text - the metadata preamble before the header and any footer/legend
// content after the transaction body - deliberately excluding the
// transaction rows themselves, where a counterparty bank name in a
// UPI/NEFT narration (e.g. "...Sent u/HDFC BANK LTD") would otherwise be
// mistaken for the statement's own bank. Reuses the same header/body
// boundary detection the parser already relies on. Returns null when no
// bank name is found - callers should treat that as "unknown", not an
// error.
export function detectInstitutionName(
    content: string
): string | null {
    const lines = splitCsvLines(
        stripBom(content)
    );

    if (lines.length === 0) {
        return null;
    }

    const { headerIndex, bodyLength } =
        detectDelimiterAndHeader(lines);

    const bodyEndIndex =
        bodyLength === null
            ? lines.length
            : Math.min(
                  lines.length,
                  headerIndex + 1 + bodyLength
              );

    const nonBodyLines = [
        ...lines.slice(0, headerIndex),
        ...lines.slice(bodyEndIndex),
    ];

    return findBankName(nonBodyLines);
}
