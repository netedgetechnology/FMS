import { PDFParse } from "pdf-parse";
import type { CsvDocument } from "../types";
import {
    isEmptyMoney,
    parseBalance,
    parseMoney,
    signedBalance,
    type MoneyMarker,
    type ParsedMoney,
} from "../normalizer/moneyNormalizer";

let workerConfigured = false;

function configurePdfWorker(): void {
    if (workerConfigured) {
        return;
    }

    PDFParse.setWorker(
        new URL(
            "/pdf.worker.mjs",
            window.location.origin,
        ).toString(),
    );

    workerConfigured = true;
}

type RawLine = {
    text: string;
};

export interface PdfParseResult {
    document: CsvDocument;
    // True when extractBankTransactions found at least one structural
    // transaction block and produced buildBankDocument's canonical,
    // already-fully-parsed shape directly; false when it found none
    // and genericDocument's generic column-split fallback was used
    // instead. This is a structural fact about HOW the document was
    // built here, not a guess made later from what it happens to look
    // like (e.g. matching its headers against a fixed list) - callers
    // use it to decide whether a weaker generic second pass is still
    // needed at all (see processPdf in pipeline.ts).
    structured: boolean;
}

type Transaction = {
    date: string;
    description: string;
    amount: string;
    type: string;
    reference: string;
    debit: string;
    credit: string;
    balance: string;
};

// A transaction's trailing financial cells take one of these structural
// shapes. The shape is detected purely from which tokens at the end of a
// transaction block are money values, DR/CR markers or empty-cell
// placeholders - never from a bank name or statement vocabulary:
//   debit-credit-balance: [debit, credit, balance] where exactly one of
//       the first two is empty ("-" or an unmarked 0.00) - a statement
//       that prints its unused Debit/Credit column instead of leaving it
//       blank.
//   debit-credit: [debit, credit] with one side an explicit placeholder
//       and no balance.
//   amount-balance: [amount, balance] - covers "Amount DR/CR Balance",
//       a signed amount, and a Debit/Credit layout whose unused column
//       is blank (blank cells vanish from PDF text, leaving two numbers).
//   amount-only: [amount] - optionally signed or DR/CR/C/D-marked.
type TailShape =
    | "debit-credit-balance"
    | "debit-credit"
    | "amount-balance"
    | "amount-only";

type TailCell = {
    money: ParsedMoney;
    // Index (into the block's tokens) of the cell's first token.
    pos: number;
};

type TailMatch = {
    shape: TailShape;
    // Token index where the tail starts - everything before it is
    // description text.
    startPos: number;
    amount: ParsedMoney;
    // For the debit-credit shapes: which of the two positional
    // Debit/Credit columns held the value (0 = first, 1 = second).
    columnIndex: 0 | 1 | null;
    balance: ParsedMoney | null;
};

// Column facts read from the statement's own table header line, when
// one can be found. Every field is optional - absence just means the
// weaker structural defaults apply.
type HeaderLayout = {
    // true: a Debit/Withdrawal column precedes the Credit/Deposit one.
    debitFirst: boolean | null;
    // Where a dedicated reference/cheque column sits relative to the
    // description column.
    referenceSide: "before" | "after" | null;
};

type RawTransaction = {
    date: string;
    dateSortKey: number | null;
    description: string;
    reference: string;
    amountDigits: string;
    amountValue: number;
    // Direction stated by the row itself (DR/CR marker or sign).
    explicit: MoneyMarker | null;
    // Direction implied by which Debit/Credit column held the value.
    column: MoneyMarker | null;
    balanceText: string;
    balanceValue: number | null;
    type: MoneyMarker | null;
};

// Date fragments (not full-line patterns) so a date can be matched at the
// start of a line and the remainder consumed separately - this is what
// lets a 3-token "30 May 2026" date be recognised, not just single-token
// numeric dates.
const DATE_FRAGMENTS = [
    /\d{4}[-/]\d{1,2}[-/]\d{1,2}/,
    /\d{1,2}[-/][A-Za-z]{3}[-/]\d{2,4}/,
    /\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/,
    /\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}/,
];

