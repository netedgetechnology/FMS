// ---------------------------------------------------------------------
// Which transaction can be which kind of Overdraft movement - the same
// rules as OVERDRAFT_POSITIONS_SQL, used BEFORE a link is made (manual
// Link to Loan, or an automatic import match) so a link that would not
// count is refused up front instead of only showing up later as Needs
// Review. The transaction is on one of the OD's linked bank accounts:
//
//   money IN  to the bank account (income / transfer IN)  -> Drawdown
//   money OUT of the bank account (expense / transfer OUT) -> Repayment,
//                                                            or Interest / Charge
// ---------------------------------------------------------------------

import { LoanStatus } from "../types/LoanStatus";
import { OverdraftEntryKind, isOverdraft, overdraftAccountIds, type Loan } from "../types";

export interface OverdraftTransactionFacts {
    accountId: string;
    type: string;
    transferDirection?: string | null;
    amount: number;
    transactionDate: string;
}

export function isMoneyIn(transaction: Pick<OverdraftTransactionFacts, "type" | "transferDirection">): boolean {
    return (
        transaction.type === "income" ||
        (transaction.type === "transfer" && transaction.transferDirection === "IN")
    );
}

export function isMoneyOut(transaction: Pick<OverdraftTransactionFacts, "type" | "transferDirection">): boolean {
    return (
        transaction.type === "expense" ||
        (transaction.type === "transfer" && transaction.transferDirection === "OUT")
    );
}

/** The kinds this transaction's direction allows - [] when it has none. */
export function overdraftKindsFor(
    transaction: Pick<OverdraftTransactionFacts, "type" | "transferDirection">
): OverdraftEntryKind[] {
    if (isMoneyIn(transaction)) {
        return [OverdraftEntryKind.DRAWDOWN];
    }

    if (isMoneyOut(transaction)) {
        return [OverdraftEntryKind.REPAYMENT, OverdraftEntryKind.INTEREST_CHARGE];
    }

    return [];
}

export function kindFitsDirection(
    kind: OverdraftEntryKind,
    transaction: Pick<OverdraftTransactionFacts, "type" | "transferDirection">
): boolean {
    return overdraftKindsFor(transaction).includes(kind);
}

/**
 * Why this transaction cannot be linked to this overdraft at all, or
 * null. (Already being linked elsewhere is checked by the caller.)
 */
export function overdraftLinkRefusal(
    transaction: OverdraftTransactionFacts,
    loan: Loan
): string | null {
    if (!isOverdraft(loan)) {
        return `${loan.name} is not an overdraft.`;
    }

    if (loan.status === LoanStatus.CLOSED) {
        return `${loan.name} is closed.`;
    }

    if (!overdraftAccountIds(loan).includes(transaction.accountId)) {
        return `This transaction is not on any of ${loan.name}'s linked bank accounts.`;
    }

    if (!(transaction.amount > 0)) {
        return "Only a transaction with an amount above zero can be linked.";
    }

    if (overdraftKindsFor(transaction).length === 0) {
        return "This transaction has no money-in or money-out direction, so it can't be an overdraft movement.";
    }

    const asOf = (loan.openingUsedAsOf ?? "").slice(0, 10);

    if (asOf && transaction.transactionDate.slice(0, 10) <= asOf) {
        // Only the user decides the opening date: it is never moved for them.
        return `This transaction is dated ${transaction.transactionDate.slice(0, 10)}, on or before ${asOf} - ${loan.name}'s Opening Used As Of date - so it is treated as already part of the opening used amount and can't count towards Used.${
            loan.startDate && loan.startDate.slice(0, 10) < asOf
                ? ` The overdraft started on ${loan.startDate.slice(0, 10)}. If the opening used amount is really as of an earlier date, change Opening Used As Of in Edit Loan first.`
                : ""
        }`;
    }

    return null;
}
