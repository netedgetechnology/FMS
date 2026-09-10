import type {
    CsvColumnMapping,
    CsvRow,
    NormalizedTransactionCandidate,
} from "../types";

import {
    detectTransactionChannel,
    normalizeTransactionChannel,
} from "./transactionChannelDetector";

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

function normalizeAmount(
    value: unknown
): number | null {
    const raw = cleanText(value);

    if (!raw) {
        return null;
    }

    let normalized = raw
        .replace(/[₹$€£]/g, "")
        .replace(/\s/g, "")
        .trim();

    const isParenthesized =
        normalized.startsWith("(") &&
        normalized.endsWith(")");

    if (isParenthesized) {
        normalized = normalized.slice(
            1,
            -1
        );
    }

    normalized = normalized
        .replace(/,/g, "");

    if (!normalized) {
        return null;
    }

    const amount =
        Number(normalized);

    if (!Number.isFinite(amount)) {
        return null;
    }

    return isParenthesized
        ? -Math.abs(amount)
        : amount;
}

function normalizeType(
    value: unknown
): "income" | "expense" | "transfer" | null {
    const raw = cleanText(value)
        .toLowerCase();

    if (!raw) {
        return null;
    }

    if (
        [
            "income",
            "credit",
            "cr",
            "deposit",
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
            "dr",
            "withdrawal",
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

function normalizeTypeFromAmount(
    amount: number | null
): "income" | "expense" | null {
    if (
        amount === null ||
        amount === 0
    ) {
        return null;
    }

    return amount > 0
        ? "income"
        : "expense";
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

// BANK_EXCEL/BANK_PDF identify an Excel- or PDF-sourced bank statement -
// each is otherwise treated exactly like BANK_CSV by every heuristic
// below (resolveAmountAndType only ever special-cases the three
// CREDIT_CARD_* values; a bank statement's shape doesn't depend on
// which file format carried it), so no new branch is needed anywhere in
// this normalizer for either. CREDIT_CARD_PDF/CREDIT_CARD_EXCEL are the
// PDF and Excel counterparts of CREDIT_CARD_CSV for the same reason -
// the credit-card sign convention is a property of the data, not the
// file format, so they take the exact same branch as CREDIT_CARD_CSV
// below rather than a parallel one. This package has no PDF- or
// Excel-specific (let alone bank/provider-specific) parsing logic for
// any of these values - they all flow through the same universal,
// bank-agnostic extraction (see parser/pdfParser.ts, parser/excelParser.ts).
export type CsvImportType =
    | "BANK_CSV"
    | "BANK_EXCEL"
    | "BANK_PDF"
    | "CREDIT_CARD_CSV"
    | "CREDIT_CARD_PDF"
    | "CREDIT_CARD_EXCEL";

function resolveAmountAndType(
    row: CsvRow,
    mapping: CsvColumnMapping,
    headerIndex: Map<string, number>,
    importType: CsvImportType
): {
    amount: number | null;
    type:
        | "income"
        | "expense"
        | "transfer"
        | null;
} {
    const explicitAmount =
        normalizeAmount(
            getValue(
                row,
                mapping,
                "amount",
                headerIndex
            )
        );

    const debit =
        normalizeAmount(
            getValue(
                row,
                mapping,
                "debit",
                headerIndex
            )
        );

    const credit =
        normalizeAmount(
            getValue(
                row,
                mapping,
                "credit",
                headerIndex
            )
        );

    const explicitType =
        normalizeType(
            getValue(
                row,
                mapping,
                "type",
                headerIndex
            )
        );

    // When separate Debit/Credit columns are available, they are the
    // authoritative transaction amounts. Do NOT prefer a generic
    // "Amount" column because bank statements often use it for the
    // running balance.
    if (
        debit !== null &&
        debit !== 0
    ) {
        return {
            amount: Math.abs(debit),
            type: explicitType ?? "expense",
        };
    }

    if (
        credit !== null &&
        credit !== 0
    ) {
        return {
            amount: Math.abs(credit),
            type: explicitType ?? "income",
        };
    }

    // Fall back to Amount only when no Debit/Credit value exists.
    if (explicitAmount !== null) {
        return {
            amount: Math.abs(
                explicitAmount
            ),
            type:
                explicitType ??
                (
                    importType === "CREDIT_CARD_CSV" ||
                    importType === "CREDIT_CARD_PDF" ||
                    importType === "CREDIT_CARD_EXCEL"
                        ? (
                            explicitAmount < 0
                                ? "expense"
                                : explicitAmount > 0
                                    ? "income"
                                    : null
                        )
                        : normalizeTypeFromAmount(
                            explicitAmount
                        )
                ),
        };
    }

    return {
        amount: null,
        type: explicitType,
    };
}

export function normalizeCsvRows(
    rows: CsvRow[],
    mapping: CsvColumnMapping,
    headers: string[],
    importType: CsvImportType = "BANK_CSV"
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
                headerIndex,
                importType
            );

        const balance =
            normalizeAmount(
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