const MONTH_NAMES: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
};

// Trailing financial tokens are required to look like a currency amount
// with an explicit decimal (\d[\d,]*\.\d{1,2}) - not a bare integer. Bank
// statements always print amounts with 2 decimal places, while reference
// numbers, cheque numbers and account numbers are frequently long bare
// integers; requiring the decimal point is what keeps those from being
// mistaken for a transaction amount.

// Standalone DR/CR marker tokens ("DR", "Cr.", "(CR)").
const MARKER_TOKEN_RE = /^\(?(dr|cr)\.?\)?$/i;

// A single-letter C/D marker is only trusted as the very last token of a
// transaction row, directly after its amount (e.g. "50,000.00 C") -
// anywhere else a lone letter is far more likely to be narration.
const SINGLE_LETTER_MARKER_RE = /^[CD]$/;

// An explicitly empty Debit/Credit cell.
const PLACEHOLDER_TOKEN_RE = /^(?:-{1,3}|–|—)$/;

// A currency symbol/code printed as its own token before an amount.
const CURRENCY_TOKEN_RE =
    /^(?:₹|\$|€|£|Rs\.?|INR|USD|EUR|GBP)$/i;

const OPENING_BALANCE_RE =
    /opening\s+balance[^\d-]{0,10}?(-?[\d,]+\.\d{1,2}(?:\s*(?:dr|cr)\b)?)/i;

// In-table carry-forward rows ("B/F", "Balance Brought Forward",
// "Opening Balance", and their closing counterparts). They restate a
// balance, they are never a money movement - a universal bookkeeping
// convention, not a bank-specific one.
const OPENING_ROW_RE =
    /^(?:b\/f|b\/fwd|brought\s+forward|balance\s+(?:b\/f|b\/fwd|brought\s+forward|forward)|opening\s+balance)\b/i;

const CLOSING_ROW_RE =
    /^(?:c\/f|c\/fwd|carried\s+forward|balance\s+(?:c\/f|c\/fwd|carried\s+forward)|closing\s+balance)\b/i;

const HEADER_DATE_RE = /\bdate\b/i;

const HEADER_MONEY_RE =
    /\b(?:balance|amount|debits?|credits?|withdrawals?|deposits?)\b/i;

const HEADER_DEBIT_RE =
    /\b(?:debits?|withdrawals?|paid\s+out|money\s+out|dr)\b/i;

const HEADER_CREDIT_RE =
    /\b(?:credits?|deposits?|paid\s+in|money\s+in|cr)\b/i;

const HEADER_DESCRIPTION_RE =
    /\b(?:description|narration|particulars|details|remarks)\b/i;

const HEADER_REFERENCE_RE =
    /\b(?:ref(?:erence)?|chq|cheque|utr)\b/i;

const MAX_BLOCK_LINES = 12;

function normalizeLines(text: string): RawLine[] {
    return text
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/ /g, " ")
        .split("\n")
        .map((text) => ({
            text: text.trim(),
        }))
        .filter((line) => line.text.length > 0);
}

// A single PDF text token that is a money value. Requires an explicit
// decimal part (\d.\d{1,2}): statements always print amounts with
// decimals, while reference, cheque and account numbers are frequently
// long bare integers - requiring the decimal point is what keeps those
// from being mistaken for a transaction amount. Parentheses must wrap
// the whole token ("(500.00)"); a half-paren token such as "0.00)"
// closing an "(EXCL TAX 0.00)" aside is never an amount.
function parseMoneyToken(
    token: string | undefined,
): ParsedMoney | null {
    if (!token) {
        return null;
    }

    const money = parseMoney(token, {
        requireDecimal: true,
    });

    return money.kind === "value"
        ? money
        : null;
}

