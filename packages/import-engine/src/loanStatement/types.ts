// ---------------------------------------------------------------------
// Universal loan statement extraction - the result model.
//
// One common structure for every lender and facility, plus a small
// type-specific extension (see extensions.ts). Every value says where it
// came from; a value the document does not state stays null. Nothing here
// describes a loan, a transaction or an accounting entry to be saved.
// ---------------------------------------------------------------------

export const FACILITY_TYPES = [
    "TERM_LOAN",
    "OVERDRAFT",
    "DROPLINE_OVERDRAFT",
    "CASH_CREDIT",
    "DEMAND_LOAN",
    "OTHER_UNKNOWN",
] as const;

export type FacilityType = (typeof FACILITY_TYPES)[number];

export const FACILITY_TYPE_LABELS: Record<FacilityType, string> = {
    TERM_LOAN: "Term Loan",
    OVERDRAFT: "Overdraft (OD)",
    DROPLINE_OVERDRAFT: "Dropline Overdraft (DOD)",
    CASH_CREDIT: "Cash Credit (CC)",
    DEMAND_LOAN: "Demand Loan",
    OTHER_UNKNOWN: "Other / Unknown",
};

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

/** SOURCE: printed in the document. CALCULATED: worked out from it. MANUAL: typed by the customer. */
export type Provenance = "SOURCE" | "CALCULATED" | "MANUAL";

export interface SourceRef {
    page: number;
    /** The label as printed, or a short description for a table/ledger. */
    label: string;
    /** The value text exactly as printed. */
    raw: string;
}

export type FieldKind = "money" | "date" | "rate" | "months" | "text" | "raw" | "identifier" | "count";
export type FieldValue = string | number;

export interface FieldAlternative {
    value: FieldValue;
    sources: SourceRef[];
}

export interface ExtractedField {
    id: FieldId;
    kind: FieldKind;
    /** null when absent, and also while conflicting values are unresolved. */
    value: FieldValue | null;
    status: "FOUND" | "NOT_IN_DOCUMENT" | "CONFLICT";
    provenance: Provenance | null;
    confidence: Confidence | null;
    /** CROSS_CHECKED: other figures in the same document agree with it. */
    verification: "UNVERIFIED" | "CROSS_CHECKED" | "CONFLICT" | null;
    sources: SourceRef[];
    /** Every distinct value seen, when status is CONFLICT. */
    alternatives: FieldAlternative[];
    /** How a CALCULATED value was worked out. */
    note: string | null;
}

export const FIELD_GROUPS = [
    "identifiers",
    "financialTerms",
    "limits",
    "interest",
    "repayment",
    "disbursement",
    "outstanding",
    "stock",
] as const;

export type FieldGroup = (typeof FIELD_GROUPS)[number];

export type FieldId =
    // identifiers
    | "lenderName"
    | "customerName"
    | "loanAccountNumber"
    | "agreementNumber"
    | "linkedAccountNumber"
    | "productName"
    | "schemeName"
    | "branchName"
    | "accountStatus"
    | "currencyCode"
    | "statementFrom"
    | "statementTo"
    // financial terms
    | "sanctionedAmount"
    | "sanctionDate"
    | "startDate"
    | "maturityDate"
    | "tenureMonths"
    // limits
    | "currentLimit"
    | "initialDrawingPower"
    | "drawingPower"
    | "availableAmount"
    | "reductionFrequency"
    // interest
    | "interestRate"
    | "currentInterestRate"
    | "interestTypeText"
    | "benchmarkName"
    | "benchmarkRateText"
    // repayment
    | "emiAmount"
    | "repaymentFrequency"
    | "firstInstalmentDate"
    | "instalmentsPaid"
    | "instalmentsPaidAmount"
    | "principalRepaidTotal"
    | "interestPaidTotal"
    | "instalmentsRemaining"
    // disbursement
    | "grossDisbursed"
    | "netDisbursed"
    | "disbursementDate"
    | "totalDeductions"
    // outstanding
    | "openingUtilised"
    | "openingUtilisedDate"
    | "currentUtilised"
    | "outstandingPrincipal"
    | "accruedInterest"
    | "chargesDue"
    | "penalInterest"
    | "totalOutstanding"
    | "principalOverdue"
    | "overdueAmount"
    // stock
    | "stockValue"
    | "bookDebts"
    | "marginPercent"
    | "stockStatementDate";

