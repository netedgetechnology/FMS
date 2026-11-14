import { describe, expect, it } from "vitest";

import { EMIScheduleGenerator } from "../services/EMIScheduleGenerator";
import { LoanPaymentStatus, type LoanPaymentSchedule } from "../types";
import { proposeRateChange, type RateChangeProposal, type RateChangeRequest } from "./rateChangeProposal";

// ---------------------------------------------------------------------
// Pre-activation audit (docs/loans/interest-rate-history-pre-activation-
// audit.md), finding B1 - FIXED. Synthetic loan only.
//
// After a Keep Tenure change late in a loan, the paid instalments at the
// OLD EMI outnumber the future ones at the NEW EMI. "Keep the EMI" must
// keep the EMI the borrower now pays (the one in force at the
// recalculation point). The engine used to take the most common EMI
// across ALL instalments, paid ones included, and proposed the old EMI.
// ---------------------------------------------------------------------

const loan: RateChangeRequest["loan"] = {
    principalAmount: 240_000,
    startDate: "2025-01-10",
    interestRate: 10,
    interestType: "REDUCING",
    interestCalculationMethod: "MONTHLY_RATE",
    scheduleSource: "GENERATED",
    paymentDay: 10,
    firstInstallmentAmount: null,
    balloonAmount: null,
};

const PAID = 16;
const base: LoanPaymentSchedule[] = new EMIScheduleGenerator()
    .generate({ loanId: "loan-syn", principalAmount: 240_000, interestRate: 10, interestType: "REDUCING", tenureMonths: 24, startDate: "2025-01-10", firstEmiDate: "2025-02-10" })
    .map((row, index) => ({
        ...row,
        id: `s${row.installmentNumber}`,
        ...(index < PAID ? { status: LoanPaymentStatus.PAID, paidDate: row.dueDate, paidAmount: row.totalAmount, transactionId: `txn-${index + 1}` } : {}),
    }));
const linked = base.slice(0, PAID).map(row => row.id!);
const OLD_EMI = base[0]!.totalAmount;

/** The schedule as saved after a proposal: protected/unchanged rows kept, the proposed rows in place of the rest. */
function applied(schedule: readonly LoanPaymentSchedule[], proposal: RateChangeProposal): LoanPaymentSchedule[] {
    const kept = schedule.filter(row => row.installmentNumber < proposal.recalculatedFromInstalment);
    return [
        ...kept,
        ...proposal.proposedInstalments.map(
            row =>
                ({
                    ...(schedule[row.installmentNumber - 1] ?? base[0]!),
                    id: `s${row.installmentNumber}`,
                    installmentNumber: row.installmentNumber,
                    dueDate: row.dueDate,
                    openingPrincipal: row.openingPrincipal,
                    principalAmount: row.principalAmount,
                    interestAmount: row.interestAmount,
                    totalAmount: row.totalAmount,
                    outstandingPrincipal: row.outstandingPrincipal,
                    status: LoanPaymentStatus.UPCOMING,
                    paidDate: null,
                    paidAmount: null,
                    transactionId: null,
                }) as LoanPaymentSchedule
        ),
    ];
}

function propose(schedule: LoanPaymentSchedule[], history: { effectiveFrom: string; rate: number }[], change: { effectiveFrom: string; rate: number }, option: "PRESERVE_EMI" | "PRESERVE_TENURE", paidLinks = linked) {
    const result = proposeRateChange({ loan, schedule, linkedScheduleIds: paidLinks, history, change, replaces: null, option });
    if (result.status !== "PROPOSED") throw new Error(result.errors.join(" | "));
    return result;
}

const H0 = [{ effectiveFrom: "2025-01-10", rate: 10 }];
const H1 = [...H0, { effectiveFrom: "2026-05-10", rate: 14 }];

function afterKeepTenure() {
    const first = propose(base, H0, { effectiveFrom: "2026-05-10", rate: 14 }, "PRESERVE_TENURE");
    return { first, schedule: applied(base, first), newEmi: first.proposedEmis[0]! };
}

/** What the review shows must be what the schedule it saves contains. */
function expectReviewMatchesSchedule(proposal: RateChangeProposal, saved: readonly LoanPaymentSchedule[]) {
    const future = saved.filter(row => row.installmentNumber >= proposal.recalculatedFromInstalment);
    expect(future).toHaveLength(proposal.proposedRemainingInstalments);
    expect(saved).toHaveLength(proposal.recalculatedFromInstalment - 1 + proposal.proposedRemainingInstalments);
    // Every regular instalment pays the proposed EMI; the last carries the final adjustment.
    for (const row of future.slice(0, -1)) expect(proposal.proposedEmis).toContain(row.totalAmount);
    expect(future[future.length - 1]!.totalAmount).toBe(proposal.finalAdjustment.finalTotal);
    expect(future[future.length - 1]!.outstandingPrincipal).toBe(0);
    // Principal repaid in the future rows equals what was outstanding at the start.
    const repaid = Math.round(future.reduce((sum, row) => sum + row.principalAmount, 0) * 100) / 100;
    expect(repaid).toBe(proposal.startingPrincipal);
}

