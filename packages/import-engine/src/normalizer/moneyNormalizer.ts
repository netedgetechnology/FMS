// The one reusable money/direction normalization layer shared by every
// import source (CSV, Excel, PDF). Statements represent the same fact -
// "X units of money moved in direction D" - in many equivalent ways:
//
//   - a single signed Amount column              ("-500.00", "(500.00)")
//   - a single Amount + a DR/CR marker           ("500.00 Dr", "500.00CR")
//   - separate Debit/Credit (Withdrawal/Deposit) columns, where the
//     unused one is blank, "-", or "0.00"
//   - currency symbols/codes and thousands separators ("₹1,05,000.00")
//
// Everything here is purely structural: no bank name, file name or
// statement-specific rule is ever consulted. Callers (csvNormalizer.ts
// for mapped columns, pdfParser.ts for positional PDF cells) hand raw
// cell text in and get the canonical FinWea shape out: a positive
// amount plus an income/expense/transfer direction.

export type MoneyMarker = "DR" | "CR";

export type CanonicalDirection =
    | "income"
    | "expense"
    | "transfer";

export interface ParsedMoney {
    // empty: nothing in the cell at all.
    // placeholder: an explicit "no value" filler ("-", "--", "nil").
    // value: a parseable number.
    // invalid: text that is not a money value.
    kind: "empty" | "placeholder" | "value" | "invalid";
    // Signed by explicit sign/parentheses only - a DR/CR marker is kept
    // separately in `marker`, because what a marker means depends on
    // whether the cell is a transaction amount or a running balance.
    value: number | null;
    magnitude: number | null;
    negative: boolean;
    marker: MoneyMarker | null;
    // Digits-only rendering of the magnitude, exactly as printed (e.g.
    // "105000.00" for "₹1,05,000.00 Dr"). null unless kind === "value".
    digits: string | null;
}

export interface ParseMoneyOptions {
    // Require an explicit 1-2 digit decimal part. Used for free-text
    // (PDF) tokens, where bare integers are far more likely to be
    // reference/cheque/account numbers than amounts.
    requireDecimal?: boolean;
    // Accept a single-letter "C"/"D" marker as well as "CR"/"DR". Only
    // safe where the caller already knows the letter sits in a marker
    // position (never for arbitrary text).
    allowSingleLetterMarker?: boolean;
}

const PLACEHOLDER_RE =
    /^(?:-{1,3}|–|—|nil|n\/a|na)$/i;

const CURRENCY_RE =
    /₹|\$|€|£|\bRs\.?|\bINR\b|\bUSD\b|\bEUR\b|\bGBP\b/gi;

const emptyResult = (
    kind: ParsedMoney["kind"],
): ParsedMoney => ({
    kind,
    value: null,
    magnitude: null,
    negative: false,
    marker: null,
    digits: null,
});

function toMarker(
    raw: string,
): MoneyMarker {
    return raw.toLowerCase().startsWith("d")
        ? "DR"
        : "CR";
}

// Splits a trailing (or leading) DR/CR marker off a money cell, e.g.
// "500.00 Dr", "500.00CR", "500.00 (Cr)", "Dr 500.00". The remainder must
// still contain a digit, so a bare "CR" is never treated as money.
function splitMarker(
    text: string,
    allowSingleLetter: boolean,
): { rest: string; marker: MoneyMarker | null } {
    const letters = allowSingleLetter
        ? "dr|cr|d|c"
        : "dr|cr";

    const suffix = text.match(
        new RegExp(
            `^(.*?\\d[\\d.,)]*)\\s*\\(?(${letters})\\.?\\)?$`,
            "i",
        ),
    );

    if (suffix?.[1] && suffix[2]) {
        return {
            rest: suffix[1],
            marker: toMarker(suffix[2]),
        };
    }

    const prefix = text.match(
        new RegExp(
            `^(${letters})\\.?\\s+(.*\\d.*)$`,
            "i",
        ),
    );

    if (prefix?.[1] && prefix[2]) {
        return {
            rest: prefix[2],
            marker: toMarker(prefix[1]),
        };
    }

    return { rest: text, marker: null };
}

export function parseMoney(
    raw: unknown,
    options: ParseMoneyOptions = {},
): ParsedMoney {
    if (raw === null || raw === undefined) {
        return emptyResult("empty");
    }

    const text = String(raw)
        .replace(/ /g, " ")
        .trim();

    if (!text) {
        return emptyResult("empty");
    }

    if (PLACEHOLDER_RE.test(text)) {
        return emptyResult("placeholder");
    }

    const { rest, marker } = splitMarker(
        text,
        options.allowSingleLetterMarker ??
            false,
    );

    let working = rest
        .replace(CURRENCY_RE, "")
        .replace(/\s/g, "")
        .replace(/,$/, "");

    let negative = false;

    // Accounting-style negative: both parens on this one cell.
    if (
        working.startsWith("(") &&
        working.endsWith(")")
    ) {
        negative = true;
        working = working.slice(1, -1);
    } else if (
        working.includes("(") ||
        working.includes(")")
    ) {
        return emptyResult("invalid");
    }

    if (working.startsWith("-")) {
        negative = !negative;
        working = working.slice(1);
    } else if (working.startsWith("+")) {
        working = working.slice(1);
    } else if (working.endsWith("-")) {
        // Trailing-minus convention, e.g. "500.00-".
        negative = !negative;
        working = working.slice(0, -1);
    }

    // A currency symbol may also sit after the sign ("-₹500.00").
    working = working.replace(CURRENCY_RE, "");

    // Thousands separators (Western and Indian grouping alike).
    const digits = working
        .replace(/,/g, "");

    const pattern = options.requireDecimal
        ? /^\d+\.\d{1,2}$/
        : /^(?:\d+(?:\.\d+)?|\.\d+)$/;

    if (!pattern.test(digits)) {
        return emptyResult("invalid");
    }

    // Commas must look like digit grouping, not a decimal comma.
    if (
        working.includes(",") &&
        !/^\d{1,3}(?:,\d{2,3})*(?:\.\d+)?$/.test(
            working,
        )
    ) {
        return emptyResult("invalid");
    }

    const magnitude = Number(digits);

    if (!Number.isFinite(magnitude)) {
        return emptyResult("invalid");
    }

    return {
        kind: "value",
        value: negative ? -magnitude : magnitude,
        magnitude,
        negative,
        marker,
        digits,
    };
}