export type FieldMap = Partial<Record<FieldId, ExtractedField>>;

// ------------------------------------------------------------- tables

export type LedgerEntryKind =
    | "OPENING_BALANCE"
    | "DRAWDOWN"
    | "DISBURSEMENT_PAYOUT"
    | "INSTALMENT_DEMAND"
    | "INTEREST_CHARGE"
    | "OTHER_CHARGE"
    | "REPAYMENT"
    | "INTEREST_PAYMENT"
    | "REVERSAL"
    | "BOUNCED"
    | "UNCLASSIFIED";

export interface LedgerEntry {
    date: string;
    description: string;
    reference: string | null;
    /** Printed amount, always positive. */
    amount: number;
    /** The printed column or marker. */
    side: "DEBIT" | "CREDIT" | null;
    /** Effect on what the borrower owes. */
    effect: "INCREASES_DUES" | "DECREASES_DUES" | "UNKNOWN";
    kind: LedgerEntryKind;
    /** A fee or tax withheld from a disbursement rather than paid separately. */
    isDeduction: boolean;
    /** "SOURCE": the narration states it. "CALCULATED": inferred (see allocationNote). */
    kindProvenance: Provenance;
    allocationNote: string | null;
    principal: number | null;
    interest: number | null;
    /** Dues after this row, as printed and normalised. null when not printed. */
    balance: number | null;
    page: number;
    chainStatus: "OK" | "MISMATCH" | "NOT_CHECKED";
}

export interface LedgerCheck {
    checkedRows: number;
    mismatches: number;
    /** Dues before the first row; null when it cannot be worked out. */
    opening: number | null;
    openingProvenance: Provenance | null;
    openingDate: string | null;
    /** Dues after the last row that printed or implied a balance. */
    closing: number | null;
    /** How debits and credits move the balance in this document. */
    convention: "DEBIT_RAISES_DUES" | "CREDIT_RAISES_DUES" | "UNDETERMINED";
}

export interface LedgerSummary {
    drawdownCount: number;
    drawdownTotal: number;
    repaymentCount: number;
    repaymentTotal: number;
    interestChargedTotal: number;
    interestPaidTotal: number;
    otherChargesTotal: number;
    reversalCount: number;
    bouncedCount: number;
    unclassifiedCount: number;
}

export interface ScheduleRow {
    installmentNumber: number;
    dueDate: string;
    openingPrincipal: number | null;
    principal: number | null;
    interest: number | null;
    emi: number | null;
    closingPrincipal: number | null;
    page: number;
}

export interface DisbursementRow {
    date: string | null;
    gross: number | null;
    net: number | null;
    deductions: number | null;
    reference: string | null;
    provenance: Provenance;
    page: number;
}

export interface ChargeRow {
    name: string;
    date: string | null;
    amount: number;
    /** The normalised expense family, when the wording names one. */
    category:
        | "PROCESSING_FEE"
        | "GST"
        | "INSURANCE_PREMIUM"
        | "LEGAL_CHARGES"
        | "DOCUMENTATION_CHARGES"
        | "VALUATION_CHARGES"
        | "STAMP_DUTY"
        | "OTHER_CHARGES";
    page: number;
}

export interface RateChange {
    effectiveDate: string | null;
    rate: number;
    /** The rate it replaced, when the document says. */
    previousRate: number | null;
    page: number;
    raw: string;
}

export interface LimitChange {
    effectiveDate: string | null;
    amount: number;
    /** LIMIT: the sanctioned limit. DRAWING_POWER: the drawable amount. */
    subject: "LIMIT" | "DRAWING_POWER";
    /** SCHEDULED: a future/planned step of a reduction schedule. */
    nature: "SCHEDULED" | "REVISION";
    page: number;
    raw: string;
}