function markerFromToken(
    token: string | undefined,
    isLastToken: boolean,
): MoneyMarker | null {
    if (!token) {
        return null;
    }

    const match = token.match(MARKER_TOKEN_RE);

    if (match?.[1]) {
        return match[1].toUpperCase() === "DR"
            ? "DR"
            : "CR";
    }

    if (
        isLastToken &&
        SINGLE_LETTER_MARKER_RE.test(token)
    ) {
        return token === "D" ? "DR" : "CR";
    }

    return null;
}

function formatSigned(
    value: number,
    digits: string,
): string {
    return value < 0 ? `-${digits}` : digits;
}

function tokenize(line: string): string[] {
    return line
        .split(/\s+/)
        .map((value) => value.trim())
        .filter(Boolean);
}

function matchLeadingDate(
    text: string,
): { value: string; rest: string } | null {
    for (const fragment of DATE_FRAGMENTS) {
        const anchored = new RegExp(
            `^(${fragment.source})`,
        );

        const match = text.match(anchored);

        if (match) {
            return {
                value: match[1] ?? "",
                rest: text
                    .slice(
                        (match[1] ?? "").length,
                    )
                    .trimStart(),
            };
        }
    }

    return null;
}

function stripLeadingSerial(text: string): string {
    const match = text.match(/^\d+\s+/);

    return match
        ? text.slice(match[0].length)
        : text;
}

function isTransactionStartLine(
    text: string,
): boolean {
    if (matchLeadingDate(text)) {
        return true;
    }

    const stripped = stripLeadingSerial(text);

    return (
        stripped !== text &&
        matchLeadingDate(stripped) !== null
    );
}

// Splits a transaction-start line into its leading date(s) (and an
// optional leading serial number) and the remaining text, without
// assuming dates are single whitespace-free tokens.
function stripLeadingDatesAndSerial(
    text: string,
): { dates: string[]; rest: string } {
    const trimmed = text.trim();
    const serialStripped =
        stripLeadingSerial(trimmed);

    const working =
        matchLeadingDate(serialStripped)
            ? serialStripped
            : trimmed;

    const first = matchLeadingDate(working);

    if (!first) {
        return { dates: [], rest: trimmed };
    }

    const dates = [first.value];
    let rest = first.rest;

    const second = matchLeadingDate(rest);

    if (second) {
        dates.push(second.value);
        rest = second.rest;
    }

    return { dates, rest };
}

function tokensForBlock(
    block: RawLine[],
): string[] {
    const [firstLine, ...restLines] = block;

    if (!firstLine) {
        return [];
    }

    const { rest } =
        stripLeadingDatesAndSerial(
            firstLine.text,
        );

    const tokens = tokenize(rest);

    for (const line of restLines) {
        tokens.push(...tokenize(line.text));
    }

    return tokens;
}

// Collects the trailing money cells of a block (scanning backward from
// the last money token, which tolerates trailing free text after the
// balance such as a branch name), then classifies them into a TailShape.
function findTail(
    tokens: string[],
    layout: HeaderLayout,
): TailMatch | null {
    let last = -1;

    for (
        let i = tokens.length - 1;
        i >= 0;
        i -= 1
    ) {
        if (parseMoneyToken(tokens[i])) {
            last = i;
            break;
        }
    }

    if (last < 0) {
        return null;
    }

    const lastIndex = tokens.length - 1;

    // A marker, or an empty-cell placeholder ending the row, directly
    // after the last amount still belongs to the tail.
    const next = tokens[last + 1];

    let k =
        markerFromToken(
            next,
            last + 1 === lastIndex,
        ) !== null ||
        (last + 1 === lastIndex &&
            PLACEHOLDER_TOKEN_RE.test(next ?? ""))
            ? last + 1
            : last;

    const cells: TailCell[] = [];

    while (k >= 0 && cells.length < 3) {
        const token = tokens[k];
        const marker = markerFromToken(
            token,
            k === lastIndex,
        );

        let cell: TailCell | null = null;

        if (marker) {
            const money = parseMoneyToken(
                tokens[k - 1],
            );

            if (!money) {
                break;
            }

            cell = {
                money: {
                    ...money,
                    marker: money.marker ?? marker,
                },
                pos: k - 1,
            };
        } else {
            const money = parseMoneyToken(token);

            if (money) {
                cell = { money, pos: k };
            } else if (
                token !== undefined &&
                PLACEHOLDER_TOKEN_RE.test(token) &&
                (cells.length > 0 || k > last)
            ) {
                cell = {
                    money: parseMoney(token),
                    pos: k,
                };
            }
        }

        if (!cell) {
            break;
        }

        let pos = cell.pos;

        if (
            CURRENCY_TOKEN_RE.test(
                tokens[pos - 1] ?? "",
            )
        ) {
            pos -= 1;
        }

        cells.unshift({ ...cell, pos });
        k = pos - 1;
    }

    return classifyTail(
        cells,
        layout.debitFirst !== null,
    );
}

