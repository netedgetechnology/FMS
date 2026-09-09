import type {
    CsvDocument,
    CsvRow,
} from "../types";

export interface PdfTransactionLine {
    rowNumber: number;
    text: string;
}

export interface PdfExtractionResult {
    document: CsvDocument;
    transactionLines: PdfTransactionLine[];
}

// Years are 2-4 digits (\d{2,4}) everywhere a date includes a month
// name or a slash/dash separator, matching pdfParser.ts's own date
// matching (DATE_FRAGMENTS/parseDateSortKey) exactly - a statement
// using a 2-digit year (e.g. "16 Jul 26") must be recognised here too,
// or a row using one is silently treated as non-dated continuation
// text instead of its own transaction. YYYY-MM-DD keeps a literal
// \d{4} since a 4-digit leading year is what defines that format.
const DATE_PATTERN =
    /\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4})\b/i;

const HEADER_WORDS = new Set([
    "date",
    "transaction date",
    "transactiondate",
    "txn date",
    "posting date",
    "value date",
    "description",
    "transaction description",
    "narration",
    "particulars",
    "remarks",
    "details",
    "debit",
    "credit",
    "amount",
    "withdrawal",
    "deposit",
    "balance",
    "reference",
    "reference number",
    "transaction id",
    "utr",
    "type",
"tran date",
    "value date",
    "transaction particulars",
    "chq no",
    "amount(inr)",
    "dr/cr",
    "balance(inr)",
    "branch name",
]);

const NOISE_PATTERNS = [
    /^opening balance\b/i,
    /^closing balance\b/i,
    /^transaction total\b/i,
    /^subtotal\b/i,
    /^total\b/i,
    /^account statement\b/i,
    /^statement generated\b/i,
    /^statement period\b/i,
    /^unless the constituent\b/i,
    /^the closing balance\b/i,
    /^it excludes the amount\b/i,
    /^for any further clarifications\b/i,
    /^we would like to reiterate\b/i,
    /^registered office\b/i,
    /^branch address\b/i,
    /^legends\s*:/i,
];

// Exported for reuse by pipeline.ts, which builds transactionLines the
// same way when pdfParser.ts's own structured extraction already
// produced the document directly (see processPdf) - the shape of a
// PdfExtractionResult's transactionLines must stay identical either way.
export function rowText(row: CsvRow): string {
    return row.values
        .filter(Boolean)
        .map(value => value.trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
}

// True for a header row's text even when it arrives as a single combined
// string rather than separate per-column values - e.g. "Tran Date Value
// Date ... Amount(INR) DR/CR ...". Shared with isLikelyHeaderRow below,
// which additionally checks per-column HEADER_WORDS matches for
// already-column-split rows.
function isCombinedHeaderText(
    normalizedText: string,
): boolean {
    return (
        normalizedText.includes("tran date") &&
        normalizedText.includes("value date") &&
        normalizedText.includes("amount")
    );
}

function isNoise(text: string): boolean {
    if (!text) {
        return true;
    }

    if (
        HEADER_WORDS.has(
            text.toLowerCase(),
        )
    ) {
        return true;
    }

    // Without this, a single-line-per-row header (a real single-value
    // PDF text row) is neither an exact HEADER_WORDS match nor a
    // NOISE_PATTERNS match, so it would otherwise be treated as
    // ordinary row text instead of being skipped.
    if (
        isCombinedHeaderText(
            text.toLowerCase(),
        )
    ) {
        return true;
    }

    return NOISE_PATTERNS.some(
        pattern => pattern.test(text),
    );
}

function isLikelyHeaderRow(
    row: CsvRow,
): boolean {
    const normalized =
        rowText(row).toLowerCase();

    if (isCombinedHeaderText(normalized)) {
        return true;
    }

    const matches =
        row.values
            .map(value =>
                value
                    .trim()
                    .toLowerCase(),
            )
            .filter(value =>
                HEADER_WORDS.has(value),
            );

    return matches.length >= 2;
}

function extractGenericRows(
    document: CsvDocument,
): PdfExtractionResult {
    const rows = document.rows;

    let headerIndex = -1;

    for (
        let index = 0;
        index < rows.length;
        index += 1
    ) {
        if (
            isLikelyHeaderRow(
                rows[index],
            )
        ) {
            headerIndex = index;
            break;
        }
    }

    const start =
        headerIndex >= 0
            ? headerIndex + 1
            : 0;

    const transactionRows: CsvRow[] = [];
    let pending: CsvRow | null = null;

    for (
        let index = start;
        index < rows.length;
        index += 1
    ) {
        const row = rows[index];

        const text = rowText(row);

        if (!text || isNoise(text)) {
            continue;
        }

        const hasDate =
            row.values.some(value =>
                DATE_PATTERN.test(
                    value.trim(),
                ),
            );

        if (hasDate) {
            transactionRows.push({
                rowNumber: row.rowNumber,
                values: [...row.values],
            });

            pending =
                transactionRows[
                    transactionRows.length - 1
                ];

            continue;
        }

        if (pending) {
            pending.values.push(
                ...row.values.filter(Boolean),
            );
        }
    }

    const headers =
        headerIndex >= 0
            ? [...rows[headerIndex].values]
            : document.headers.length > 0
                ? [...document.headers]
                : [];

    return {
        document: {
            headers,
            rows: transactionRows,
        },
        transactionLines:
            transactionRows.map(row => ({
                rowNumber: row.rowNumber,
                text: rowText(row),
            })),
    };
}

export function extractPdfTransactions(
    document: CsvDocument,
): PdfExtractionResult {
    const sourceRows = document.rows;

    if (sourceRows.length === 0) {
        return {
            document: {
                headers: [...document.headers],
                rows: [],
            },
            transactionLines: [],
        };
    }

    return extractGenericRows(document);
}

