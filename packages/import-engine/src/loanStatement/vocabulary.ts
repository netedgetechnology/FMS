// What statements call things - one shared vocabulary, no lender in it.
// Patterns are tested against a normalised label (lowercase, single spaces,
// punctuation removed) and must match all of it.

import type { ChargeRow, FieldGroup, FieldId, FieldKind } from "./types";

export interface FieldDefinition {
    id: FieldId;
    group: FieldGroup;
    kind: FieldKind;
    patterns: RegExp[];
    /**
     * A bare word ("Principal", "Interest") only means this field under a
     * heading like "Current Outstanding" in the same column.
     */
    bareUnderHeading?: RegExp[];
}

const AMT = String.raw`(?: amount| amt| rs| inr| value)*`;
const NUM = String.raw`(?:number|no|num|id|a c no|ac no|account no)`;
const OUTSTANDING_HEADING = /outstanding|dues?\b|amount payable|balance summary/i;

export const FIELD_DEFINITIONS: FieldDefinition[] = [
    // identifiers
    { id: "lenderName", group: "identifiers", kind: "text", patterns: [/^(lender|lender name|bank name|name of (the )?(bank|lender|financier)|financier|nbfc name)$/] },
    { id: "customerName", group: "identifiers", kind: "text", patterns: [/^(customer name|borrower|borrower name|borrower s name|name of (the )?borrower|applicant|applicant name|primary applicant|account holder|account holder name|account name|name)$/] },
    { id: "linkedAccountNumber", group: "identifiers", kind: "identifier", patterns: [new RegExp(String.raw`^(linked|parent|associated|mapped)( term)?( loan| od| cc)? (account |a c )?${NUM}$`)] },
    { id: "loanAccountNumber", group: "identifiers", kind: "identifier", patterns: [
        new RegExp(String.raw`^(loan|od|cc|overdraft|cash credit|facility|credit facility)( account| a c| ac)? ${NUM}$`),
        /^(lan|loan id|loan account|facility id|account number|a c no|ac no|a c number|account no)$/,
    ] },
    { id: "agreementNumber", group: "identifiers", kind: "identifier", patterns: [/^(agreement|agreement id|agreement no|agreement number|loan agreement no|contract no|contract number)$/] },
    { id: "productName", group: "identifiers", kind: "text", patterns: [/^(product|product name|product type|facility|facility type|nature of facility|type of facility|loan type|type of loan|loan product)$/] },
    { id: "schemeName", group: "identifiers", kind: "text", patterns: [/^(scheme|scheme name)$/] },
    { id: "currencyCode", group: "identifiers", kind: "text", patterns: [/^(currency|currency code|account currency)$/] },
    { id: "branchName", group: "identifiers", kind: "text", patterns: [/^(branch|branch name|home branch|servicing branch)$/] },
    { id: "accountStatus", group: "identifiers", kind: "text", patterns: [/^(account status|loan status|status|facility status)$/] },
    { id: "statementFrom", group: "identifiers", kind: "date", patterns: [/^(statement from|from date|period from|from)$/] },
    { id: "statementTo", group: "identifiers", kind: "date", patterns: [/^(statement to|to date|period to|to|statement date|as on|as on date|statement as on)$/] },

    // financial terms
    { id: "sanctionedAmount", group: "financialTerms", kind: "money", patterns: [new RegExp(String.raw`^(original |loan )?(sanction(?:ed)?|approved)( amount| limit| loan| loan amount| credit limit| facility)${AMT}$`), new RegExp(String.raw`^(amount sanctioned|limit sanctioned|loan amount|amount financed|amount of loan|(od|cc|overdraft|cash credit|credit) limit|limit|original limit|facility limit|facility amount)${AMT}$`)] },
    { id: "sanctionDate", group: "financialTerms", kind: "date", patterns: [/^(sanction|sanctioned|amount sanctioned|date of sanction|loan sanction|limit sanction)( date)?$/, /^date of sanction$/] },
    { id: "startDate", group: "financialTerms", kind: "date", patterns: [/^(start date|loan start date|facility start date|commencement date|date of commencement|loan booking date|booking date|account opening date|account open date)$/] },
    { id: "maturityDate", group: "financialTerms", kind: "date", patterns: [/^((loan |facility |limit |amount |instl |instalment |installment )?(maturity|expiry|end|closure)( date)?|date of maturity|limit valid upto|valid upto|validity date|facility valid till)$/] },
    { id: "tenureMonths", group: "financialTerms", kind: "months", patterns: [/^((loan |original |sanctioned )?(tenure|term)( in)?( months?| years?)?|tenor|tenor in months|no of months|repayment period)( month| months| years?)?$/] },

    // limits
    { id: "currentLimit", group: "limits", kind: "money", patterns: [new RegExp(String.raw`^(current|revised|present|operative|operating|existing)( sanctioned| sanction| od| cc| drawing)? (limit|amount)${AMT}$`), new RegExp(String.raw`^current sanctioned${AMT}$`)] },
    { id: "initialDrawingPower", group: "limits", kind: "money", patterns: [/^(initial|original|opening) (drawing power|dp)( amount)?$/] },
    { id: "drawingPower", group: "limits", kind: "money", patterns: [/^(current )?(drawing power|dp)( amount| limit)?$/] },
    { id: "availableAmount", group: "limits", kind: "money", patterns: [/^(available|undrawn|unutilised|unutilized)( amount| limit| balance| drawing limit| to draw)?$/] },
    { id: "reductionFrequency", group: "limits", kind: "text", patterns: [/^(reduction|dropline|drop line|limit reduction) (frequency|periodicity)$/] },

    // interest
    { id: "interestRate", group: "interest", kind: "rate", patterns: [/^(sanctioned |original |initial |applicable )?(roi|rate of interest|interest rate|int rate|rate)( p a| %| % p a| per annum)?( type)?$/] },
    { id: "currentInterestRate", group: "interest", kind: "rate", patterns: [/^(current|present|revised|effective) (roi|rate of interest|interest rate|int rate|rate)( p a| %| % p a| per annum)?$/] },
    { id: "interestTypeText", group: "interest", kind: "text", patterns: [/^(interest type|type of interest|rate type|roi type|interest rate type|fixed floating|interest method|interest calculation)$/] },

    { id: "benchmarkName", group: "interest", kind: "text", patterns: [/^(anchor code|anchor name|benchmark|benchmark name|benchmark rate name|reference rate name|linked benchmark)$/] },
    { id: "benchmarkRateText", group: "interest", kind: "raw", patterns: [/^(anchor|benchmark|reference|base) rate( mark up| spread)?( %)?$/] },

    // repayment
    { id: "emiAmount", group: "repayment", kind: "money", patterns: [new RegExp(String.raw`^(emi|equated monthly instal?lment|monthly instal?lment|instal?lment|current emi|regular emi)${AMT}$`)] },
    { id: "repaymentFrequency", group: "repayment", kind: "text", patterns: [/^(loan )?(repayment|instal?lment|emi|payment) frequency$|^frequency$/] },
    { id: "firstInstalmentDate", group: "repayment", kind: "date", patterns: [/^(first|1st) (emi|instal?lment|repayment|due)( date| due date)?$/, /^(emi|repayment|instl|instal?lment) start date$/, /^date of first (emi|instal?lment)$/] },
    { id: "instalmentsPaid", group: "repayment", kind: "count", patterns: [/^(no of )?(emis?|instal?lments?) (paid|received|cleared)( no)?( amount)?$/] },
    { id: "instalmentsRemaining", group: "repayment", kind: "count", patterns: [/^(no of )?(emis?|instal?lments?) (remaining|pending|balance|outstanding|left)$|^(balance|remaining|pending) (emis?|instal?lments?|tenure)$|^future instal?lment no( amount)?$/] },

    { id: "instalmentsPaidAmount", group: "repayment", kind: "money", patterns: [/^(total )?(emis?|instal?lments?) paid amount$/] },
    { id: "principalRepaidTotal", group: "repayment", kind: "money", patterns: [/^(total )?principal (repaid|paid|received)( to date| so far)?$/] },
    { id: "interestPaidTotal", group: "repayment", kind: "money", patterns: [/^(total )?interest (paid|received)( to date| so far)?$/] },

    // disbursement
    { id: "grossDisbursed", group: "disbursement", kind: "money", patterns: [new RegExp(String.raw`^(gross )?(disbursed|disbursal|disbursement)( amount)?${AMT}$|^(total|gross) (disbursed|disbursal|disbursement)${AMT}$|^amount disbursed${AMT}$`)] },
    { id: "netDisbursed", group: "disbursement", kind: "money", patterns: [new RegExp(String.raw`^net (disbursed|disbursal|disbursement)( amount)?${AMT}$|^net amount disbursed${AMT}$`)] },
    { id: "disbursementDate", group: "disbursement", kind: "date", patterns: [/^(first )?(disbursal|disbursement|disbursed)( date| on)$|^date of (first )?(disbursal|disbursement)$/] },
    { id: "totalDeductions", group: "disbursement", kind: "money", patterns: [/^(total )?(deductions?|upfront charges)( amount)?$/] },

    // outstanding
    { id: "currentUtilised", group: "outstanding", kind: "money", patterns: [/^(current )?(utili[sz]ed|used|drawn)( amount| balance| limit)?$/] },
    { id: "outstandingPrincipal", group: "outstanding", kind: "money", patterns: [/^((current |total )?(outstanding|o s|os) principal|principal (outstanding|o s|os|balance)|pos|current outstanding principal|balance principal|principal due|outstanding principal amount)( amount)?$/], bareUnderHeading: [/^principal$/, OUTSTANDING_HEADING] },
    { id: "accruedInterest", group: "outstanding", kind: "money", patterns: [/^(accrued|outstanding|unpaid|interest) (interest|accrued|outstanding|due)( at termination)?( amount)?$/], bareUnderHeading: [/^interest$/, OUTSTANDING_HEADING] },
    { id: "chargesDue", group: "outstanding", kind: "money", patterns: [/^(charges|other charges|fees) (due|outstanding|receivable)$|^(current )?(lpf|late payment fees?)( receivable)?$/], bareUnderHeading: [/^charges$/, OUTSTANDING_HEADING] },
    { id: "penalInterest", group: "outstanding", kind: "money", patterns: [/^(penal|default|overdue) interest( due| amount)?$|^(current )?penal charges?$/] },
    { id: "totalOutstanding", group: "outstanding", kind: "money", patterns: [new RegExp(String.raw`^(total|current|net|closing)? ?(outstanding|o s|dues?|amount outstanding)(?: balance)?${AMT}$|^outstanding balance${AMT}$|^(closing|current) balance${AMT}$|^total (amount )?(due|payable)$`)] },
    { id: "principalOverdue", group: "outstanding", kind: "money", patterns: [/^(principal|principle) (overdue|over due|arrears?)( amount)?$|^overdue principal$/] },

    { id: "overdueAmount", group: "outstanding", kind: "money", patterns: [/^(current |total )?(overdue|over due|arrears)( amount)?$/] },

    // stock
    { id: "stockValue", group: "stock", kind: "money", patterns: [/^(stock|stocks|inventory|stock value|value of stock|stock amount)( value| amount)?$/] },
    { id: "bookDebts", group: "stock", kind: "money", patterns: [/^(book debts?|debtors|receivables)( value| amount)?$/] },
    { id: "marginPercent", group: "stock", kind: "rate", patterns: [/^(margin|margin %|margin percent|margin percentage|stock margin)$/] },
    { id: "stockStatementDate", group: "stock", kind: "date", patterns: [/^(stock statement|last stock statement|stock statement date|date of stock statement|last stock statement date)( date)?$/] },
];