// hasDebitCreditColumns: the statement's own header names separate
// Debit and Credit columns, so a leading "-" before a lone amount is that
// row's empty Debit cell rather than a dash ending the narration.
function classifyTail(
    cells: TailCell[],
    hasDebitCreditColumns: boolean,
): TailMatch | null {
    if (cells.length === 0) {
        return null;
    }

    const isValue = (cell: TailCell) =>
        cell.money.kind === "value";

    if (cells.length === 3) {
        const [first, second, balance] = cells as [
            TailCell,
            TailCell,
            TailCell,
        ];

        const firstEmpty = isEmptyMoney(first.money);
        const secondEmpty = isEmptyMoney(
            second.money,
        );

        if (
            isValue(balance) &&
            firstEmpty !== secondEmpty
        ) {
            return {
                shape: "debit-credit-balance",
                startPos: first.pos,
                amount: firstEmpty
                    ? second.money
                    : first.money,
                columnIndex: firstEmpty ? 1 : 0,
                balance: balance.money,
            };
        }

        if (firstEmpty && secondEmpty) {
            // Both Debit and Credit empty: surface the row with a zero
            // amount so validation flags it, never guess one.
            return {
                shape: "debit-credit-balance",
                startPos: first.pos,
                amount: first.money,
                columnIndex: null,
                balance: balance.money,
            };
        }

        // Neither side empty: the first "cell" is really a number at
        // the end of the narration - classify the last two alone.
        return classifyTail(
            cells.slice(1),
            hasDebitCreditColumns,
        );
    }

    if (cells.length === 2) {
        const [first, second] = cells as [
            TailCell,
            TailCell,
        ];

        if (first.money.kind === "placeholder") {
            if (
                hasDebitCreditColumns &&
                !isEmptyMoney(second.money)
            ) {
                return {
                    shape: "debit-credit",
                    startPos: first.pos,
                    amount: second.money,
                    columnIndex: 1,
                    balance: null,
                };
            }

            return classifyTail(
                cells.slice(1),
                hasDebitCreditColumns,
            );
        }

        if (second.money.kind === "placeholder") {
            return {
                shape: "debit-credit",
                startPos: first.pos,
                amount: first.money,
                columnIndex: 0,
                balance: null,
            };
        }

        if (
            isEmptyMoney(first.money) &&
            !isEmptyMoney(second.money)
        ) {
            // An unmarked 0.00 is never a real transaction amount, so
            // "0.00 500.00" is an unused Debit cell beside a Credit.
            return {
                shape: "debit-credit",
                startPos: first.pos,
                amount: second.money,
                columnIndex: 1,
                balance: null,
            };
        }

        return {
            shape: "amount-balance",
            startPos: first.pos,
            amount: first.money,
            columnIndex: null,
            balance: second.money,
        };
    }

    const [only] = cells as [TailCell];

    if (!isValue(only)) {
        return null;
    }

    return {
        shape: "amount-only",
        startPos: only.pos,
        amount: only.money,
        columnIndex: null,
        balance: null,
    };
}

