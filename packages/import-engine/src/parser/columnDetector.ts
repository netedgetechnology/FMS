import type {
    CsvColumnMapping,
    CsvDocument,
} from "../types";

import {
    detectFallbackColumn,
} from "./columnFallbackDetector";

export type ColumnMappingField =
    | "date"
    | "description"
    | "payee"
    | "amount"
    | "debit"
    | "credit"
    | "type"
    | "referenceNumber"
    | "balance"
    | "branch"
    | "transactionType"
    // Manual-only - deliberately never assigned by HEADER_RULES/
    // FALLBACK_RULES below, so it is never auto-detected.
    | "externalTransactionId";

export interface DetectedColumn {
    header: string;
    field: ColumnMappingField;
    confidence: "high" | "medium" | "low";
}

export interface ColumnDetectionResult {
    mapping: CsvColumnMapping;
    detected: DetectedColumn[];
    missingRequiredFields: ColumnMappingField[];
    ambiguousFields: ColumnMappingField[];
}

interface HeaderRule {
    field: ColumnMappingField;
    confidence: "high" | "medium" | "low";
    names: string[];
}

const HEADER_RULES: HeaderRule[] = [
    {
        field: "date",
        confidence: "high",
        names: [
            "date",
            "transaction date",
            "transactiondate",
            "txn date",
            "value date",
            "value_date",
            "posting date",
            "posting_date",
        ],
    },
    {
        field: "description",
        confidence: "high",
        names: [
            "description",
            "transaction description",
            "transaction_description",
            "narration",
            "particulars",
            "remarks",
            "details",
            "transaction details",
            "transaction_details",
        ],
    },
    {
        field: "payee",
        confidence: "high",
        names: [
            "payee",
            "merchant",
            "merchant name",
            "merchant_name",
            "beneficiary",
            "beneficiary name",
            "beneficiary_name",
        ],
    },
    {
        field: "amount",
        confidence: "high",
        names: [
            "amount",
            "transaction amount",
            "transaction_amount",
            "value",
            "transaction value",
            "transaction_value",
        ],
    },
    {
        field: "debit",
        confidence: "high",
        names: [
            "debit",
            "debit amount",
            "debit_amount",
            "withdrawal",
            "withdrawals",
            "withdrawal amount",
            "withdrawal_amount",
            "dr",
            "dr amount",
            "dr_amount",
        ],
    },
    {
        field: "credit",
        confidence: "high",
        names: [
            "credit",
            "credit amount",
            "credit_amount",
            "deposit",
            "deposits",
            "deposit amount",
            "deposit_amount",
            "cr",
            "cr amount",
            "cr_amount",
        ],
    },
    {
        field: "type",
        confidence: "high",
        names: [
            "type",
            "transaction type",
            "transaction_type",
            "txn type",
            "txn_type",
            "dr cr",
            "dr/cr",
            "debit credit",
            "debit/credit",
        ],
    },
    {
        field: "referenceNumber",
        confidence: "high",
        names: [
            "reference",
            "reference number",
            "reference_number",
            "reference no",
            "reference_no",
            "transaction id",
            "transaction_id",
            "transaction number",
            "transaction_number",
            "txn id",
            "txn_id",
            "utr",
            "utr number",
            "utr_number",
            "cheque number",
            "cheque_number",
            "check number",
            "check_number",
        ],
    },
    {
        field: "balance",
        confidence: "high",
        names: [
            "balance",
            "closing balance",
            "closing_balance",
            "available balance",
            "available_balance",
            "running balance",
            "running_balance",
            "ledger balance",
            "ledger_balance",
        ],
    },
    {
        field: "branch",
        confidence: "high",
        names: [
            "branch",
            "branch name",
            "branch_name",
            "bank branch",
            "bank_branch",
        ],
    },
    {
        // The transaction *channel* (UPI/IMPS/NEFT/RTGS/Cash/Cheque) -
        // a rarely-present explicit source column. Deliberately named
        // distinctly from the "type" field above (which is DR/CR
        // direction) so a column literally called "Type" or "Transaction
        // Type" keeps meaning direction, not channel.
        field: "transactionType",
        confidence: "high",
        names: [
            "mode",
            "transaction mode",
            "transaction_mode",
            "txn mode",
            "txn_mode",
            "payment mode",
            "payment_mode",
            "mode of payment",
            "channel",
            "transaction channel",
            "transaction_channel",
        ],
    },
];

