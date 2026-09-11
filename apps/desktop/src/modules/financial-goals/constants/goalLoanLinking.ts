/**
 * Only an ACTIVE loan may back a LOAN_PAYOFF_LINKED goal - CLOSED,
 * ON_HOLD and DEFAULTED loans are excluded (unavailable, with a
 * warning), mirroring how an inactive account is treated in Phase 1/2.
 */
export function isGoalEligibleLoanStatus(
    status: string
): boolean {
    return status === "ACTIVE";
}
