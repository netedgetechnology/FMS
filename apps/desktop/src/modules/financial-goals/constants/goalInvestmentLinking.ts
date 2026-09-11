/**
 * Only an ACTIVE investment may back an INVESTMENT_LINKED goal -
 * CLOSED and ON_HOLD investments are excluded (unavailable, with a
 * warning), mirroring how an inactive loan is treated in Phase 4.
 */
export function isGoalEligibleInvestmentStatus(
    status: string
): boolean {
    return status === "ACTIVE";
}
