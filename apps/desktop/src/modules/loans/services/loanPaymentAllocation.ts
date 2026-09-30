// ---------------------------------------------------------------------
// Loans - Phase 4 (payment flexibility)
//
// Standard loan-servicing convention: interest is allocated before
// principal on any EMI payment, whether it covers the whole scheduled
// instalment (the only case before this phase) or only part of it (a
// partial payment, this phase). The interest portion of any amount
// paid against a schedule row is that amount, capped at the row's own
// scheduled interestAmount; whatever remains (if anything) reduces
// principal, capped at the row's scheduled principalAmount.
//
// This single pair of functions is reused everywhere a schedule row's
// "how much of this was actually interest vs. principal" needs
// answering:
//   - LoanPaymentService.processPayment, to split a *new* payment
//     amount before updating the loan's outstanding balances (pass the
//     amount being paid as `paidAmount`).
//   - EMIScheduleService.getInterestByTransactionId, to report the
//     *actual* interest recognized by Budgets/Dashboard for an
//     already-recorded payment (pass the schedule row's own stored
//     paidAmount).
//   - LoanDashboardService.getSummary, to compute the *remaining*
//     interest still owed on a partially-paid row.
//
// For a full payment (paidAmount === totalAmount, the only case that
// existed before this phase) this always resolves to exactly
// interestAmount / principalAmount - unchanged from before.
// ---------------------------------------------------------------------

export interface AllocatableSchedule {
    principalAmount: number;
    interestAmount: number;
}

function safeNonNegative(value: unknown): number {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

/**
 * The interest portion of `paidAmount` allocated against this
 * schedule row's scheduled interestAmount. Never exceeds
 * interestAmount, never negative, never NaN/Infinity.
 */
export function paidInterestPortion(
    schedule: AllocatableSchedule,
    paidAmount: number | null | undefined
): number {
    const interestAmount = safeNonNegative(
        schedule.interestAmount
    );
    const amount = safeNonNegative(paidAmount);

    return Math.min(amount, interestAmount);
}

/**
 * The principal portion of `paidAmount` allocated against this
 * schedule row - whatever remains once interest is fully covered,
 * capped at the row's scheduled principalAmount. Never negative, never
 * NaN/Infinity.
 */
export function paidPrincipalPortion(
    schedule: AllocatableSchedule,
    paidAmount: number | null | undefined
): number {
    const principalAmount = safeNonNegative(
        schedule.principalAmount
    );
    const amount = safeNonNegative(paidAmount);
    const interestAmount = safeNonNegative(
        schedule.interestAmount
    );

    return Math.min(
        Math.max(0, amount - interestAmount),
        principalAmount
    );
}
