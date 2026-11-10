// ---------------------------------------------------------------------
// Add Loan setup - the accounting rules, as pure functions.
//
//   Loan liability      = gross amount disbursed (what is owed), never the
//                         net amount that reached the bank.
//   Net bank receipt    = gross - lender deductions. It is the EXISTING
//                         bank credit, when linked; never a new one.
//   Lender deductions   = the initial expenses marked "Deducted from
//                         disbursement" - together exactly that
//                         disbursement's deductions. No bank debit exists.
//   Paid separately     = an initial expense paid from a bank account,
//                         linked (optionally) to that EXISTING debit - so
//                         it is counted once, through that transaction.
//   Opening balances    = an OD's opening used amount / a running loan's
//                         principal: a liability only, no bank movement.
//
// Amounts are compared to the paisa. There is no tolerance: a difference
// is a difference (the user's standing rule for loan matching).
// ---------------------------------------------------------------------

import { LoanKind } from "../types/LoanKind";
import {
    EXPENSE_SETTLEMENT_LABELS,
    INITIAL_EXPENSE_TYPE_LABELS,
    INITIAL_EXPENSE_TYPES,
    type InitialExpenseDetails,
    type LinkedTransactionSummary,
    type LoanDisbursementDetails,
    type LoanSetupDetails,
    type MoneySide,
    type SetupIssue,
} from "./loanSetupTypes";

/** Float noise only - never a rounding allowance. */
const MONEY_EPSILON = 0.005;

export function roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function sameMoney(a: number, b: number): boolean {
    return Math.abs(a - b) < MONEY_EPSILON;
}

export function formatMoney(value: number): string {
    return new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(value);
}

/** GST on a base amount at a percentage rate, to the paisa. */
export function gstAmountFor(baseAmount: number, gstRate: number): number {
    return roundMoney((baseAmount * gstRate) / 100);
}

/**
 * An expense's base, GST and total. With a GST rate the GST is calculated;
 * without one, the typed GST amount (default 0) is used as entered.
 */
export function expenseAmounts(expense: {
    baseAmount: number | null;
    gstRate: number | null;
    gstAmount: number | null;
}): { base: number; gst: number; total: number } {
    const base = roundMoney(Number(expense.baseAmount ?? 0));
    const gst =
        expense.gstRate !== null && expense.gstRate !== undefined
            ? gstAmountFor(base, Number(expense.gstRate))
            : roundMoney(Number(expense.gstAmount ?? 0));

    return { base, gst, total: roundMoney(base + gst) };
}

export function disbursementNet(grossAmount: number, deductionsAmount: number): number {
    return roundMoney(grossAmount - deductionsAmount);
}

export interface SetupTotals {
    grossDisbursed: number;
    totalDeductions: number;
    netReceived: number;
    expensesTotal: number;
    expensesDeducted: number;
    expensesPaidSeparately: number;
    expensesChargedToLoan: number;
    gstTotal: number;
}

export function summarizeSetup(
    details: Pick<LoanSetupDetails, "disbursements" | "expenses">
): SetupTotals {
    const sum = (values: number[]) => roundMoney(values.reduce((total, value) => total + value, 0));
    const expensesBy = (settlement: InitialExpenseDetails["settlement"]) =>
        sum(details.expenses.filter(e => e.settlement === settlement).map(e => e.totalAmount));

    return {
        grossDisbursed: sum(details.disbursements.map(d => d.grossAmount)),
        totalDeductions: sum(details.disbursements.map(d => d.deductionsAmount)),
        netReceived: sum(details.disbursements.map(d => d.netAmount)),
        expensesTotal: sum(details.expenses.map(e => e.totalAmount)),
        expensesDeducted: expensesBy("DEDUCTED_FROM_DISBURSEMENT"),
        expensesPaidSeparately: expensesBy("PAID_SEPARATELY"),
        expensesChargedToLoan: expensesBy("CHARGED_TO_LOAN_ACCOUNT"),
        gstTotal: sum(details.expenses.map(e => e.gstAmount)),
    };
}

/** Which way a transaction moves money on its own account. */
export function moneySideOf(transaction: {
    type: string;
    transferDirection?: string | null;
}): MoneySide | null {
    if (transaction.type === "income") return "IN";
    if (transaction.type === "expense") return "OUT";
    if (transaction.type === "transfer") {
        if (transaction.transferDirection === "IN") return "IN";
        if (transaction.transferDirection === "OUT") return "OUT";
    }

    return null;
}