function extractReference(
    description: string,
): string {
    const patterns = [
        /\b(?:NEFT|RTGS|IMPS|UPI|ACH|ECS)\/[A-Za-z0-9./_-]+/i,
        /\b[A-Z]{2,}[/-]\d{6,}[A-Za-z0-9/-]*/i,
        /\b\d{10,}\b/,
    ];

    for (const pattern of patterns) {
        const match = description.match(pattern);

        if (match?.[0]) {
            return match[0];
        }
    }

    return "";
}

function normalizeYear(year: number): number {
    if (year >= 100) {
        return year;
    }

    return year < 50 ? 2000 + year : 1900 + year;
}

// Converts any of the supported date formats into a comparable integer
// (YYYYMMDD) so transactions can be placed in true chronological order
// regardless of the order they appear in the statement, and regardless
// of which date format the statement uses.
function parseDateSortKey(
    raw: string,
): number | null {
    const cleaned = raw.trim();
    let match: RegExpMatchArray | null;

    match = cleaned.match(
        /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/,
    );

    if (match) {
        const [, y, mo, d] = match;

        return (
            Number(y) * 10000 +
            Number(mo) * 100 +
            Number(d)
        );
    }

    match = cleaned.match(
        /^(\d{1,2})[-/]([A-Za-z]{3})[-/](\d{2,4})$/,
    );

    if (match) {
        const [, d, monName, y] = match;
        const mo =
            MONTH_NAMES[
                (monName ?? "").toLowerCase()
            ];

        if (!mo) {
            return null;
        }

        return (
            normalizeYear(Number(y)) * 10000 +
            mo * 100 +
            Number(d)
        );
    }

    match = cleaned.match(
        /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/,
    );

    if (match) {
        const [, d, mo, y] = match;

        return (
            normalizeYear(Number(y)) * 10000 +
            Number(mo) * 100 +
            Number(d)
        );
    }

    match = cleaned.match(
        /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})$/,
    );

    if (match) {
        const [, d, monName, y] = match;
        const mo =
            MONTH_NAMES[
                (monName ?? "").toLowerCase()
            ];

        if (!mo) {
            return null;
        }

        return (
            normalizeYear(Number(y)) * 10000 +
            mo * 100 +
            Number(d)
        );
    }

    return null;
}

// Structural, not bank-specific: "opening balance" is a near-universal
// accounting term, used only to seed the running-balance anchor for
// direction inference below - never to identify a bank.
function findOpeningBalanceAnchor(
    lines: RawLine[],
): number | null {
    for (const line of lines) {
        const match = line.text.match(
            OPENING_BALANCE_RE,
        );

        if (match?.[1]) {
            const value = parseBalance(match[1]);

            if (value !== null) {
                return value;
            }
        }
    }

    return null;
}

function keywordIndex(
    text: string,
    pattern: RegExp,
): number {
    const match = pattern.exec(text);

    return match ? match.index : -1;
}

// Reads column order from the statement's own table header line: the
// first non-transaction line with no money values that names a date
// column and at least one money column. Repeated per-page headers are
// identical, so the first one is enough.
function detectHeaderLayout(
    lines: RawLine[],
): HeaderLayout {
    for (const line of lines) {
        const text = line.text;

        if (
            !HEADER_DATE_RE.test(text) ||
            !HEADER_MONEY_RE.test(text) ||
            isTransactionStartLine(text) ||
            tokenize(text).some(
                (token) =>
                    parseMoneyToken(token) !== null,
            )
        ) {
            continue;
        }

        // A combined "DR/CR" marker column says nothing about the order
        // of separate Debit/Credit columns.
        const withoutMarkerColumn = text.replace(
            /\b(?:dr|cr)\s*\/\s*(?:dr|cr)\b/gi,
            " ",
        );

        const debitAt = keywordIndex(
            withoutMarkerColumn,
            HEADER_DEBIT_RE,
        );

        const creditAt = keywordIndex(
            withoutMarkerColumn,
            HEADER_CREDIT_RE,
        );

        const descriptionAt = keywordIndex(
            text,
            HEADER_DESCRIPTION_RE,
        );

        const referenceAt = keywordIndex(
            text,
            HEADER_REFERENCE_RE,
        );

        return {
            debitFirst:
                debitAt >= 0 && creditAt >= 0
                    ? debitAt < creditAt
                    : null,
            referenceSide:
                descriptionAt >= 0 &&
                referenceAt >= 0
                    ? referenceAt < descriptionAt
                        ? "before"
                        : "after"
                    : null,
        };
    }

    return {
        debitFirst: null,
        referenceSide: null,
    };
}