// ----------------------------------------------------- classification

export interface ClassificationEvidence {
    /** The type this signal speaks for (a revolving signal lists several). */
    supports: FacilityType[];
    weight: number;
    /** Stated outright by the document's wording, not inferred from its shape. */
    explicit: boolean;
    description: string;
    page: number | null;
    raw: string | null;
}

export interface LoanClassification {
    detected: FacilityType;
    confidence: Confidence;
    evidence: ClassificationEvidence[];
    conflictingEvidence: ClassificationEvidence[];
    /** Facts this type normally has that the document does not state. */
    missingInformation: FieldId[];
    /** The customer must actively choose the type before any workflow opens. */
    confirmationRequired: boolean;
    reasonForConfirmation: string | null;
    scores: Record<FacilityType, number>;
}

// ---------------------------------------------------------- extensions

interface RevolvingFacts {
    drawdowns: LedgerEntry[];
    principalRepayments: LedgerEntry[];
    interestEntries: LedgerEntry[];
    chargeEntries: LedgerEntry[];
    limitChanges: LimitChange[];
}

export interface TermLoanExtension {
    type: "TERM_LOAN";
    schedule: ScheduleRow[];
    historicalRepayments: LedgerEntry[];
}

export interface OverdraftExtension extends RevolvingFacts {
    type: "OVERDRAFT";
}

export interface DroplineExtension extends RevolvingFacts {
    type: "DROPLINE_OVERDRAFT";
    /** The published reductions; [] when the document prints none. */
    reductionSchedule: LimitChange[];
}

export interface CashCreditExtension extends RevolvingFacts {
    type: "CASH_CREDIT";
    /** Sentences naming stock, book debts or similar drawing-power bases. */
    drawingPowerReferences: Array<{ page: number; raw: string }>;
}

export interface DemandLoanExtension {
    type: "DEMAND_LOAN";
    repayments: LedgerEntry[];
    interestEntries: LedgerEntry[];
}

export interface OtherExtension {
    type: "OTHER_UNKNOWN";
}

export type FacilityExtension =
    | TermLoanExtension
    | OverdraftExtension
    | DroplineExtension
    | CashCreditExtension
    | DemandLoanExtension
    | OtherExtension;

// --------------------------------------------------------------- result

export interface ConflictItem {
    fieldId: FieldId | null;
    message: string;
    values: Array<{ label: string; value: FieldValue; page: number | null }>;
}

/** The facility as the document states it, whatever type it turns out to be. */
export interface FacilityBase {
    id: string;
    pages: number[];
    fields: FieldMap;
    groups: Record<FieldGroup, FieldMap>;
    transactions: LedgerEntry[];
    ledgerCheck: LedgerCheck | null;
    ledgerSummary: LedgerSummary;
    schedule: ScheduleRow[];
    scheduleProblems: string[];
    disbursements: DisbursementRow[];
    charges: ChargeRow[];
    rateHistory: RateChange[];
    limitChanges: LimitChange[];
    drawingPowerReferences: Array<{ page: number; raw: string }>;
    conflicts: ConflictItem[];
}

export interface FacilityExtraction extends FacilityBase {
    classification: LoanClassification;
    extension: FacilityExtension;
    /** Fields that matter for the detected type and are not in the document. */
    missing: FieldId[];
    extractionConfidence: Confidence;
}

export type AnalysisStatus = "OK" | "SCANNED" | "NO_TEXT_LAYER" | "NO_FACILITY_FOUND";

export interface LoanStatementAnalysis {
    status: AnalysisStatus;
    pageCount: number;
    /** Pages holding only an image: not read, because there is no OCR. */
    imageOnlyPages: number[];
    /** Lender-specific adapter used on top of the generic engine, if any. */
    profileId: string | null;
    facilities: FacilityExtraction[];
    warnings: string[];
}