export const FIELD_LABELS: Record<FieldId, string> = {
    lenderName: "Lender",
    customerName: "Customer name",
    loanAccountNumber: "Loan / account number",
    agreementNumber: "Agreement number",
    schemeName: "Scheme",
    currencyCode: "Currency",
    benchmarkName: "Benchmark",
    benchmarkRateText: "Benchmark rate / mark-up",
    instalmentsPaidAmount: "Amount paid in instalments",
    principalRepaidTotal: "Total principal repaid",
    interestPaidTotal: "Total interest paid",
    overdueAmount: "Overdue amount",
    linkedAccountNumber: "Linked account number",
    productName: "Product",
    branchName: "Branch",
    accountStatus: "Account status",
    statementFrom: "Statement from",
    statementTo: "Statement to",
    sanctionedAmount: "Sanctioned amount / limit",
    sanctionDate: "Sanction date",
    startDate: "Start date",
    maturityDate: "Maturity / expiry date",
    tenureMonths: "Tenure (months)",
    currentLimit: "Current limit",
    initialDrawingPower: "Initial drawing power",
    drawingPower: "Drawing power",
    availableAmount: "Available amount",
    reductionFrequency: "Reduction frequency",
    interestRate: "Interest rate (% p.a.)",
    currentInterestRate: "Current interest rate (% p.a.)",
    interestTypeText: "Interest type",
    emiAmount: "EMI",
    repaymentFrequency: "Repayment frequency",
    firstInstalmentDate: "First instalment date",
    instalmentsPaid: "Instalments paid",
    instalmentsRemaining: "Instalments remaining",
    grossDisbursed: "Gross disbursed",
    netDisbursed: "Net disbursed",
    disbursementDate: "Disbursement date",
    totalDeductions: "Deductions at disbursement",
    openingUtilised: "Opening utilised balance",
    openingUtilisedDate: "Opening balance as of",
    currentUtilised: "Current utilised balance",
    outstandingPrincipal: "Outstanding principal",
    accruedInterest: "Accrued interest",
    chargesDue: "Charges due",
    penalInterest: "Penal interest",
    totalOutstanding: "Total outstanding",
    principalOverdue: "Principal overdue",
    stockValue: "Stock value",
    bookDebts: "Book debts",
    marginPercent: "Margin (%)",
    stockStatementDate: "Stock statement date",
};

