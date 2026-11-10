/**
 * What a loan IS - the Loan Type that decides how it works (migration
 * 047). Not to be confused with Loan.loanType, the user's own free-text
 * description (e.g. "Home Loan"), which drives no behaviour.
 *
 *   TERM_LOAN - fixed EMI schedule, EMI payments, EMI import matching.
 *   OVERDRAFT - a revolving limit: no schedule; drawdowns raise the used
 *               amount and repayments lower it.
 */
export enum LoanKind {
    TERM_LOAN = "TERM_LOAN",
    OVERDRAFT = "OVERDRAFT",
}

export const LOAN_KIND_LABELS: Record<LoanKind, string> = {
    [LoanKind.TERM_LOAN]: "Term Loan",
    [LoanKind.OVERDRAFT]: "Overdraft (OD)",
};

/** Anything not explicitly an Overdraft is a Term Loan - every loan before migration 047. */
export function isOverdraft(loan: { loanKind?: string | null }): boolean {
    return loan.loanKind === LoanKind.OVERDRAFT;
}

/**
 * The bank accounts an Overdraft is linked to - the only accounts its
 * movements can be on. Empty for a Term Loan.
 */
export function overdraftAccountIds(loan: {
    loanKind?: string | null;
    linkedAccountIds?: string[] | null;
}): string[] {
    return isOverdraft(loan) ? [...(loan.linkedAccountIds ?? [])] : [];
}

/**
 * What an OD-linked transaction is. Only DRAWDOWN and REPAYMENT move the
 * used amount; INTEREST_CHARGE is kept separately and never counted as
 * principal used.
 */
export enum OverdraftEntryKind {
    DRAWDOWN = "DRAWDOWN",
    REPAYMENT = "REPAYMENT",
    INTEREST_CHARGE = "INTEREST_CHARGE",
}

export const OVERDRAFT_ENTRY_KIND_LABELS: Record<OverdraftEntryKind, string> = {
    [OverdraftEntryKind.DRAWDOWN]: "Drawdown",
    [OverdraftEntryKind.REPAYMENT]: "Repayment",
    [OverdraftEntryKind.INTEREST_CHARGE]: "Interest / Charge",
};

/** MANUAL - linked by the user; IMPORT - matched automatically on a pattern a MANUAL link taught. */
export type OverdraftLinkSource = "MANUAL" | "IMPORT";

/** One overdraft_transaction_links row. */
export interface OverdraftTransactionLink {
    id: string;
    loanId: string;
    transactionId: string;
    entryKind: OverdraftEntryKind;
    linkSource: OverdraftLinkSource;
    createdAt: string;
}