// A token that can be a reference/cheque/UTR value on its own: a single
// alphanumeric run of 8+ characters containing a digit, and either all
// digits or upper-case letters and digits only (so ordinary narration
// words are not mistaken for one).
function looksLikeReference(
    token: string | undefined,
): boolean {
    if (!token) {
        return false;
    }

    return (
        /^[A-Za-z0-9]{8,}$/.test(token) &&
        /\d/.test(token) &&
        /^[A-Z0-9]+$/.test(token)
    );
}

// Splits a dedicated reference-column value off the narration, using the
// header's own column order: when the header puts a reference column
// before the description, it is the first narration token; when after,
// the last one. Falls back to pattern-matching the narration otherwise.
function splitReference(
    descriptionTokens: string[],
    layout: HeaderLayout,
): { description: string; reference: string } {
    let tokens = descriptionTokens;
    let reference = "";

    if (tokens.length > 1) {
        if (
            layout.referenceSide === "before" &&
            looksLikeReference(tokens[0])
        ) {
            reference = tokens[0] ?? "";
            tokens = tokens.slice(1);
        } else if (
            layout.referenceSide === "after" &&
            looksLikeReference(
                tokens[tokens.length - 1],
            )
        ) {
            reference =
                tokens[tokens.length - 1] ?? "";
            tokens = tokens.slice(0, -1);
        }
    }

    const description = tokens.join(" ").trim();

    return {
        description,
        reference:
            reference ||
            extractReference(description),
    };
}

type BuiltRow =
    | { kind: "transaction"; transaction: RawTransaction }
    | {
          kind: "opening";
          dateSortKey: number | null;
          balance: number | null;
      }
    | { kind: "closing" };

function buildRawTransaction(
    block: RawLine[],
    tail: TailMatch,
    layout: HeaderLayout,
): BuiltRow | null {
    const firstLine = block[0];

    if (!firstLine) {
        return null;
    }

    const { dates } =
        stripLeadingDatesAndSerial(
            firstLine.text,
        );

    const date = dates[0] ?? "";

    if (!date) {
        return null;
    }

    const tokens = tokensForBlock(block);

    const { description, reference } =
        splitReference(
            tokens.slice(0, tail.startPos),
            layout,
        );

    const dateSortKey = parseDateSortKey(date);

    const balanceValue = tail.balance
        ? signedBalance(tail.balance)
        : null;

    if (OPENING_ROW_RE.test(description)) {
        // A carry-forward row may print its balance as its only figure.
        return {
            kind: "opening",
            dateSortKey,
            balance:
                balanceValue ??
                signedBalance(tail.amount),
        };
    }

    if (CLOSING_ROW_RE.test(description)) {
        return { kind: "closing" };
    }

    const amount = tail.amount;

    const explicit: MoneyMarker | null =
        amount.marker ??
        (tail.columnIndex === null &&
        amount.negative
            ? "DR"
            : null);

    let column: MoneyMarker | null = null;

    if (tail.columnIndex !== null) {
        const debitFirst =
            layout.debitFirst ?? true;

        const isDebitColumn =
            tail.columnIndex === 0
                ? debitFirst
                : !debitFirst;

        column = isDebitColumn ? "DR" : "CR";
    }

    return {
        kind: "transaction",
        transaction: {
            date,
            dateSortKey,
            description,
            reference,
            amountDigits: amount.digits ?? "",
            amountValue: amount.magnitude ?? 0,
            explicit,
            column,
            balanceText:
                balanceValue === null
                    ? ""
                    : formatSigned(
                          balanceValue,
                          tail.balance?.digits ??
                              "",
                      ),
            balanceValue,
            type: null,
        },
    };
}

