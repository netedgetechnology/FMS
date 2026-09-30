import type {
    CsvColumnMapping,
    CsvRow,
    NormalizedTransactionCandidate,
} from "../types";

import {
    detectTransactionChannel,
    normalizeTransactionChannel,
} from "./transactionChannelDetector";

import {
    parseBalance,
    resolveCanonicalAmount,
} from "./moneyNormalizer";

function cleanText(value: unknown): string {
    if (
        value === null ||
        value === undefined
    ) {
        return "";
    }

    return String(value)
        .replace(/\u00a0/g, " ")
        .trim();
}

function normalizeDate(
    value: unknown
): string | null {
    const raw = cleanText(value);

    if (!raw) {
        return null;
    }

    const isoMatch = raw.match(
        /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/
    );

    if (isoMatch) {
        const [, year, month, day] =
            isoMatch;

        return [
            year,
            month.padStart(2, "0"),
            day.padStart(2, "0"),
        ].join("-");
    }

    const dmyMatch = raw.match(
        /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/
    );

    if (dmyMatch) {
        const [, day, month, year] =
            dmyMatch;

        return [
            year,
            month.padStart(2, "0"),
            day.padStart(2, "0"),
        ].join("-");
    }

    const shortYearMatch = raw.match(
        /^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/
    );

    if (shortYearMatch) {
        const [
            ,
            day,
            month,
            shortYear,
        ] = shortYearMatch;

        const numericYear =
            Number(shortYear) >= 70
                ? 1900 + Number(shortYear)
                : 2000 + Number(shortYear);

        return [
            String(numericYear),
            month.padStart(2, "0"),
            day.padStart(2, "0"),
        ].join("-");
    }

    const parsed = new Date(raw);

    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return [
        String(parsed.getFullYear()),
        String(
            parsed.getMonth() + 1
        ).padStart(2, "0"),
        String(
            parsed.getDate()
        ).padStart(2, "0"),
    ].join("-");
}

function createHeaderIndex(
    headers: string[]
): Map<string, number> {
    const index =
        new Map<string, number>();

    headers.forEach(
        (header, columnIndex) => {
            index.set(
                header,
                columnIndex
            );
        }
    );

    return index;
}

function getValue(
    row: CsvRow,
    mapping: CsvColumnMapping,
    field: keyof CsvColumnMapping,
    headerIndex: Map<string, number>
): string {
    const header = mapping[field];

    if (!header) {
        return "";
    }

    const index =
        headerIndex.get(header);

    if (
        index === undefined ||
        index >= row.values.length
    ) {
        return "";
    }

    return cleanText(
        row.values[index]
    );
}

function buildRawData(
    row: CsvRow,
    headers: string[]
): Record<string, string> {
    const rawData: Record<
        string,
        string
    > = {};

    headers.forEach(
        (header, index) => {
            rawData[header] =
                cleanText(
                    row.values[index]
                );
        }
    );

    return rawData;
}

// Identifies the source format and account kind. It never changes how a
// row's amount/direction is resolved - that is a property of the data
// (DR/CR markers, signs, which column a value sits in), handled for every
// value below by the shared normalizer/moneyNormalizer.ts layer. This
// package has no PDF- or Excel-specific (let alone bank/provider-specific)
// parsing logic for any of these values - they all flow through the same
// universal, bank-agnostic extraction (see parser/pdfParser.ts,
// parser/excelParser.ts).
export type CsvImportType =
    | "BANK_CSV"
    | "BANK_EXCEL"
    | "BANK_PDF"
    | "CREDIT_CARD_CSV"
    | "CREDIT_CARD_PDF"
    | "CREDIT_CARD_EXCEL";

// Every Amount / Debit+Credit / Withdrawal+Deposit / DR-CR / signed
// representation is resolved by the one shared normalization layer
// (normalizer/moneyNormalizer.ts), so CSV, Excel and PDF imports can never
// disagree about what a given cell means. The import type does not change
// the sign convention: a DR/CR marker, an explicit sign, or the column a
// value sits in is what decides direction.
function resolveAmountAndType(
    row: CsvRow,
    mapping: CsvColumnMapping,
    headerIndex: Map<string, number>
): {
    amount: number | null;
    type:
        | "income"
        | "expense"
        | "transfer"
        | null;
} {
    const resolved =
        resolveCanonicalAmount({
            amount: getValue(
                row,
                mapping,
                "amount",
                headerIndex
            ),
            debit: getValue(
                row,
                mapping,
                "debit",
                headerIndex
            ),
            credit: getValue(
                row,
                mapping,
                "credit",
                headerIndex
            ),
            typeText: getValue(
                row,
                mapping,
                "type",
                headerIndex
            ),
            hasDebitCreditColumns:
                Boolean(
                    mapping.debit &&
                        mapping.credit
                ),
        });

    return {
        amount: resolved.amount,
        type: resolved.type,
    };
}

export function normalizeCsvRows(
    rows: CsvRow[],
    mapping: CsvColumnMapping,
    headers: string[],
    // Kept for API stability; see CsvImportType.
    _importType: CsvImportType = "BANK_CSV"
): NormalizedTransactionCandidate[] {
    const headerIndex =
        createHeaderIndex(headers);

    return rows.map(row => {
        const description =
            getValue(
                row,
                mapping,
                "description",
                headerIndex
            );

        const payee =
            getValue(
                row,
                mapping,
                "payee",
                headerIndex
            );

        const referenceNumber =
            getValue(
                row,
                mapping,
                "referenceNumber",
                headerIndex
            );

        const externalTransactionId =
            getValue(
                row,
                mapping,
                "externalTransactionId",
                headerIndex
            );

        const resolved =
            resolveAmountAndType(
                row,
                mapping,
                headerIndex
            );

        const balance =
            parseBalance(
                getValue(
                    row,
                    mapping,
                    "balance",
                    headerIndex
                )
            );

        const branch =
            getValue(
                row,
                mapping,
                "branch",
                headerIndex
            );

        // An explicit "Mode"/"Channel" source column (rare) is
        // authoritative when mapped; otherwise fall back to detecting the
        // channel from whatever narration text is available. Never
        // derived from - and never overwrites - the DR/CR direction
        // resolved above.
        const transactionType =
            mapping.transactionType
                ? normalizeTransactionChannel(
                      getValue(
                          row,
                          mapping,
                          "transactionType",
                          headerIndex
                      )
                  )
                : detectTransactionChannel(
                      description,
                      payee,
                      referenceNumber
                  );

        return {
            rowNumber:
                row.rowNumber,

            transactionDate:
                normalizeDate(
                    getValue(
                        row,
                        mapping,
                        "date",
                        headerIndex
                    )
                ),

            payee:
                payee ||
                description,

            description,

            amount:
                resolved.amount,

            type:
                resolved.type,

            referenceNumber:
                referenceNumber ||
                null,

            externalTransactionId:
                externalTransactionId ||
                null,

            balance,

            branch:
                branch || null,

            transactionType,

            // Filled in by the desktop layer (learned counterparty
            // association) and/or manual per-row entry, never here.
            counterparty: null,

            // Independent from description; filled in only via manual
            // per-row entry.
            notes: null,

            rawData:
                buildRawData(
                    row,
                    headers
                ),
        };
    });
}



