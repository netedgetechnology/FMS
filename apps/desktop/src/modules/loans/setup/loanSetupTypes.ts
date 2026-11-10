// ---------------------------------------------------------------------
// The Add Loan setup workflow (migration 051) - its vocabulary.
//
// Two shapes live here:
//   - the DETAILS LoanService.create persists (LoanSetupDetails): plain,
//     validated values, one row per disbursement / initial expense;
//   - the DRAFT the wizard edits (LoanSetupDraft): what the user is typing,
//     blanks included. loanSetupWizard.ts turns a draft into details.
// Nothing in either shape ever describes a NEW bank transaction: a
// disbursement or an expense can only reference an existing one.
// ---------------------------------------------------------------------

import type { LoanKind } from "../types/LoanKind";
import type { DrawingPowerStep, DrawingPowerStepDraft } from "./droplineSchedule";
import type { HistoricalInstalmentDetails, HistoricalInstalmentDraft } from "./historicalInstalments";

export const INITIAL_EXPENSE_TYPES = [
    "PROCESSING_FEE",
    "GST",
    "INSURANCE_PREMIUM",
    "LEGAL_CHARGES",
    "DOCUMENTATION_CHARGES",
    "VALUATION_CHARGES",
    "STAMP_DUTY",
    "OTHER_CHARGES",
] as const;

export type InitialExpenseType = (typeof INITIAL_EXPENSE_TYPES)[number];

export const INITIAL_EXPENSE_TYPE_LABELS: Record<InitialExpenseType, string> = {
    PROCESSING_FEE: "Processing Fee",
    GST: "GST",
    INSURANCE_PREMIUM: "Insurance Premium",
    LEGAL_CHARGES: "Legal Charges",
    DOCUMENTATION_CHARGES: "Documentation Charges",
    VALUATION_CHARGES: "Valuation Charges",
    STAMP_DUTY: "Stamp Duty",
    OTHER_CHARGES: "Other Charges",
};

/**
 * How an initial expense was settled:
 *   DEDUCTED_FROM_DISBURSEMENT - the lender kept it out of the money it
 *     released (Term Loan). No bank debit exists or is ever created.
 *   PAID_SEPARATELY - the user paid it from a bank account. It may be
 *     linked to that EXISTING bank transaction; never a new one.
 *   CHARGED_TO_LOAN_ACCOUNT - the lender debited it to the loan / OD
 *     account itself (Overdraft). No bank debit; it is recorded only, and
 *     never moves the OD's Used amount.
 */
export type ExpenseSettlement =
    | "DEDUCTED_FROM_DISBURSEMENT"
    | "PAID_SEPARATELY"
    | "CHARGED_TO_LOAN_ACCOUNT";

export const EXPENSE_SETTLEMENT_LABELS: Record<ExpenseSettlement, string> = {
    DEDUCTED_FROM_DISBURSEMENT: "Deducted from disbursement",
    PAID_SEPARATELY: "Paid separately",
    CHARGED_TO_LOAN_ACCOUNT: "Charged to the loan account",
};

export type RateType = "FIXED" | "FLOATING";

/** How the wizard asks for the interest method; stored as two columns. */
export type InterestMethod = "REDUCING_MONTHLY" | "REDUCING_ACTUAL_365" | "FLAT";

export const INTEREST_METHOD_LABELS: Record<InterestMethod, string> = {
    REDUCING_MONTHLY: "Reducing balance - monthly rate (rate ÷ 12)",
    REDUCING_ACTUAL_365: "Reducing balance - actual days ÷ 365",
    FLAT: "Flat rate",
};

export type InterestCalculationMethod = "MONTHLY_RATE" | "ACTUAL_365";

export type ScheduleMethod = "GENERATED" | "LENDER_CSV";

/** The one movement a linked bank transaction makes on its account. */
export type MoneySide = "IN" | "OUT";

/** An existing bank transaction, as the wizard shows and checks it. */
export interface LinkedTransactionSummary {
    id: string;
    date: string;
    amount: number;
    accountId: string;
    accountName: string | null;
    side: MoneySide | null;
    payee: string;
    narration: string | null;
    categoryName: string | null;
    /** INCOME / EXPENSE / TRANSFER - used to warn, never to change it. */
    categoryType: string | null;
}

/** One row of the lender's official schedule, exactly as imported. */
export interface LenderScheduleRow {
    installmentNumber: number;
    dueDate: string;
    openingPrincipal: number;
    principal: number;
    interest: number;
    emi: number;
    closingPrincipal: number;
}

// ------------------------------------------------------------- persisted

export interface LoanDisbursementDetails {
    date: string;
    grossAmount: number;
    deductionsAmount: number;
    netAmount: number;
    destinationAccountId: string | null;
    reference: string | null;
    transactionId: string | null;
}