export type ColumnRole =
    | "date" | "dueDate" | "description" | "reference"
    | "debit" | "credit" | "amount" | "balance" | "marker"
    | "instalmentNo" | "principal" | "interest" | "emi" | "opening" | "closing"
    | "limit" | "drawingPower" | "rate" | "gross" | "net" | "deductions" | "chargeName" | "txnType";

const AMOUNT_SUFFIX = String.raw`(?: amount| amt| rs| inr| \(?rs\)?)*`;

/** Order matters: the first role that matches a header cell wins. */
export const COLUMN_ROLES: Array<[ColumnRole, RegExp]> = [
    ["marker", /^(dr ?cr|cr ?dr|d c|c d|dr or cr)$/],
    ["dueDate", /^(due date|instal?lment date|instal?lment due date|emi date|emi due date|repayment date|payment date|due on)$/],
    ["date", /^(date|txn date|tran date|trans date|transaction date|posting date|post date|value date|entry date|effective date|effective from|w e f|wef|with effect from|from date|revision date|reduction date|disbursal date|disbursement date|date of disbursement|charge date)$/],
    ["instalmentNo", /^(s ?no|sr ?no|sl ?no|serial no|emi no|inst no|instal?lment no|instal?lment number|no|#|period)$/],
    ["description", /^(description|narration|particulars|transaction|transaction details?|transaction detail s|details|remarks|transaction particulars)$/],
    ["txnType", /^(transaction type|txn type|trans type|entry type)$/],
    ["reference", /^(ref|ref no|reference|reference no|cheque no|chq no|chq ref no|instrument no|utr|transaction id|txn id)$/],
    ["gross", new RegExp(String.raw`^(gross|gross disbursed|gross disbursal|gross disbursement|disbursed|disbursal|disbursement|disbursed amount|disbursal amount|disbursement amount)${AMOUNT_SUFFIX}$`)],
    ["net", new RegExp(String.raw`^(net|net disbursed|net disbursal|net disbursement|net paid|net credited)${AMOUNT_SUFFIX}$`)],
    ["deductions", new RegExp(String.raw`^(deductions?|total deductions?|upfront charges)${AMOUNT_SUFFIX}$`)],
    ["chargeName", /^(charge|charges|charge name|charge type|fee|fee type|fees|expense|expense type|nature of charge|deduction head|head)$/],
    ["debit", new RegExp(String.raw`^(debit|debits|dr|withdrawal|withdrawals|paid out|money out|debit amt)${AMOUNT_SUFFIX}$`)],
    ["credit", new RegExp(String.raw`^(credit|credits|cr|deposit|deposits|receipt|receipts|paid in|money in|credit amt)${AMOUNT_SUFFIX}$`)],
    ["opening", /^(opening|opening principal|opening balance|opening outstanding|beginning balance|principal opening)( amount)?$/],
    ["closing", /^(closing|closing principal|closing balance|closing outstanding|ending balance|balance principal|principal outstanding|principal balance|outstanding principal|outstanding after payment)( amount)?$/],
    ["principal", new RegExp(String.raw`^(principal|principal component|principal part|principal due|principal repaid|principal paid)${AMOUNT_SUFFIX}$`)],
    ["interest", new RegExp(String.raw`^(interest|interest component|interest part|interest due|interest paid)${AMOUNT_SUFFIX}$`)],
    ["emi", new RegExp(String.raw`^(emi|emi due|emi payable|instal?lment|instal?lment due|total payment|total instal?lment|total due|amount due|payable)${AMOUNT_SUFFIX}$`)],
    ["drawingPower", new RegExp(String.raw`^(drawing power|dp|revised drawing power|revised dp|new drawing power|applicable drawing power|drawing power after reduction)${AMOUNT_SUFFIX}$`)],
    ["limit", new RegExp(String.raw`^(limit|sanctioned limit|revised limit|new limit|applicable limit|limit after reduction|reduced limit|reduced drawing limit)${AMOUNT_SUFFIX}$`)],
    ["rate", /^(rate|roi|rate of interest|interest rate|rate %|revised roi|revised rate|new rate|applicable rate|roi %)( p a)?$/],
    ["balance", new RegExp(String.raw`^(balance|bal|running balance|outstanding|outstanding balance|closing bal|balance outstanding|net dues|dues)${AMOUNT_SUFFIX}$`)],
    ["amount", new RegExp(String.raw`^(amount|amt|transaction amount|txn amount|amount rs)${AMOUNT_SUFFIX}$`)],
];

export function rolesOf(normalised: string): ColumnRole | null {
    for (const [role, pattern] of COLUMN_ROLES) {
        if (pattern.test(normalised)) return role;
    }

    return null;
}

export const NARRATION_RULES: Array<{ pattern: RegExp; kind: "OPENING" | "DRAWDOWN" | "INTEREST" | "CHARGE" | "INSTALMENT" | "REPAYMENT" | "REVERSAL" | "BOUNCED" }> = [
    { pattern: /opening balance|brought forward|\bb\/?f\b|balance forward/i, kind: "OPENING" },
    { pattern: /\b(bounce|dishono?u?r|return)\w*\s+(charges?|fees?)\b/i, kind: "CHARGE" },
    { pattern: /\brevers(al|ed|e)\b/i, kind: "REVERSAL" },
    { pattern: /\bbounced?\b|\bdishono?u?red\b|\breturned unpaid\b|\bcheque returned\b/i, kind: "BOUNCED" },
    { pattern: /\b(penal|cheque return|processing fee|documentation|stamp duty|gst|cersai|insurance|legal charge|valuation|late payment|renewal fee|charges?\b|fees?\b)/i, kind: "CHARGE" },
    { pattern: /\binterest\b|\bint\.?\s+(for|charged|debit|applied|capitali[sz]ed|on)\b/i, kind: "INTEREST" },
    { pattern: /\b(emi|instal?lment)\b.*\b(due|demand|raised|billed)\b|\b(due|demand)\b.*\b(emi|instal?lment)\b/i, kind: "INSTALMENT" },
    { pattern: /disburs|draw\s?down|drawal|\bwithdrawal\b|\bloan amount\b|amount financed|\butili[sz]ation\b|\bpaid to\b/i, kind: "DRAWDOWN" },
    { pattern: /received|\brcvd\b|\breceipt\b|repay|payment|\bpmnt\b|paid|\bemi\b|instal?lment|\bach\b|\bnach\b|\becs\b|\bneft\b|\brtgs\b|\bimps\b|\bupi\b|cheque|\bchq\b|collection|deposit/i, kind: "REPAYMENT" },
];

export function chargeCategory(name: string): ChargeRow["category"] {
    if (/processing|login fee|upfront fee/i.test(name)) return "PROCESSING_FEE";
    if (/insurance/i.test(name)) return "INSURANCE_PREMIUM";
    // "Sanction Fee (Incl. of GST)" is a fee that happens to include tax.
    if (!/incl/i.test(name) && /\bgst\b|service tax|\bcgst\b|\bsgst\b|\bigst\b/i.test(name)) return "GST";
    if (/legal|advocate/i.test(name)) return "LEGAL_CHARGES";
    if (/document/i.test(name)) return "DOCUMENTATION_CHARGES";
    if (/valuation|technical/i.test(name)) return "VALUATION_CHARGES";
    if (/stamp/i.test(name)) return "STAMP_DUTY";

    return "OTHER_CHARGES";
}
