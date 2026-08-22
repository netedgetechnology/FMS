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
    | "referenceNumber";

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
];

function normalizeHeader(
    header: string
): string {
    return header
        .trim()
        .toLowerCase()
        .replace(/["']/g, "")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ");
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

export function detectCsvColumns(
    document: CsvDocument
): ColumnDetectionResult {
    const mapping: CsvColumnMapping = {};

    const detected: DetectedColumn[] = [];

    const ambiguousFields =
        new Set<ColumnMappingField>();

    const usedFields =
        new Map<
            ColumnMappingField,
            string
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

        const existingHeader =
            usedFields.get(
                detection.field
            );

        if (existingHeader) {
            ambiguousFields.add(
                detection.field
            );
            continue;
        }

        usedFields.set(
            detection.field,
            header
        );

        mapping[
            detection.field
        ] = header;

        detected.push(detection);
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