export interface InitialExpenseDetails {
    expenseType: InitialExpenseType;
    description: string | null;
    expenseDate: string;
    baseAmount: number;
    gstRate: number | null;
    gstAmount: number;
    totalAmount: number;
    settlement: ExpenseSettlement;
    /** DEDUCTED_FROM_DISBURSEMENT only: index into `disbursements`. */
    disbursementIndex: number | null;
    paymentMethod: string | null;
    paymentAccountId: string | null;
    transactionReference: string | null;
    transactionId: string | null;
}

export interface LoanSetupDetails {
    loanPurpose: string | null;
    rateType: RateType | null;
    interestCalculationMethod: InterestCalculationMethod | null;
    sanctionDate: string | null;
    sanctionedAmount: number | null;
    firstEmiDate: string | null;
    repaymentFrequency: "MONTHLY" | null;
    paymentDay: number | null;
    gracePeriodMonths: number | null;
    balloonAmount: number | null;
    scheduleSource: ScheduleMethod | null;
    drawingPower: number | null;
    disbursements: LoanDisbursementDetails[];
    expenses: InitialExpenseDetails[];
    /** LENDER_CSV only: the validated official schedule (authoritative). */
    lenderSchedule: LenderScheduleRow[] | null;
    /**
     * Term Loan already running before FinWea: its first instalments, each
     * resolved one by one - linked to its real bank debit, or explicitly
     * "Settled before FinWea". Absent / empty: nothing is marked paid.
     */
    historicalInstalments?: HistoricalInstalmentDetails[];
    /** Dropline Overdraft only (migration 053): the dated drawing-power steps. */
    drawingPowerSchedule?: DrawingPowerStep[];
}

// ----------------------------------------------------------------- draft

export interface DisbursementDraft {
    key: string;
    date: string;
    grossAmount: number | null;
    deductionsAmount: number | null;
    destinationAccountId: string;
    reference: string;
    transaction: LinkedTransactionSummary | null;
}

export interface InitialExpenseDraft {
    key: string;
    expenseType: InitialExpenseType;
    description: string;
    expenseDate: string;
    baseAmount: number | null;
    /** Set: GST is calculated from it. Blank: gstAmount is typed in. */
    gstRate: number | null;
    gstAmount: number | null;
    settlement: ExpenseSettlement;
    disbursementKey: string | null;
    paymentMethod: string;
    paymentAccountId: string;
    transactionReference: string;
    transaction: LinkedTransactionSummary | null;
}

export interface LenderScheduleDraft {
    fileName: string;
    rows: LenderScheduleRow[];
}

export interface LoanSetupDraft {
    loanKind: LoanKind;

    // A - basic details
    name: string;
    lenderName: string;
    loanAccountNumber: string;
    loanCategory: string;
    purpose: string;
    currencyId: string;
    sanctionedAmount: number | null;
    /** Term Loan without disbursement rows: the principal to schedule. */
    principalAmount: number | null;
    interestRate: number | null;
    rateType: RateType;
    interestMethod: InterestMethod;
    sanctionDate: string;
    startDate: string;
    /** Term Loan: the EMI debit account. */
    linkedAccountId: string;
    status: "ACTIVE" | "CLOSED" | "ON_HOLD" | "DEFAULTED";
    notes: string;

    // B - disbursement (Term Loan)
    disbursements: DisbursementDraft[];

    // C - initial expenses
    expenses: InitialExpenseDraft[];

    // D - repayment (Term Loan)
    emiAmount: number | null;
    tenureMonths: number | null;
    firstEmiDate: string;
    paymentDay: number | null;
    gracePeriodMonths: number | null;
    balloonAmount: number | null;
    firstInstallmentAmount: number | null;
    /**
     * How many of the first instalments were already paid before the loan
     * was added (only instalments due on or before today). Each one must
     * then be resolved in `historical`.
     */
    historicalCount: number;
    /** Index i = instalment i+1 of the schedule. */
    historical: HistoricalInstalmentDraft[];

    // E - schedule method (Term Loan)
    scheduleMethod: ScheduleMethod;
    lenderSchedule: LenderScheduleDraft | null;

    // F - overdraft
    creditLimit: number | null;
    drawingPower: number | null;
    openingUsed: number | null;
    openingUsedAsOf: string;
    odAccountIds: string[];
    /** A Dropline Overdraft: its drawing power follows the steps below. */
    dropline: boolean;
    drawingPowerSchedule: DrawingPowerStepDraft[];
}

/** A problem that blocks Save (error) or that the user should see (warning). */
export interface SetupIssue {
    field: string;
    message: string;
}