describe("pre-activation audit B1: Keep EMI after an earlier Keep Tenure change", () => {
    it("setup: the Keep Tenure change really moved the EMI for the remaining instalments", () => {
        const { newEmi, first, schedule } = afterKeepTenure();
        expect(OLD_EMI).toBe(11_074.78);
        expect(newEmi).toBe(11_238.55);
        expect(first.proposedRemainingInstalments).toBe(first.currentRemainingInstalments);
        expectReviewMatchesSchedule(first, schedule);
    });

    it("Keep the EMI keeps the EMI in force at the recalculation point (11,238.55), not the paid instalments' old EMI", () => {
        const { schedule, newEmi } = afterKeepTenure();
        const second = propose(schedule, H1, { effectiveFrom: "2026-09-10", rate: 15 }, "PRESERVE_EMI");

        expect(second.currentEmi).toBe(newEmi);
        expect(second.proposedEmis).toEqual([newEmi]);
        expect(second.currentEmi).not.toBe(OLD_EMI);
    });

    it("Keep the EMI after Keep Tenure: a higher rate lengthens the tenure, and the review matches the saved schedule", () => {
        const { schedule, newEmi } = afterKeepTenure();
        const second = propose(schedule, H1, { effectiveFrom: "2026-09-10", rate: 15 }, "PRESERVE_EMI");
        const saved = applied(schedule, second);

        expect(second.proposedRemainingInstalments).toBeGreaterThanOrEqual(second.currentRemainingInstalments);
        expect(saved.filter(row => row.installmentNumber >= second.recalculatedFromInstalment).slice(0, -1).every(row => row.totalAmount === newEmi)).toBe(true);
        expectReviewMatchesSchedule(second, saved);
        // Paid instalments are untouched.
        expect(saved.slice(0, PAID)).toEqual(schedule.slice(0, PAID));
    });

    it("Keep the EMI after Keep Tenure: a lower rate shortens the tenure at the CURRENT EMI", () => {
        const { schedule, newEmi } = afterKeepTenure();
        const second = propose(schedule, H1, { effectiveFrom: "2026-09-10", rate: 6 }, "PRESERVE_EMI");
        const saved = applied(schedule, second);

        expect(second.currentEmi).toBe(newEmi);
        expect(second.proposedRemainingInstalments).toBeLessThanOrEqual(second.currentRemainingInstalments);
        expectReviewMatchesSchedule(second, saved);
    });

    it("three consecutive changes (Keep Tenure, Keep EMI, Keep Tenure) each start from the schedule the previous one saved", () => {
        const { schedule: s1 } = afterKeepTenure();
        const second = propose(s1, H1, { effectiveFrom: "2026-09-10", rate: 15 }, "PRESERVE_EMI");
        const s2 = applied(s1, second);
        const third = propose(s2, [...H1, { effectiveFrom: "2026-09-10", rate: 15 }], { effectiveFrom: "2026-10-10", rate: 12 }, "PRESERVE_TENURE");
        const s3 = applied(s2, third);

        expect(third.currentEmi).toBe(second.proposedEmis[0]);
        expect(third.proposedRemainingInstalments).toBe(third.currentRemainingInstalments);
        expectReviewMatchesSchedule(third, s3);
    });

    it("the paid instalments are never part of the proposal, whatever their EMI", () => {
        const { schedule } = afterKeepTenure();
        const second = propose(schedule, H1, { effectiveFrom: "2026-09-10", rate: 15 }, "PRESERVE_EMI");
        expect(second.recalculatedFromInstalment).toBeGreaterThan(PAID);
        expect(second.protectedInstalments).toHaveLength(PAID);
        expect(second.proposedInstalments.every(row => row.installmentNumber > PAID)).toBe(true);
    });

    it("a settled-before-FinWea or linked-only history protects the same instalments", () => {
        const settled = afterKeepTenure().schedule.map((row, index) =>
            index < PAID ? ({ ...row, status: LoanPaymentStatus.UPCOMING, paidDate: null, paidAmount: null, transactionId: null, settledBeforeFinwea: true } as LoanPaymentSchedule) : row
        );
        const second = propose(settled, H1, { effectiveFrom: "2026-09-10", rate: 15 }, "PRESERVE_EMI", []);
        expect(second.protectedInstalments).toHaveLength(PAID);
        expect(second.currentEmi).toBe(11_238.55);
    });

    it("a partly paid instalment still refuses the recalculation", () => {
        const { schedule } = afterKeepTenure();
        const partly = schedule.map(row => (row.installmentNumber === PAID + 1 ? ({ ...row, status: LoanPaymentStatus.PARTIAL, paidAmount: 100 } as LoanPaymentSchedule) : row));
        const result = proposeRateChange({ loan, schedule: partly, linkedScheduleIds: linked, history: H1, change: { effectiveFrom: "2026-09-10", rate: 15 }, replaces: null, option: "PRESERVE_EMI" });
        expect(result.status).toBe("REJECTED");
    });

    it("with only the final instalment left, Keep the EMI uses the regular EMI before it, not the final adjustment", () => {
        const { schedule, newEmi } = afterKeepTenure();
        const allButLast = schedule.map((row, index) =>
            index < schedule.length - 1 ? ({ ...row, status: LoanPaymentStatus.PAID, paidDate: row.dueDate, paidAmount: row.totalAmount, transactionId: `txn-${index + 1}` } as LoanPaymentSchedule) : row
        );
        const result = propose(allButLast, H1, { effectiveFrom: "2026-12-11", rate: 15 }, "PRESERVE_EMI", allButLast.slice(0, -1).map(row => row.id!));
        expect(result.currentEmi).toBe(newEmi);
        expect(result.recalculatedFromInstalment).toBe(schedule.length);
    });

    it("an untouched loan (no earlier change) keeps the EMI exactly as before the fix", () => {
        const result = propose(base, H0, { effectiveFrom: "2026-05-10", rate: 14 }, "PRESERVE_EMI");
        expect(result.currentEmi).toBe(OLD_EMI);
        expect(result.proposedEmis).toEqual([OLD_EMI]);
        expectReviewMatchesSchedule(result, applied(base, result));
    });
});
