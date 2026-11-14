// ---------------------------------------------------------------------
// Term Loan: the lender statement's own position compared with the loan
// FinWea is about to save. Pure and informational - nothing here changes
// a figure on either side. A difference is explained so the customer can
// decide (check the first EMI date, import the lender's CSV schedule,
// correct a value); it is never "fixed" silently. Amounts are compared to
// the paisa with no tolerance.
// ---------------------------------------------------------------------

import type { LoanPaymentSchedule } from "../types";
import { formatMoney, roundMoney, sameMoney } from "../setup/loanSetupAccounting";

import type { StatementReviewState } from "./statementReview";

/** The statement's position, as the customer confirmed it on review. */
export interface StatementFacts {
    fileName: string;
    /** The statement period's end - the date its figures are as of. */
    asOf: string | null;
    grossDisbursed: number | null;
    emiAmount: number | null;
    instalmentsPaid: number | null;
    principalRepaidTotal: number | null;
    outstandingPrincipal: number | null;
}

function confirmedNumber(state: StatementReviewState, id: keyof StatementReviewState["fields"]): number | null {
    const field = state.fields[id];
    return field.status === "FOUND" && typeof field.value === "number" ? field.value : null;
}

export function statementFactsFromReview(state: StatementReviewState): StatementFacts {
    const to = state.fields.statementTo;

    return {
        fileName: state.fileName,
        asOf: to.status === "FOUND" && typeof to.value === "string" ? to.value : null,
        grossDisbursed: confirmedNumber(state, "grossDisbursed"),
        emiAmount: confirmedNumber(state, "emiAmount"),
        instalmentsPaid: confirmedNumber(state, "instalmentsPaid"),
        principalRepaidTotal: confirmedNumber(state, "principalRepaidTotal"),
        outstandingPrincipal: confirmedNumber(state, "outstandingPrincipal"),
    };
}

export interface StatementCheck {
    id: "principal" | "emi" | "instalmentsDue" | "instalmentsResolved" | "principalRepaid" | "outstanding";
    label: string;
    statement: string;
    finwea: string;
    agrees: boolean;
    /** Why they may differ and what to check; null when they agree. */
    explanation: string | null;
}

/** DD/MM/YYYY, as everywhere else in FinWea's loan screens (setupFields' formatDisplayDate). */
function displayDate(iso: string): string {
    if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso;
    const [year, month, day] = iso.slice(0, 10).split("-");
    return `${day}/${month}/${year}`;
}

function mostCommon(values: number[]): number | null {
    const counts = new Map<number, number>();
    let best: number | null = null;
    for (const value of values) {
        const count = (counts.get(value) ?? 0) + 1;
        counts.set(value, count);
        if (best === null || count > (counts.get(best) ?? 0)) best = value;
    }
    return best;
}

/**
 * Compares the statement with the schedule about to be saved. `resolved`
 * is how many historical instalments the customer linked to a bank debit
 * or declared settled before FinWea. `scheduleSource` says where that
 * schedule came from: once it is the lender's own CSV, the advice never
 * suggests importing it again - a difference is then between two lender
 * documents, so the customer checks the CSV is the current one.
 */