/**
 * Why `transaction` cannot back this record, or null when it fits:
 * the right account, the right direction, exactly the right amount.
 */
export function linkedTransactionRefusal(
    transaction: LinkedTransactionSummary,
    expected: { side: MoneySide; accountId: string | null; amount: number; what: string }
): string | null {
    if (expected.accountId && transaction.accountId !== expected.accountId) {
        return `The bank transaction linked to ${expected.what} is on a different bank account.`;
    }

    if (transaction.side !== expected.side) {
        return expected.side === "IN"
            ? `The bank transaction linked to ${expected.what} is not money received.`
            : `The bank transaction linked to ${expected.what} is not money paid out.`;
    }

    if (!sameMoney(transaction.amount, expected.amount)) {
        return `The bank transaction linked to ${expected.what} is for ${formatMoney(transaction.amount)}, not ${formatMoney(expected.amount)}.`;
    }

    return null;
}

/**
 * A warning (never a change) when a linked bank transaction is categorised
 * in a way that makes reports count it differently from this loan.
 */
export function linkedTransactionCategoryWarning(
    transaction: LinkedTransactionSummary,
    role: "DISBURSEMENT" | "EXPENSE",
    what: string
): string | null {
    const type = transaction.categoryType?.toUpperCase() ?? null;

    if (role === "DISBURSEMENT" && type === "INCOME") {
        return `The bank credit for ${what} is categorised "${transaction.categoryName}" (income), so reports count the loan money as income. FinWea does not change it - re-categorise it to a transfer category such as Loan Principal Drawdown if it should not be income.`;
    }

    if (role === "EXPENSE" && type === "INCOME") {
        return `The bank debit for ${what} is categorised "${transaction.categoryName}" (income). Check its category.`;
    }

    return null;
}

export interface SetupValidationContext {
    loanKind: LoanKind;
    sanctionedAmount: number | null;
    sanctionDate: string | null;
}

/**
 * Every rule a disbursement / initial expense set must satisfy before it
 * is saved. Checked by the wizard and again by LoanService (and the
 * Rust command) - the database never receives an inconsistent setup.
 */
