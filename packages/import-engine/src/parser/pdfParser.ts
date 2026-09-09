import { PDFParse } from "pdf-parse";
import type { CsvDocument } from "../types";

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

// A transaction's trailing financial fields take one of three structural
// shapes across real-world statements (most specific first):
//   1. amount + DR/CR marker + running balance (e.g. Axis Bank)
//   2. amount + running balance, direction unmarked (e.g. YES Bank) -
//      direction is inferred later from the balance delta between
//      chronologically adjacent transactions.
//   3. amount only - direction left undetermined.
// No bank name or header vocabulary is used to pick between these; the
// shape is detected purely from which tokens at the end of a transaction
// block look like currency amounts vs a CR/DR marker.
type TailShape =
    | "amount-type-balance"
    | "amount-balance"
    | "amount-only";

type TailMatch = {
    shape: TailShape;
    amountPos: number;
    typePos?: number;
    balancePos?: number;
};

type RawTransaction = {
    date: string;
    dateSortKey: number | null;
    description: string;
    amount: string;
    type: string;
    reference: string;
    balance: string;
    balanceValue: number | null;
    shape: TailShape;
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
const STRICT_AMOUNT_RE =
    /^[-+]?(?:₹|\$|€|£)?\s*\d[\d,]*\.\d{1,2}$/;

const CR_DR_RE = /^(CR|DR)$/i;

const OPENING_BALANCE_RE =
    /opening\s+balance\D{0,10}?([\d,]+\.\d{1,2})/i;

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

function isAmount(value: string): boolean {
    const trimmed = value.trim();

    const hasOpenParen = trimmed.startsWith("(");
    const hasCloseParen = trimmed.endsWith(")");

    // Parentheses only ever denote a self-contained accounting-style
    // negative amount on THIS token, e.g. "(500.00)" - both the opening
    // and closing paren must be present on the same token. A token with
    // only one of the two - "0.00)" closing a parenthetical annotation
    // opened several tokens earlier (e.g. "(EXCL TAX 0.00)"), or
    // "(500.00" opening one - is never an amount. Accepting either half
    // in isolation is what let a tax/annotation figure inside a
    // "(EXCL TAX 0.00)" aside be mistaken by findTail() for the real
    // trailing transaction amount.
    if (hasOpenParen !== hasCloseParen) {
        return false;
    }

    const unwrapped =
        hasOpenParen && hasCloseParen
            ? trimmed.slice(1, -1)
            : trimmed;

    const cleaned = unwrapped.replace(/,$/, "");

    return STRICT_AMOUNT_RE.test(cleaned);
}

function cleanAmount(value: string): string {
    return value
        .replace(/[₹$€£]/g, "")
        .replace(/,/g, "")
        .replace(/[()]/g, "")
        .trim();
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

// Scans backward from the end of the block's tokens for the most
// specific qualifying tail shape. Scanning backward (rather than
// requiring a match at the very last token) tolerates trailing free text
// after the balance, such as a branch name.
function findTail(
    tokens: string[],
): TailMatch | null {
    for (
        let i = tokens.length - 1;
        i >= 0;
        i -= 1
    ) {
        if (!isAmount(tokens[i] ?? "")) {
            continue;
        }

        if (
            i >= 2 &&
            CR_DR_RE.test(tokens[i - 1] ?? "") &&
            isAmount(tokens[i - 2] ?? "")
        ) {
            return {
                shape: "amount-type-balance",
                amountPos: i - 2,
                typePos: i - 1,
                balancePos: i,
            };
        }

        if (
            i >= 1 &&
            isAmount(tokens[i - 1] ?? "")
        ) {
            return {
                shape: "amount-balance",
                amountPos: i - 1,
                balancePos: i,
            };
        }

        return {
            shape: "amount-only",
            amountPos: i,
        };
    }

    return null;
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
// accounting term (present verbatim in both real fixtures, in different
// positions in the document), used only to seed the running-balance
// anchor for direction inference below - never to identify a bank.
function findOpeningBalanceAnchor(
    lines: RawLine[],
): number | null {
    for (const line of lines) {
        const match = line.text.match(
            OPENING_BALANCE_RE,
        );

        if (match?.[1]) {
            const value = Number(
                cleanAmount(match[1]),
            );

            if (!Number.isNaN(value)) {
                return value;
            }
        }
    }

    return null;
}

function buildRawTransaction(
    block: RawLine[],
    tail: TailMatch,
): RawTransaction | null {
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

    const description = tokens
        .slice(0, tail.amountPos)
        .join(" ")
        .trim();

    const amount = cleanAmount(
        tokens[tail.amountPos] ?? "",
    );

    const type =
        tail.shape === "amount-type-balance"
            ? (
                  tokens[tail.typePos ?? -1] ?? ""
              ).toUpperCase()
            : "";

    const balance =
        tail.shape !== "amount-only"
            ? cleanAmount(
                  tokens[tail.balancePos ?? -1] ??
                      "",
              )
            : "";

    return {
        date,
        dateSortKey: parseDateSortKey(date),
        description,
        amount,
        type,
        reference: extractReference(description),
        balance,
        balanceValue:
            balance === "" ? null : Number(balance),
        shape: tail.shape,
    };
}

// For transactions with no DR/CR marker (the "amount-balance" shape),
// infers the direction from the change in running balance between
// chronologically adjacent transactions - increasing balance is a
// credit, decreasing balance is a debit. Works regardless of whether the
// statement itself lists transactions oldest-first or newest-first,
// since it sorts by the transactions' own parsed dates rather than
// relying on document order.
function inferDirections(
    transactions: RawTransaction[],
    openingBalance: number | null,
): void {
    const withBalance = transactions
        .map((transaction, idx) => ({
            transaction,
            idx,
        }))
        .filter(
            (entry) =>
                entry.transaction.balanceValue !==
                    null &&
                entry.transaction.dateSortKey !==
                    null,
        );

    if (withBalance.length === 0) {
        return;
    }

    const firstKey =
        withBalance[0]?.transaction.dateSortKey ??
        0;

    const lastKey =
        withBalance[withBalance.length - 1]
            ?.transaction.dateSortKey ?? 0;

    const documentIsDescending = firstKey > lastKey;

    const sorted = [...withBalance].sort(
        (a, b) => {
            const keyDiff =
                (a.transaction.dateSortKey ?? 0) -
                (b.transaction.dateSortKey ?? 0);

            if (keyDiff !== 0) {
                return keyDiff;
            }

            return documentIsDescending
                ? b.idx - a.idx
                : a.idx - b.idx;
        },
    );

    let previousBalance = openingBalance;

    for (const entry of sorted) {
        const transaction = entry.transaction;

        if (
            transaction.shape ===
                "amount-balance" &&
            previousBalance !== null &&
            transaction.balanceValue !== null
        ) {
            const delta =
                transaction.balanceValue -
                previousBalance;

            transaction.type =
                delta >= 0 ? "CR" : "DR";
        }

        previousBalance =
            transaction.balanceValue ??
            previousBalance;
    }
}

function extractBankTransactions(
    lines: RawLine[],
): Transaction[] {
    const openingBalance =
        findOpeningBalanceAnchor(lines);

    const raw: RawTransaction[] = [];

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
            );

            j += 1;

            // A tail with no description tokens before it
            // (amountPos === 0) is never accepted as a real
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
                candidate.amountPos > 0
            ) {
                tail = candidate;
                break;
            }

            if (block.length >= MAX_BLOCK_LINES) {
                break;
            }
        }

        if (tail) {
            const transaction = buildRawTransaction(
                block,
                tail,
            );

            if (transaction) {
                raw.push(transaction);
            }

            i = j;
        } else {
            i += 1;
        }
    }

    inferDirections(raw, openingBalance);

    return raw.map((transaction) => ({
        date: transaction.date,
        description: transaction.description,
        amount: transaction.amount,
        type: transaction.type,
        reference: transaction.reference,
        debit:
            transaction.type === "DR"
                ? transaction.amount
                : "",
        credit:
            transaction.type === "CR"
                ? transaction.amount
                : "",
        balance: transaction.balance,
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

export async function parsePdf(
    content: ArrayBuffer,
): Promise<PdfParseResult> {
    configurePdfWorker();

    const parser = new PDFParse({
        data: new Uint8Array(content),
        useWorkerFetch: false,
        isEvalSupported: false,
    });

    try {
        const result =
            await parser.getText();

        const lines =
            normalizeLines(result.text);

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
    } finally {
        await parser.destroy();
    }
}
