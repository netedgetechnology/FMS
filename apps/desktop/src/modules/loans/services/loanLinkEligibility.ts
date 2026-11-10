// ---------------------------------------------------------------------
// Which transactions may be linked to a loan at all - THE one rule, used
// by the Transactions Landmark icon, Link to Loan (Term Loan EMI and
// Overdraft), and automatic import matching.
//
// A transaction is eligible ONLY when its category is one of the loan
// loan categories below. Being on a bank account a Term Loan or an
// Overdraft uses is NOT enough: the account only decides WHICH loans may
// be considered once the category has passed. Changing a category only
// changes eligibility - it never creates or removes a link; an existing
// link stays until the user unlinks it.
//
// Categories have no stable key (they are user-managed rows: id, name,
// type, scope), so they are recognised by their name, normalised -
// case and spacing never matter. These names live only here.
// ---------------------------------------------------------------------

import { CategoryRepository } from "@/modules/categories/repositories/CategoryRepository";

const LOAN_LINK_CATEGORY_NAMES: readonly string[] = [
    "Loan Installment",
    "Loan Interest",
    // The same category under the name it was later given (2026-10-11).
    "Loan Interest Charge",
    "Loan Interest Recovered",
    "Loan Principal Repayment",
    "Loan Principal Drawdown",
];

function normalizeCategoryName(name: string | null | undefined): string {
    return (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

const ELIGIBLE = new Set(LOAN_LINK_CATEGORY_NAMES.map(normalizeCategoryName));

/** Whether a category with this name makes a transaction loan-link eligible. */
export function isLoanLinkCategoryName(name: string | null | undefined): boolean {
    return ELIGIBLE.has(normalizeCategoryName(name));
}

/** The ids, among these categories, of the loan-link categories. */
export function loanLinkCategoryIds(
    categories: Iterable<{ id: string; name: string }>
): Set<string> {
    const ids = new Set<string>();

    for (const category of categories) {
        if (isLoanLinkCategoryName(category.name)) {
            ids.add(category.id);
        }
    }

    return ids;
}

/** Whether this transaction's category is one of the loan-link categories. */
export function isLoanLinkEligible(
    transaction: { categoryId?: string | null },
    loanCategoryIds: ReadonlySet<string>
): boolean {
    return !!transaction.categoryId && loanCategoryIds.has(transaction.categoryId);
}

/** The user's message when a transaction's category is not a loan category. */
export const NOT_LOAN_CATEGORY_REASON = `Only a transaction in a loan category (${LOAN_LINK_CATEGORY_NAMES.join(", ").replace(/, ([^,]*)$/, " or $1")}) can be linked to a loan. Change its category first if it is a loan payment.`;

/** The loan-link category ids of the user's current categories. */
export async function loadLoanLinkCategoryIds(
    repository: Pick<CategoryRepository, "getAll"> = new CategoryRepository()
): Promise<Set<string>> {
    return loanLinkCategoryIds(await repository.getAll());
}