export function validateSetupDetails(
    details: Pick<LoanSetupDetails, "disbursements" | "expenses">,
    context: SetupValidationContext
): SetupIssue[] {
    const issues: SetupIssue[] = [];
    const isOd = context.loanKind === LoanKind.OVERDRAFT;

    if (isOd && details.disbursements.length > 0) {
        issues.push({
            field: "disbursements",
            message: "An overdraft has no disbursements - record its opening used amount instead.",
        });
    }

    details.disbursements.forEach((d, index) => {
        const label = `Disbursement ${index + 1}`;
        const field = `disbursements.${index}`;

        if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
            issues.push({ field: `${field}.date`, message: `${label}: enter the disbursement date.` });
        } else if (context.sanctionDate && d.date < context.sanctionDate) {
            issues.push({ field: `${field}.date`, message: `${label} is dated before the sanction date.` });
        }

        if (!(d.grossAmount > 0)) {
            issues.push({ field: `${field}.grossAmount`, message: `${label}: the gross amount must be greater than 0.` });
        }

        if (d.deductionsAmount < 0) {
            issues.push({ field: `${field}.deductionsAmount`, message: `${label}: deductions cannot be negative.` });
        } else if (d.deductionsAmount > d.grossAmount) {
            issues.push({ field: `${field}.deductionsAmount`, message: `${label}: deductions cannot be more than the gross amount.` });
        }

        if (!sameMoney(d.netAmount, disbursementNet(d.grossAmount, d.deductionsAmount))) {
            issues.push({ field: `${field}.netAmount`, message: `${label}: the net amount must be gross less deductions.` });
        }

        if (d.transactionId && !d.destinationAccountId) {
            issues.push({ field: `${field}.destinationAccountId`, message: `${label}: choose the bank account the money was credited to.` });
        }

        const deducted = roundMoney(
            details.expenses
                .filter(e => e.settlement === "DEDUCTED_FROM_DISBURSEMENT" && e.disbursementIndex === index)
                .reduce((sum, e) => sum + e.totalAmount, 0)
        );

        if (!sameMoney(deducted, d.deductionsAmount)) {
            issues.push({
                field: `${field}.deductionsAmount`,
                message:
                    d.deductionsAmount > 0 && deducted === 0
                        ? `${label}: the lender deducted ${formatMoney(d.deductionsAmount)}. Add those charges in Initial Expenses as "Deducted from disbursement" so they are accounted for.`
                        : `${label}: deductions are ${formatMoney(d.deductionsAmount)}, but the expenses deducted from it total ${formatMoney(deducted)}.`,
            });
        }
    });

    const gross = roundMoney(details.disbursements.reduce((sum, d) => sum + d.grossAmount, 0));

    if (context.sanctionedAmount !== null && context.sanctionedAmount > 0 && gross - context.sanctionedAmount >= MONEY_EPSILON) {
        issues.push({
            field: "disbursements",
            message: `The disbursements total ${formatMoney(gross)}, more than the sanctioned amount of ${formatMoney(context.sanctionedAmount)}.`,
        });
    }

    details.expenses.forEach((e, index) => {
        const label = `Expense ${index + 1} (${INITIAL_EXPENSE_TYPE_LABELS[e.expenseType] ?? e.expenseType})`;
        const field = `expenses.${index}`;

        if (!INITIAL_EXPENSE_TYPES.includes(e.expenseType)) {
            issues.push({ field: `${field}.expenseType`, message: `${label}: choose an expense type.` });
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(e.expenseDate)) {
            issues.push({ field: `${field}.expenseDate`, message: `${label}: enter the expense date.` });
        }

        if (e.baseAmount < 0 || e.gstAmount < 0) {
            issues.push({ field: `${field}.baseAmount`, message: `${label}: amounts cannot be negative.` });
        }

        if (e.gstRate !== null && (e.gstRate < 0 || e.gstRate > 100)) {
            issues.push({ field: `${field}.gstRate`, message: `${label}: the GST rate must be between 0 and 100%.` });
        }

        if (!(e.totalAmount > 0)) {
            issues.push({ field: `${field}.baseAmount`, message: `${label}: the total must be greater than 0.` });
        }

        if (!sameMoney(e.totalAmount, roundMoney(e.baseAmount + e.gstAmount))) {
            issues.push({ field: `${field}.totalAmount`, message: `${label}: the total must be base plus GST.` });
        }

        if (e.settlement === "DEDUCTED_FROM_DISBURSEMENT") {
            if (isOd) {
                issues.push({
                    field: `${field}.settlement`,
                    message: `${label}: an overdraft has no disbursement to deduct from. Choose "Paid separately" or "Charged to the loan account".`,
                });
            } else if (
                e.disbursementIndex === null ||
                e.disbursementIndex < 0 ||
                e.disbursementIndex >= details.disbursements.length
            ) {
                issues.push({ field: `${field}.disbursementIndex`, message: `${label}: choose the disbursement it was deducted from.` });
            }
        }

        if (e.settlement === "CHARGED_TO_LOAN_ACCOUNT" && !isOd) {
            issues.push({
                field: `${field}.settlement`,
                message: `${label}: for a term loan, a charge kept by the lender is "Deducted from disbursement".`,
            });
        }

        if (e.settlement !== "PAID_SEPARATELY" && e.transactionId) {
            issues.push({
                field: `${field}.transaction`,
                message: `${label}: ${EXPENSE_SETTLEMENT_LABELS[e.settlement].toLowerCase()} means no bank debit, so it cannot be linked to a bank transaction.`,
            });
        }
    });

    const linked = [
        ...details.disbursements.map(d => d.transactionId),
        ...details.expenses.map(e => e.transactionId),
    ].filter((id): id is string => Boolean(id));

    if (new Set(linked).size !== linked.length) {
        issues.push({
            field: "transactions",
            message: "The same bank transaction is linked twice. Each bank transaction can back only one disbursement or expense.",
        });
    }

    return issues;
}

// ------------------------------------------------- accounting entry preview

export interface AccountingLine {
    account: string;
    debit: number | null;
    credit: number | null;
}

export interface AccountingEntry {
    date: string;
    title: string;
    lines: AccountingLine[];
    /** What happens in the bank: linked existing transaction, or none. */
    bankEffect: string;
}