// Resolves each transaction's direction, strongest evidence first:
//   1. an explicit DR/CR marker or sign printed on the row;
//   2. the running balance moving by exactly the row's amount - the
//      statement's own arithmetic, independent of layout;
//   3. which Debit/Credit column the value sat in;
//   4. the running balance's direction of movement alone.
// Chronological order comes from the rows' own dates, so this works
// whether the statement lists oldest- or newest-first.
function resolveDirections(
    transactions: RawTransaction[],
    openingBalance: number | null,
): void {
    for (const transaction of transactions) {
        transaction.type =
            transaction.explicit ??
            transaction.column;
    }

    const dated = transactions
        .map((transaction, idx) => ({
            transaction,
            idx,
        }))
        .filter(
            (entry) =>
                entry.transaction.dateSortKey !==
                null,
        );

    if (dated.length === 0) {
        return;
    }

    const firstKey =
        dated[0]?.transaction.dateSortKey ?? 0;

    const lastKey =
        dated[dated.length - 1]?.transaction
            .dateSortKey ?? 0;

    const documentIsDescending =
        firstKey > lastKey;

    const sorted = [...dated].sort((a, b) => {
        const keyDiff =
            (a.transaction.dateSortKey ?? 0) -
            (b.transaction.dateSortKey ?? 0);

        if (keyDiff !== 0) {
            return keyDiff;
        }

        return documentIsDescending
            ? b.idx - a.idx
            : a.idx - b.idx;
    });

    let previousBalance = openingBalance;

    for (const { transaction } of sorted) {
        if (
            transaction.explicit === null &&
            previousBalance !== null &&
            transaction.balanceValue !== null
        ) {
            const delta =
                transaction.balanceValue -
                previousBalance;

            const deltaDirection: MoneyMarker =
                delta >= 0 ? "CR" : "DR";

            const exact =
                Math.abs(
                    Math.abs(delta) -
                        transaction.amountValue,
                ) < 0.005;

            transaction.type = exact
                ? deltaDirection
                : (transaction.column ??
                  deltaDirection);
        }

        previousBalance =
            transaction.balanceValue ??
            previousBalance;
    }
}

function extractBankTransactions(
    lines: RawLine[],
): Transaction[] {
    const layout = detectHeaderLayout(lines);

    const raw: RawTransaction[] = [];

    let openingRow: {
        dateSortKey: number | null;
        balance: number;
    } | null = null;

    let i = 0;

    while (i < lines.length) {
        const current = lines[i];

        if (
            !current ||
            !isTransactionStartLine(current.text)
        ) {
            i += 1;
            continue;
        }

        const block: RawLine[] = [];
        let tail: TailMatch | null = null;
        let j = i;

        while (j < lines.length) {
            const line = lines[j];

            if (!line) {
                break;
            }

            if (
                j > i &&
                isTransactionStartLine(line.text)
            ) {
                break;
            }

            block.push(line);

            const candidate = findTail(
                tokensForBlock(block),
                layout,
            );

            j += 1;

            // A tail with no description tokens before it
            // (startPos === 0) is never accepted as a real
            // transaction - a bare summary/total line (a date
            // immediately followed by amount/balance numbers, with
            // nothing describing what they're for, e.g. a statement's
            // own "Payment Due Date" / "Total Amount Due" figures) is
            // never a genuine transaction on any real statement; every
            // real transaction has at least some narration between its
            // date and its amount. Not accepting it here (rather than
            // treating it as terminal) lets the block keep growing in
            // case a later line completes a legitimate multi-line
            // description before the real tail appears.
            if (
                candidate &&
                candidate.startPos > 0
            ) {
                tail = candidate;
                break;
            }

            if (block.length >= MAX_BLOCK_LINES) {
                break;
            }
        }

        if (tail) {
            const built = buildRawTransaction(
                block,
                tail,
                layout,
            );

            if (built?.kind === "transaction") {
                raw.push(built.transaction);
            } else if (
                built?.kind === "opening" &&
                built.balance !== null &&
                (openingRow === null ||
                    (built.dateSortKey ?? 0) <
                        (openingRow.dateSortKey ?? 0))
            ) {
                openingRow = {
                    dateSortKey: built.dateSortKey,
                    balance: built.balance,
                };
            }

            i = j;
        } else {
            i += 1;
        }
    }

    resolveDirections(
        raw,
        openingRow?.balance ??
            findOpeningBalanceAnchor(lines),
    );

    return raw.map((transaction) => ({
        date: transaction.date,
        description: transaction.description,
        amount: transaction.amountDigits,
        type: transaction.type ?? "",
        reference: transaction.reference,
        debit:
            transaction.type === "DR"
                ? transaction.amountDigits
                : "",
        credit:
            transaction.type === "CR"
                ? transaction.amountDigits
                : "",
        balance: transaction.balanceText,
    }));
}

