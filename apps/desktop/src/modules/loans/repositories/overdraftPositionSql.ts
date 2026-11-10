// ---------------------------------------------------------------------
// THE overdraft calculation - the one place an OD's used amount is
// defined. Every screen reads it through this SQL (LoanRepository for
// Loans, Dashboard net worth, Goals and Plans; AccountRepository for the
// Accounts list), so no two screens can disagree.
//
//   Used = Opening Used
//        + live Drawdowns   after the Opening Used As Of date
//        - live Repayments  after the Opening Used As Of date
//
// Nothing is cached or stored: amounts, dates, direction and account are
// read from the transactions themselves at query time. Editing a linked
// transaction, deleting it (deleted_at) or restoring it is therefore
// reflected immediately, with no recalculation step to forget.
//
// A link COUNTS only while its transaction
//   - exists and is not deleted,
//   - is on one of the OD's linked bank accounts (overdraft_accounts -
//     an OD can have several; all of them feed ONE position, and each
//     transaction is still counted once: it has at most one link),
//   - is dated after opening_used_as_of (earlier movements are already
//     in opening_used),
//   - has a positive amount, and
//   - moves money the way its kind says: a DRAWDOWN is money IN to the
//     bank account (income, or a transfer IN); a REPAYMENT or an
//     INTEREST_CHARGE is money OUT (expense, or a transfer OUT).
// A live transaction that no longer satisfies all of this (its amount,
// direction, account or date was edited) is NEVER silently counted: it is
// left out and reported as an invalid link (Needs Review). A deleted
// transaction is simply left out - deleting it is a legitimate change.
//
// INTEREST_CHARGE is totalled separately and never moves Used: FinWea does
// not assume how a lender treats interest (see overdraftPosition.ts).
// ---------------------------------------------------------------------

const CREDIT = (t: string) =>
    `(${t}.type = 'income' OR (${t}.type = 'transfer' AND ${t}.transfer_direction = 'IN'))`;

const DEBIT = (t: string) =>
    `(${t}.type = 'expense' OR (${t}.type = 'transfer' AND ${t}.transfer_direction = 'OUT'))`;

/**
 * One row per OVERDRAFT loan (deleted loans included - callers join on
 * their own loan row): loan_id, od_used, od_total_drawdowns,
 * od_total_repayments, od_total_interest_charges, od_invalid_links.
 * Use as a derived table: `LEFT JOIN (${OVERDRAFT_POSITIONS_SQL}) AS od
 * ON od.loan_id = loans.id`.
 */
export const OVERDRAFT_POSITIONS_SQL = `
    SELECT
        od_loan.id AS loan_id,
        ROUND(
            COALESCE(od_loan.opening_used, 0)
            + COALESCE(SUM(CASE WHEN od_link.link_state = 'COUNTS' AND od_link.entry_kind = 'DRAWDOWN' THEN od_link.amount END), 0)
            - COALESCE(SUM(CASE WHEN od_link.link_state = 'COUNTS' AND od_link.entry_kind = 'REPAYMENT' THEN od_link.amount END), 0),
            2
        ) AS od_used,
        ROUND(COALESCE(SUM(CASE WHEN od_link.link_state = 'COUNTS' AND od_link.entry_kind = 'DRAWDOWN' THEN od_link.amount END), 0), 2) AS od_total_drawdowns,
        ROUND(COALESCE(SUM(CASE WHEN od_link.link_state = 'COUNTS' AND od_link.entry_kind = 'REPAYMENT' THEN od_link.amount END), 0), 2) AS od_total_repayments,
        ROUND(COALESCE(SUM(CASE WHEN od_link.link_state = 'COUNTS' AND od_link.entry_kind = 'INTEREST_CHARGE' THEN od_link.amount END), 0), 2) AS od_total_interest_charges,
        COALESCE(SUM(CASE WHEN od_link.link_state = 'INVALID' THEN 1 ELSE 0 END), 0) AS od_invalid_links
    FROM loans AS od_loan
    LEFT JOIN (
        SELECT
            link.loan_id,
            link.entry_kind,
            txn.amount,
            CASE
                WHEN txn.id IS NULL OR txn.deleted_at IS NOT NULL THEN 'GONE'
                WHEN EXISTS (
                        SELECT 1 FROM overdraft_accounts AS od_account
                        WHERE od_account.loan_id = link.loan_id
                          AND od_account.account_id = txn.account_id
                    )
                    AND txn.amount > 0
                    AND substr(txn.transaction_date, 1, 10) > substr(COALESCE(link_loan.opening_used_as_of, ''), 1, 10)
                    AND (
                        (link.entry_kind = 'DRAWDOWN' AND ${CREDIT("txn")})
                        OR (link.entry_kind IN ('REPAYMENT', 'INTEREST_CHARGE') AND ${DEBIT("txn")})
                    )
                THEN 'COUNTS'
                ELSE 'INVALID'
            END AS link_state
        FROM overdraft_transaction_links AS link
        JOIN loans AS link_loan
            ON link_loan.id = link.loan_id
        LEFT JOIN transactions AS txn
            ON txn.id = link.transaction_id
    ) AS od_link
        ON od_link.loan_id = od_loan.id
    WHERE od_loan.loan_kind = 'OVERDRAFT'
    GROUP BY od_loan.id
`;

/**
 * The loan's outstanding principal as every liability consumer sees it:
 * an OD's used amount (never below 0 - a credit balance with the lender
 * is a Needs Review case, not an asset), the stored balance for a Term
 * Loan (unchanged).
 */
export function outstandingPrincipalSql(loan: string, od: string): string {
    return `CASE WHEN ${loan}.loan_kind = 'OVERDRAFT' THEN MAX(0, COALESCE(${od}.od_used, COALESCE(${loan}.opening_used, 0))) ELSE ${loan}.outstanding_principal END`;
}

/** An OD carries no separately tracked outstanding interest. */
export function outstandingInterestSql(loan: string): string {
    return `CASE WHEN ${loan}.loan_kind = 'OVERDRAFT' THEN 0 ELSE ${loan}.outstanding_interest END`;
}