export interface AccountingPreviewInput {
    loanName: string;
    loanKind: LoanKind;
    startDate: string;
    /** Term Loan with no disbursement rows: the principal owed from the start. */
    principalAmount: number | null;
    openingUsed: number | null;
    openingUsedAsOf: string | null;
    disbursements: LoanDisbursementDetails[];
    expenses: InitialExpenseDetails[];
    accountName(accountId: string | null): string;
    transactionLabel(transactionId: string): string;
}

/**
 * The double-entry view of everything the setup records - for the Review
 * step. It is a preview of meaning only: none of these lines becomes a
 * transaction row. The only bank movements involved are existing ones.
 */
export function buildAccountingEntries(input: AccountingPreviewInput): AccountingEntry[] {
    const entries: AccountingEntry[] = [];
    const liability = `${input.loanName || "Loan"} - loan liability`;

    if (input.loanKind === LoanKind.OVERDRAFT) {
        const opening = roundMoney(Number(input.openingUsed ?? 0));

        if (opening > 0) {
            entries.push({
                date: input.openingUsedAsOf ?? input.startDate,
                title: "Opening used balance",
                lines: [
                    { account: "Opening balance (brought forward)", debit: opening, credit: null },
                    { account: liability, debit: null, credit: opening },
                ],
                bankEffect: "No bank transaction - the amount was already used before this date.",
            });
        }
    } else if (input.disbursements.length === 0 && (input.principalAmount ?? 0) > 0) {
        const principal = roundMoney(Number(input.principalAmount));

        entries.push({
            date: input.startDate,
            title: "Opening loan principal",
            lines: [
                { account: "Opening balance (brought forward)", debit: principal, credit: null },
                { account: liability, debit: null, credit: principal },
            ],
            bankEffect: "No bank transaction - no disbursement was entered.",
        });
    }

    input.disbursements.forEach((d, index) => {
        const deducted = input.expenses.filter(
            e => e.settlement === "DEDUCTED_FROM_DISBURSEMENT" && e.disbursementIndex === index
        );
        const lines: AccountingLine[] = [];

        if (d.netAmount > 0) {
            lines.push({ account: input.accountName(d.destinationAccountId), debit: d.netAmount, credit: null });
        }

        for (const e of deducted) {
            lines.push({
                account: `Loan expense - ${INITIAL_EXPENSE_TYPE_LABELS[e.expenseType]}${e.gstAmount > 0 ? " (incl. GST)" : ""}`,
                debit: e.totalAmount,
                credit: null,
            });
        }

        lines.push({ account: liability, debit: null, credit: d.grossAmount });

        entries.push({
            date: d.date,
            title: `Disbursement ${index + 1}${d.reference ? ` (${d.reference})` : ""}`,
            lines,
            bankEffect: d.transactionId
                ? `Uses the existing bank credit ${input.transactionLabel(d.transactionId)}. No new transaction is created.`
                : "Not linked to a bank credit. No bank transaction is created - link the credit later if it is in your statement.",
        });
    });

    input.expenses.forEach(e => {
        if (e.settlement === "DEDUCTED_FROM_DISBURSEMENT") {
            return; // shown inside its disbursement
        }

        const expenseAccount = `Loan expense - ${INITIAL_EXPENSE_TYPE_LABELS[e.expenseType]}${e.gstAmount > 0 ? " (incl. GST)" : ""}`;

        if (e.settlement === "CHARGED_TO_LOAN_ACCOUNT") {
            entries.push({
                date: e.expenseDate,
                title: `${INITIAL_EXPENSE_TYPE_LABELS[e.expenseType]} charged by the lender`,
                lines: [
                    { account: expenseAccount, debit: e.totalAmount, credit: null },
                    { account: `${input.loanName || "Loan"} - lender account`, debit: null, credit: e.totalAmount },
                ],
                bankEffect:
                    "No bank transaction. Recorded only - it does not change the OD's used amount (include it in the opening used amount if your lender statement does).",
            });
            return;
        }

        entries.push({
            date: e.expenseDate,
            title: `${INITIAL_EXPENSE_TYPE_LABELS[e.expenseType]} paid separately`,
            lines: [
                { account: expenseAccount, debit: e.totalAmount, credit: null },
                { account: input.accountName(e.paymentAccountId), debit: null, credit: e.totalAmount },
            ],
            bankEffect: e.transactionId
                ? `Uses the existing bank debit ${input.transactionLabel(e.transactionId)}. No new transaction is created.`
                : "Not linked to a bank debit. No bank transaction is created.",
        });
    });

    return entries;
}