// True when a cell carries no transaction amount: blank, a placeholder,
// or an unmarked zero (the "unused" side of a Debit/Credit pair).
export function isEmptyMoney(
    money: ParsedMoney,
): boolean {
    if (
        money.kind === "empty" ||
        money.kind === "placeholder"
    ) {
        return true;
    }

    return (
        money.kind === "value" &&
        money.magnitude === 0 &&
        money.marker === null
    );
}

// A running balance: a DR marker means overdrawn (negative); CR or no
// marker keeps the printed sign.
export function signedBalance(
    money: ParsedMoney,
): number | null {
    if (
        money.kind !== "value" ||
        money.magnitude === null
    ) {
        return null;
    }

    if (money.marker === "DR") {
        return -money.magnitude;
    }

    if (money.marker === "CR") {
        return money.magnitude;
    }

    return money.value;
}

export function parseBalance(
    raw: unknown,
    options: ParseMoneyOptions = {},
): number | null {
    return signedBalance(
        parseMoney(raw, options),
    );
}

// Free-text direction words from an explicit Type / Dr-Cr column.
export function normalizeDirectionText(
    value: unknown,
): CanonicalDirection | null {
    const raw = String(value ?? "")
        .replace(/ /g, " ")
        .trim()
        .toLowerCase()
        .replace(/\.$/, "");

    if (!raw) {
        return null;
    }

    if (
        [
            "income",
            "credit",
            "credits",
            "credited",
            "cr",
            "c",
            "deposit",
            "deposits",
            "received",
            "receipt",
        ].includes(raw)
    ) {
        return "income";
    }

    if (
        [
            "expense",
            "debit",
            "debits",
            "debited",
            "dr",
            "d",
            "db",
            "withdrawal",
            "withdrawals",
            "payment",
            "paid",
        ].includes(raw)
    ) {
        return "expense";
    }

    if (
        [
            "transfer",
            "trf",
            "fund transfer",
            "funds transfer",
        ].includes(raw)
    ) {
        return "transfer";
    }

    return null;
}

export function directionFromMarker(
    marker: MoneyMarker,
): CanonicalDirection {
    return marker === "DR"
        ? "expense"
        : "income";
}

export interface CanonicalAmountInput {
    amount?: unknown;
    debit?: unknown;
    credit?: unknown;
    typeText?: unknown;
    // True when the source has dedicated Debit/Credit columns. An
    // unsigned, unmarked Amount on such a row carries no direction of
    // its own (the columns were supposed to), so it is left undetermined
    // rather than guessed as income.
    hasDebitCreditColumns?: boolean;
}

export interface CanonicalAmount {
    // Always positive (or null when no amount could be found).
    amount: number | null;
    type: CanonicalDirection | null;
    source: "debit" | "credit" | "amount" | "none";
}

// The canonical resolution every importer uses. Priority:
//   1. A non-empty Debit cell   -> expense  (Withdrawal/Dr column)
//   2. A non-empty Credit cell  -> income   (Deposit/Cr column)
//   3. A single Amount cell     -> DR/CR marker, else explicit sign
// An explicit Type column always overrides the inferred direction.
export function resolveCanonicalAmount(
    input: CanonicalAmountInput,
): CanonicalAmount {
    const explicitType =
        normalizeDirectionText(input.typeText);

    const debit = parseMoney(input.debit);
    const credit = parseMoney(input.credit);

    if (
        debit.kind === "value" &&
        !isEmptyMoney(debit)
    ) {
        return {
            amount: debit.magnitude,
            type:
                explicitType ??
                (debit.marker
                    ? directionFromMarker(
                          debit.marker,
                      )
                    : "expense"),
            source: "debit",
        };
    }

    if (
        credit.kind === "value" &&
        !isEmptyMoney(credit)
    ) {
        return {
            amount: credit.magnitude,
            type:
                explicitType ??
                (credit.marker
                    ? directionFromMarker(
                          credit.marker,
                      )
                    : "income"),
            source: "credit",
        };
    }

    const amount = parseMoney(input.amount);

    if (
        amount.kind === "value" &&
        amount.magnitude !== null
    ) {
        let inferred: CanonicalDirection | null =
            null;

        if (amount.marker) {
            inferred = directionFromMarker(
                amount.marker,
            );
        } else if (amount.magnitude === 0) {
            inferred = null;
        } else if (amount.negative) {
            inferred = "expense";
        } else if (
            !input.hasDebitCreditColumns
        ) {
            inferred = "income";
        }

        return {
            amount: amount.magnitude,
            type: explicitType ?? inferred,
            source: "amount",
        };
    }

    return {
        amount: null,
        type: explicitType,
        source: "none",
    };
}
