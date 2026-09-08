import type { TransactionChannel } from "../types";

const KNOWN_CHANNELS: ReadonlySet<TransactionChannel> = new Set([
    "UPI",
    "IMPS",
    "NEFT",
    "RTGS",
    "CASH",
    "CHEQUE",
    "EMANDATE",
    "NET_BANKING",
    "MOBILE_APP",
]);

// Ordered, most-specific tokens first. Each is a whole-word,
// case-insensitive match against the row's combined narration text -
// deliberately conservative (no partial-word or fuzzy matching) so an
// unrelated word is never mistaken for a channel. Generic by design: not
// tied to any bank's narration format, just the standard rail
// abbreviations every Indian bank statement uses.
const CHANNEL_PATTERNS: ReadonlyArray<{
    channel: TransactionChannel;
    pattern: RegExp;
}> = [
    { channel: "UPI", pattern: /\bUPI\b/i },
    { channel: "IMPS", pattern: /\bIMPS\b/i },
    { channel: "NEFT", pattern: /\bNEFT\b/i },
    { channel: "RTGS", pattern: /\bRTGS\b/i },
    {
        channel: "CASH",
        pattern: /\bATM\b|\bCASH\b/i,
    },
    {
        channel: "CHEQUE",
        pattern: /\bCHQ\b|\bCHEQUE\b/i,
    },
];

// Detects the transaction channel from whatever narration text is
// available (description, payee, reference, ...). Returns null - never a
// guess - when no unambiguous channel token is present.
export function detectTransactionChannel(
    ...texts: Array<string | null | undefined>
): TransactionChannel | null {
    const combined = texts
        .filter((text): text is string => Boolean(text))
        .join(" ");

    if (!combined) {
        return null;
    }

    for (const {
        channel,
        pattern,
    } of CHANNEL_PATTERNS) {
        if (pattern.test(combined)) {
            return channel;
        }
    }

    return null;
}

// Normalizes an explicit source-column value (e.g. "upi", "Upi", " NEFT ")
// to one of the known channels, or null when it isn't one - never guessed
// from an unrecognized value.
export function normalizeTransactionChannel(
    value: string | null | undefined
): TransactionChannel | null {
    if (!value) {
        return null;
    }

    const upper = value
        .trim()
        .toUpperCase();

    return KNOWN_CHANNELS.has(
        upper as TransactionChannel
    )
        ? (upper as TransactionChannel)
        : null;
}