export function compareWithStatement(
    facts: StatementFacts,
    loan: {
        principal: number;
        schedule: readonly LoanPaymentSchedule[];
        resolved: number;
        scheduleSource?: "GENERATED" | "LENDER_CSV";
    }
): StatementCheck[] {
    const checks: StatementCheck[] = [];
    const rows = [...loan.schedule].sort((a, b) => a.installmentNumber - b.installmentNumber);
    const fromLenderCsv = loan.scheduleSource === "LENDER_CSV";
    const checkTheCsv =
        "Check that the CSV is the lender's latest schedule for this account - a rate change, broken-period interest or a part-payment usually comes with a revised schedule.";

    if (facts.grossDisbursed !== null) {
        const agrees = sameMoney(facts.grossDisbursed, loan.principal);
        checks.push({
            id: "principal",
            label: "Amount disbursed",
            statement: formatMoney(facts.grossDisbursed),
            finwea: formatMoney(loan.principal),
            agrees,
            explanation: agrees ? null : "The loan's principal is not what the statement says was disbursed. Check the gross amounts in Disbursement history.",
        });
    }

    const regularEmi = mostCommon(rows.map(row => row.totalAmount));
    if (facts.emiAmount !== null && regularEmi !== null) {
        const agrees = sameMoney(facts.emiAmount, regularEmi);
        checks.push({
            id: "emi",
            label: "EMI",
            statement: formatMoney(facts.emiAmount),
            finwea: formatMoney(regularEmi),
            agrees,
            explanation: agrees
                ? null
                : fromLenderCsv
                  ? `The lender's CSV schedule has a regular EMI ${formatMoney(roundMoney(regularEmi - facts.emiAmount))} different from the statement's; the bank debits must equal the schedule's EMI exactly to link. ${checkTheCsv}`
                  : `The schedule's regular EMI differs by ${formatMoney(roundMoney(regularEmi - facts.emiAmount))}. Lenders often round the EMI or use a different day count; the bank debits must equal the schedule's EMI exactly to link. Correct the EMI in the review's Repayment section, or import the lender's CSV schedule.`,
        });
    }

    // The instalments the statement's figures cover: those due by the
    // statement date, or - with no date - as many as it counts paid.
    const covered = facts.asOf !== null
        ? rows.filter(row => row.dueDate.slice(0, 10) <= facts.asOf!)
        : facts.instalmentsPaid !== null
          ? rows.slice(0, facts.instalmentsPaid)
          : null;
    const coveredLabel = facts.asOf !== null ? `as of ${displayDate(facts.asOf)}` : `after ${facts.instalmentsPaid} instalment(s)`;

    if (facts.instalmentsPaid !== null && facts.asOf !== null && covered) {
        const agrees = covered.length === facts.instalmentsPaid;
        checks.push({
            id: "instalmentsDue",
            label: `Instalments ${coveredLabel}`,
            statement: `${facts.instalmentsPaid} paid`,
            finwea: `${covered.length} due`,
            agrees,
            explanation: agrees
                ? null
                : fromLenderCsv
                  ? "The lender's CSV schedule does not have the same number of instalments due by the statement date as the statement counts paid. Check that the CSV belongs to this account and is its latest version, or whether an instalment was missed or paid early."
                  : "The schedule does not have the same number of instalments due by the statement date as the statement counts paid. Check the first EMI date (the schedule may run a month early or late), or whether an instalment was missed or paid early.",
        });
    }

    if (facts.instalmentsPaid !== null) {
        const agrees = loan.resolved === facts.instalmentsPaid;
        checks.push({
            id: "instalmentsResolved",
            label: "Past instalments recorded",
            statement: `${facts.instalmentsPaid} paid`,
            finwea: `${loan.resolved} linked or settled`,
            agrees,
            explanation: agrees
                ? null
                : loan.resolved < facts.instalmentsPaid
                  ? `${facts.instalmentsPaid - loan.resolved} instalment(s) the statement shows paid are not linked to a bank debit or marked settled, so FinWea will show them unpaid. Resolve them under Instalments Paid Before FinWea, or link the debits later from Transactions.`
                  : "More instalments are recorded as paid than the statement counts. Check the instalments under Instalments Paid Before FinWea.",
        });
    }

    if (covered && facts.principalRepaidTotal !== null) {
        const scheduled = roundMoney(covered.reduce((sum, row) => sum + row.principalAmount, 0));
        const agrees = sameMoney(scheduled, facts.principalRepaidTotal);
        checks.push({
            id: "principalRepaid",
            label: `Principal repaid ${coveredLabel}`,
            statement: formatMoney(facts.principalRepaidTotal),
            finwea: formatMoney(scheduled),
            agrees,
            explanation: agrees
                ? null
                : fromLenderCsv
                  ? `The lender's CSV schedule and the statement disagree on the principal repaid for these instalments. Neither figure is changed. ${checkTheCsv}`
                  : "The schedule's principal for these instalments differs from what the lender applied. This usually means a different rate, EMI rounding, broken-period interest or a part-payment. Importing the lender's CSV schedule uses the lender's own figures.",
        });
    }

    if (covered && facts.outstandingPrincipal !== null) {
        const last = covered[covered.length - 1];
        const scheduled = last ? last.outstandingPrincipal : loan.principal;
        const agrees = sameMoney(scheduled, facts.outstandingPrincipal);
        checks.push({
            id: "outstanding",
            label: `Outstanding principal ${coveredLabel}`,
            statement: formatMoney(facts.outstandingPrincipal),
            finwea: formatMoney(scheduled),
            agrees,
            explanation: agrees
                ? null
                : fromLenderCsv
                  ? `The lender's CSV schedule's outstanding principal differs from the statement's by ${formatMoney(roundMoney(scheduled - facts.outstandingPrincipal))}. Neither figure is changed. ${checkTheCsv}`
                  : `The schedule's outstanding principal differs from the lender's by ${formatMoney(roundMoney(scheduled - facts.outstandingPrincipal))}. Neither figure is changed: check the rate, EMI and first EMI date, or import the lender's CSV schedule.`,
        });
    }

    return checks;
}