// Common currency-code/symbol suffixes banks append to header names
// (e.g. "Amount(INR)", "Balance (Rs.)"). Stripped before matching so the
// underlying field name ("amount", "balance", ...) can match exactly,
// without discarding other parenthetical qualifiers (like "(Dr)"/"(Cr)")
// that carry real meaning.
const CURRENCY_SUFFIX_PATTERN =
    /\(\s*(?:inr|rs\.?|usd|eur|gbp|aed|₹|\$|€|£)\s*\)/gi;

function normalizeHeader(
    header: string
): string {
    return header
        .trim()
        .toLowerCase()
        .replace(/["']/g, "")
        .replace(CURRENCY_SUFFIX_PATTERN, "")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function findMatchingRules(
    header: string
): HeaderRule[] {
    const normalized =
        normalizeHeader(header);

    return HEADER_RULES.filter(rule =>
        rule.names.some(
            name =>
                normalizeHeader(name) ===
                normalized
        )
    );
}

function assignDetection(
    header: string,
    rules: HeaderRule[]
): DetectedColumn | null {
    const rule = rules[0];

    if (!rule) {
        return null;
    }

    return {
        header,
        field: rule.field,
        confidence: rule.confidence,
    };
}

const CONFIDENCE_RANK: Record<
    DetectedColumn["confidence"],
    number
> = {
    high: 3,
    medium: 2,
    low: 1,
};

export function detectCsvColumns(
    document: CsvDocument
): ColumnDetectionResult {
    const mapping: CsvColumnMapping = {};

    const detected: DetectedColumn[] = [];

    const ambiguousFields =
        new Set<ColumnMappingField>();

    const candidatesByField =
        new Map<
            ColumnMappingField,
            DetectedColumn[]
        >();

    for (const header of document.headers) {
        const rules =
            findMatchingRules(header);

        const detection =
            assignDetection(
                header,
                rules
            ) ??
            detectFallbackColumn(header);

        if (!detection) {
            continue;
        }

        const existing =
            candidatesByField.get(
                detection.field
            ) ?? [];

        existing.push(detection);

        candidatesByField.set(
            detection.field,
            existing
        );
    }

    // When multiple columns map to the same field (e.g. both "Tran Date"
    // and "Value Date"), prefer the highest-confidence match rather than
    // whichever column happened to come first. Only flag the field as
    // ambiguous when the top confidence is genuinely tied, since that is
    // when the user actually needs to pick.
    for (const [
        field,
        candidates,
    ] of candidatesByField) {
        const sorted = [...candidates].sort(
            (a, b) =>
                CONFIDENCE_RANK[b.confidence] -
                CONFIDENCE_RANK[a.confidence]
        );

        const winner = sorted[0];

        mapping[field] = winner.header;

        detected.push(winner);

        const tiedAtTop = sorted.filter(
            candidate =>
                candidate.confidence ===
                winner.confidence
        );

        if (tiedAtTop.length > 1) {
            ambiguousFields.add(field);
        }
    }

    const hasDebit =
        Boolean(mapping.debit);

    const hasCredit =
        Boolean(mapping.credit);

    const hasAmount =
        Boolean(mapping.amount);

    const missingRequiredFields:
        ColumnMappingField[] = [];

    if (!mapping.date) {
        missingRequiredFields.push(
            "date"
        );
    }

    if (
        !mapping.description &&
        !mapping.payee
    ) {
        missingRequiredFields.push(
            "description"
        );
    }

    if (
        !hasAmount &&
        !hasDebit &&
        !hasCredit
    ) {
        missingRequiredFields.push(
            "amount"
        );
    }

    return {
        mapping,
        detected,
        missingRequiredFields,
        ambiguousFields: [
            ...ambiguousFields,
        ],
    };
}
