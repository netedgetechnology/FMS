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

const DATE_PATTERN =
    /\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\b/i;

const DATE_PAIR_PATTERN =
    /^\s*(\d{1,2}[-/]\d{1,2}[-/]\d{4})\s+(\d{1,2}[-/]\d{1,2}[-/]\d{4})\b/;

const AMOUNT_TYPE_BALANCE_PATTERN =
    /([\d,]+\.\d{2})\s+(DR|CR)\s+([\d,]+\.\d{2})(?:\s+(.*))?$/i;

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

function rowText(row: CsvRow): string {
    return row.values
        .filter(Boolean)
        .map(value => value.trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
}

function isTransactionStart(
    text: string,
): boolean {
    return DATE_PAIR_PATTERN.test(text);
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

    return NOISE_PATTERNS.some(
        pattern => pattern.test(text),
    );
}

function parseTransactionRow(
    row: CsvRow,
    precedingText: string[],
): CsvRow | null {
    const text = rowText(row);

    const dateMatch =
        text.match(DATE_PAIR_PATTERN);

    if (!dateMatch) {
        return null;
    }

    const amountMatch =
        text.match(
            AMOUNT_TYPE_BALANCE_PATTERN,
        );

    if (!amountMatch) {
        return null;
    }

    const [
        ,
        transactionDate,
        valueDate,
        amount,
        type,
        balance,
        branch = "",
    ] = amountMatch;

    const afterDates =
        text
            .slice(
                dateMatch[0].length,
            )
            .trim();

    const amountIndex =
        afterDates.search(
            /\s+[\d,]+\.\d{2}\s+(?:DR|CR)\s+[\d,]+\.\d{2}/i,
        );

    const currentDescription =
        amountIndex >= 0
            ? afterDates
                .slice(0, amountIndex)
                .trim()
            : afterDates;

    const descriptionParts = [
        ...precedingText,
        currentDescription,
    ]
        .map(value =>
            value
                .replace(/\s+/g, " ")
                .trim(),
        )
        .filter(Boolean);

    const description =
        descriptionParts.join(" ");

    return {
        rowNumber: row.rowNumber,
        values: [
            transactionDate,
            valueDate,
            description,
            "",
            amount,
            type.toUpperCase(),
            balance,
            branch.trim(),
        ],
    };
}

function extractAxisRows(
    rows: CsvRow[],
): CsvRow[] {
    const transactions: CsvRow[] = [];
    let pending: string[] = [];

    for (const row of rows) {
        const text = rowText(row);

        if (!text) {
            continue;
        }

        if (isNoise(text)) {
            continue;
        }

        if (isTransactionStart(text)) {
            const transaction =
                parseTransactionRow(
                    row,
                    pending,
                );

            if (transaction) {
                transactions.push(
                    transaction,
                );
                pending = [];
                continue;
            }
        }

        if (
            DATE_PATTERN.test(text)
        ) {
            pending = [];
            continue;
        }

        pending.push(text);
    }

    return transactions;
}

function isLikelyHeaderRow(
    row: CsvRow,
): boolean {
    const normalized =
        rowText(row).toLowerCase();

    if (
        normalized.includes("tran date") &&
        normalized.includes("value date") &&
        normalized.includes("amount")
    ) {
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

    const sourceLooksLikePdfText =
        sourceRows.some(row =>
            row.values.length === 1 &&
            DATE_PAIR_PATTERN.test(
                row.values[0]?.trim() ?? "",
            ),
        );

    if (!sourceLooksLikePdfText) {
        return extractGenericRows(
            document,
        );
    }

    const transactionRows =
        extractAxisRows(sourceRows);

    const headers = [
        "Tran Date",
        "Value Date",
        "Transaction Particulars",
        "Chq No",
        "Amount(INR)",
        "DR/CR",
        "Balance(INR)",
        "Branch Name",
    ];

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