function buildBankDocument(
    transactions: Transaction[],
): CsvDocument {
    return {
        headers: [
            "Date",
            "Description",
            "Amount",
            "Type",
            "Reference",
            "Debit",
            "Credit",
            "Balance",
        ],
        rows: transactions.map(
            (transaction, index) => ({
                rowNumber: index + 1,
                values: [
                    transaction.date,
                    transaction.description,
                    transaction.amount,
                    transaction.type,
                    transaction.reference,
                    transaction.debit,
                    transaction.credit,
                    transaction.balance,
                ],
            }),
        ),
    };
}

function splitGenericLine(
    line: string,
): string[] {
    const tabParts =
        line.split(/\t+/)
            .map((value) => value.trim())
            .filter(Boolean);

    if (tabParts.length > 1) {
        return tabParts;
    }

    return line
        .split(/\s{2,}/)
        .map((value) => value.trim())
        .filter(Boolean);
}

function genericDocument(
    lines: RawLine[],
): CsvDocument {
    const rows = lines
        .map((line) =>
            splitGenericLine(line.text),
        )
        .filter((row) => row.length > 0);

    if (rows.length === 0) {
        return {
            headers: [],
            rows: [],
        };
    }

    const columnCount =
        Math.max(
            ...rows.map(
                (row) => row.length,
            ),
        );

    const headers = Array.from(
        { length: columnCount },
        (_, index) =>
            `Column ${index + 1}`,
    );

    return {
        headers,
        rows: rows.map(
            (values, index) => ({
                rowNumber: index + 1,
                values: [
                    ...values,
                    ...Array(
                        Math.max(
                            0,
                            columnCount -
                                values.length,
                        ),
                    ).fill(""),
                ],
            }),
        ),
    };
}

// The pure text-to-document half of parsePdf: everything after pdf-parse
// has produced the page text. Exported so extraction can be exercised
// directly on captured statement text (see tests/pdfCompatibility), with
// no PDF binary or pdf.js worker involved.
export function parsePdfText(
    text: string,
): PdfParseResult {
    const lines = normalizeLines(text);

    const transactions =
        extractBankTransactions(lines);

    if (transactions.length > 0) {
        return {
            document: buildBankDocument(
                transactions,
            ),
            structured: true,
        };
    }

    return {
        document: genericDocument(lines),
        structured: false,
    };
}

export async function extractPdfText(
    content: ArrayBuffer,
): Promise<string> {
    configurePdfWorker();

    const parser = new PDFParse({
        data: new Uint8Array(content),
        useWorkerFetch: false,
        isEvalSupported: false,
    });

    try {
        const result =
            await parser.getText();

        return result.text;
    } finally {
        await parser.destroy();
    }
}

export async function parsePdf(
    content: ArrayBuffer,
): Promise<PdfParseResult> {
    return parsePdfText(
        await extractPdfText(content),
    );
}
