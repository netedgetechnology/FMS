import { Account } from "../types";
import { AccountType } from "../types/AccountType";

/**
 * True for a LOAN-type mirror account that Delete Loan preserved
 * because it still had a live transaction on it (LoanService.delete()
 * only ever deletes the loan record itself in that case, never the
 * account - see that method's own doc comment). The account keeps
 * account_type = 'LOAN' forever; this is how the Accounts UI tells
 * that case apart from an ordinary, still-linked loan account, so it
 * can show a clear label instead of silently leaving a LOAN-type
 * account with no loan behind it.
 *
 * `linkedAccountIds` is whatever the caller already has on hand that
 * answers "does a live loan link this account" - AccountsPage builds
 * its loanByAccountId Map for the View/Edit/Delete redirect already,
 * and a Map's .has() works the same as a Set's for this check.
 */
export function isUnlinkedLoanAccount(
    account: Pick<Account, "id" | "type">,
    linkedAccountIds: { has(accountId: string): boolean }
): boolean {
    return (
        account.type === AccountType.LOAN &&
        !linkedAccountIds.has(account.id)
    );
}
