import type {
    CsvDocument,
    LoanScheduleColumnMapping,
} from "../types";

export type LoanColumnMappingField =
    | "installmentNumber"
    | "dueDate"
    | "paymentDate"
    | "emi"
    | "principal"
    | "interest"
    | "outstandingPrincipal"
    | "outstandingBalance"
    | "loanNumber"
    | "description"
    | "referenceNumber";

export interface DetectedLoanColumn {
    header: string;
    field: LoanColumnMappingField;
    confidence: "high" | "medium" | "low";
}

export interface LoanColumnDetectionResult {
    mapping: LoanScheduleColumnMapping;
    detected: DetectedLoanColumn[];
    missingRequiredFields: LoanColumnMappingField[];
    ambiguousFields: LoanColumnMappingField[];
}

interface HeaderRule {
    field: LoanColumnMappingField;
    confidence: "high" | "medium" | "low";
    names: string[];
}

const LOAN_HEADER_RULES: HeaderRule[] = [
    {
        field: "installmentNumber",
        confidence: "high",
        names: [
            "installment",
            "installment no",
            "installment number",
            "installment_no",
            "installment_number",
            "emi no",
            "emi number",
            "emi_no",
            "emi_number",
            "payment number",
            "payment no",
            "sequence",
            "sr no",
            "sr number",
        ],
    },
    {
        field: "dueDate",
        confidence: "high",
        names: [
            "due date",
            "due_date",
            "installment date",
            "installment_date",
            "scheduled date",
            "scheduled_date",
        ],
    },
    {
        field: "paymentDate",
        confidence: "high",
        names: [
            "payment date",
            "payment_date",
            "paid date",
            "paid_date",
            "date paid",
            "date_paid",
        ],
    },
    {
        field: "emi",
        confidence: "high",
        names: [
            "emi",
            "emi amount",
            "emi_amount",
            "installment amount",
            "installment_amount",
            "monthly installment",
            "monthly_installment",
            "payment amount",
            "payment_amount",
        ],
    },
    {
        field: "principal",
        confidence: "high",
        names: [
            "principal",
            "principal amount",
            "principal_amount",
            "principal paid",
            "principal_paid",
        ],
    },
    {
        field: "interest",
        confidence: "high",
        names: [
            "interest",
            "interest amount",
            "interest_amount",
            "interest paid",
            "interest_paid",
        ],
    },
    {
        field: "outstandingPrincipal",
        confidence: "high",
        names: [
            "outstanding principal",
            "outstanding_principal",
            "principal outstanding",
            "principal_outstanding",
            "remaining principal",
            "remaining_principal",
        ],
    },
    {
        field: "outstandingBalance",
        confidence: "high",
        names: [
            "outstanding",
            "outstanding balance",
            "outstanding_balance",
            "loan balance",
            "loan_balance",
            "balance outstanding",
            "balance_outstanding",
            "remaining balance",
            "remaining_balance",
        ],
    },
    {
        field: "loanNumber",
        confidence: "high",
        names: [
            "loan number",
            "loan_number",
            "loan no",
            "loan_no",
            "loan account",
            "loan account number",
            "loan_account",
            "loan_account_number",
            "account number",
            "account_number",
        ],
    },
    {
        field: "description",
        confidence: "high",
        names: [
            "description",
            "details",
            "remarks",
            "narration",
            "particulars",
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
            "payment reference",
            "payment_reference",
        ],
    },
];

function normalizeHeader(header: string): string {
    return header
        .trim()
        .toLowerCase()
        .replace(/["']/g, "")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ");
}

function findRule(header: string): HeaderRule | null {
    const normalized = normalizeHeader(header);

    return (
        LOAN_HEADER_RULES.find(rule =>
            rule.names.some(
                name => normalizeHeader(name) === normalized
            )
        ) ?? null
    );
}

export function detectLoanScheduleColumns(
    document: CsvDocument
): LoanColumnDetectionResult {
    const mapping: LoanScheduleColumnMapping = {};
    const detected: DetectedLoanColumn[] = [];
    const ambiguousFields = new Set<LoanColumnMappingField>();

    const usedFields =
        new Map<LoanColumnMappingField, string>();

    for (const header of document.headers) {
        const rule = findRule(header);

        if (!rule) {
            continue;
        }

        const existingHeader = usedFields.get(rule.field);

        if (existingHeader) {
            ambiguousFields.add(rule.field);
            continue;
        }

        usedFields.set(rule.field, header);
        mapping[rule.field] = header;

        detected.push({
            header,
            field: rule.field,
            confidence: rule.confidence,
        });
    }

    const missingRequiredFields: LoanColumnMappingField[] = [];

    if (!mapping.dueDate && !mapping.paymentDate) {
        missingRequiredFields.push("dueDate");
    }

    if (!mapping.emi) {
        missingRequiredFields.push("emi");
    }

    if (!mapping.principal) {
        missingRequiredFields.push("principal");
    }

    if (!mapping.interest) {
        missingRequiredFields.push("interest");
    }

    if (
        !mapping.outstandingPrincipal &&
        !mapping.outstandingBalance
    ) {
        missingRequiredFields.push("outstandingBalance");
    }

    return {
        mapping,
        detected,
        missingRequiredFields,
        ambiguousFields: [...ambiguousFields],
    };
}
