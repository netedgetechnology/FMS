import {
    OVERDRAFT_USAGE_STATUS_LABELS,
    type OverdraftPosition,
} from "../services/overdraftPosition";
import { isOverdraft, type Loan } from "../types";

// ---------------------------------------------------------------------
// The Loans page shows two independent tables: Term Loans and Over Draft.
// This file holds the page's display decisions as pure functions (the
// repo's tests run in a node environment with no component rendering -
// see ViewLoanDialog.test.ts), so which loan goes in which table, the
// columns of each and the actions of each row are unit tested.
//
// Nothing here calculates an OD figure: Used / Available / status all
// come from the existing OverdraftPosition (OVERDRAFT_POSITIONS_SQL +
// computeOverdraftPosition) and are shown exactly as derived - a negative
// Used or a Needs Review status is never hidden or corrected here.
// ---------------------------------------------------------------------

export const TERM_LOAN_COLUMNS = [
    "Loan",
    "Type",
    "Principal",
    "Outstanding",
    "Interest",
    "EMI",
    "Status",
    "Actions",
] as const;

export const OVERDRAFT_COLUMNS = [
    "Overdraft",
    "OD Limit",
    "Used",
    "Available",
    "Interest Rate",
    "Linked Accounts",
    "Status",
    "Actions",
] as const;

export type LoanRowAction = "VIEW" | "EDIT" | "EMI_SCHEDULE" | "DELETE";

/** Every loan lands in exactly one section, in its original order. */
export function splitLoansBySection(loans: readonly Loan[]): {
    termLoans: Loan[];
    overdrafts: Loan[];
} {
    return {
        termLoans: loans.filter(loan => !isOverdraft(loan)),
        overdrafts: loans.filter(isOverdraft),
    };
}

/** An Overdraft has no EMI schedule; everything else is shared. */
export function loanRowActions(loan: Loan): LoanRowAction[] {
    return isOverdraft(loan)
        ? ["VIEW", "EDIT", "DELETE"]
        : ["VIEW", "EDIT", "EMI_SCHEDULE", "DELETE"];
}

export interface OverdraftRowModel {
    /** null while the position has not loaded (shown as a dash). */
    limit: number | null;
    used: number | null;
    available: number | null;
    interestRate: number;
    linkedAccounts: string[];
    loanStatus: Loan["status"];
    usageStatusLabel: string | null;
    /** Needs Review, Over Limit or Over Drawing Power - shown as a warning. */
    usageWarning: boolean;
    reviewReasons: string[];
}

/**
 * One Over Draft row, straight from the OD's derived position. A linked
 * account whose name cannot be resolved shows its id rather than being
 * dropped, as the View dialog does.
 */
export function buildOverdraftRow(
    loan: Loan,
    position: OverdraftPosition | null,
    accountNames: ReadonlyMap<string, string>,
    /** The current rate from the rate history (currentLoanRate); the stored rate when omitted. */
    currentRate?: number
): OverdraftRowModel {
    return {
        limit: position ? position.limit : null,
        used: position ? position.used : null,
        available: position ? position.available : null,
        interestRate: currentRate ?? loan.interestRate,
        linkedAccounts: (loan.linkedAccountIds ?? []).map(
            id => accountNames.get(id) ?? id
        ),
        loanStatus: loan.status,
        usageStatusLabel: position
            ? OVERDRAFT_USAGE_STATUS_LABELS[position.status]
            : null,
        usageWarning:
            position !== null &&
            (position.status === "NEEDS_REVIEW" ||
                position.status === "OVER_LIMIT" ||
                position.status === "OVER_DRAWING_POWER"),
        reviewReasons: position ? position.reviewReasons : [],
    };
}

/**
 * The loan an open dialog shows, after the list reloads: the reloaded copy
 * of the same loan (its rate, schedule figures and terms as saved), so a
 * dialog kept open after a save - e.g. a second rate change in the loan's
 * details - never works from the object it was opened with. Nothing open:
 * stays closed; a loan no longer listed keeps the object it had.
 */
export function refreshedSelection<T extends { id: string }>(selected: T | null, reloaded: readonly T[]): T | null {
    if (selected === null) return null;
    return reloaded.find(loan => loan.id === selected.id) ?? selected;
}
