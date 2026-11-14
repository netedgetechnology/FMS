import { describe, expect, it } from "vitest";

import { EMIScheduleGenerator, type GenerateEMIScheduleRequest } from "../services/EMIScheduleGenerator";
import { LoanPaymentStatus, type LoanPaymentSchedule } from "../types";
import {
    annuityEmi,
    periodInterest,
    periodSegments,
    projectSchedule,
    proposeRateChange,
    roundPaise,
    type RateChangeLoanTerms,
    type RateChangeProposal,
    type RateChangeRequest,
    type RateChangeResult,
} from "./rateChangeProposal";

// ---------------------------------------------------------------------
// Synthetic loan: 1,20,000 at 12% a year, 12 monthly instalments due on
// the 10th from 10/02/2026, disbursed 10/01/2026. Built by the real
// EMIScheduleGenerator, so "current schedule" means exactly what FinWea
// stores today.
// ---------------------------------------------------------------------

const BASE: GenerateEMIScheduleRequest = {
    loanId: "loan-syn",
    principalAmount: 120_000,
    interestRate: 12,
    interestType: "REDUCING",
    tenureMonths: 12,
    startDate: "2026-01-10",
    firstEmiDate: "2026-02-10",
};

function generated(change: Partial<GenerateEMIScheduleRequest> = {}): LoanPaymentSchedule[] {
    // Stable ids so results can be compared across runs.
    return new EMIScheduleGenerator().generate({ ...BASE, ...change }).map(row => ({ ...row, id: `s${row.installmentNumber}` }));
}

const terms = (change: Partial<RateChangeLoanTerms> = {}): RateChangeLoanTerms => ({
    principalAmount: 120_000,
    startDate: "2026-01-10",
    interestRate: 12,
    interestType: "REDUCING",
    interestCalculationMethod: "MONTHLY_RATE",
    scheduleSource: "GENERATED",
    ...change,
});

const paid = (row: LoanPaymentSchedule): LoanPaymentSchedule => ({ ...row, status: LoanPaymentStatus.PAID, paidDate: row.dueDate, paidAmount: row.totalAmount });

/** The first `count` instalments paid. */
function withPaid(schedule: LoanPaymentSchedule[], count: number): LoanPaymentSchedule[] {
    return schedule.map((row, index) => (index < count ? paid(row) : row));
}

function request(change: Partial<RateChangeRequest> = {}): RateChangeRequest {
    return {
        loan: terms(),
        schedule: withPaid(generated(), 3),
        history: [],
        change: { effectiveFrom: "2026-05-20", rate: 13 },
        option: "PRESERVE_TENURE",
        ...change,
    };
}

function proposed(result: RateChangeResult): RateChangeProposal {
    if (result.status !== "PROPOSED") throw new Error(`Rejected: ${result.errors.join(" | ")}`);
    return result;
}

function rejected(result: RateChangeResult): string {
    expect(result.status).toBe("REJECTED");
    return result.status === "REJECTED" ? result.errors.join(" | ") : "";
}

const shape = (rows: ReadonlyArray<Pick<LoanPaymentSchedule, "installmentNumber" | "dueDate" | "principalAmount" | "interestAmount" | "totalAmount" | "outstandingPrincipal">>) =>
    rows.map(r => [r.installmentNumber, r.dueDate, r.principalAmount, r.interestAmount, r.totalAmount, r.outstandingPrincipal]);

/** The schedule always ends at exactly 0.00 and repays exactly the starting principal. */
function expectBalanced(result: RateChangeProposal) {
    const rows = result.proposedInstalments;
    expect(rows[rows.length - 1]!.outstandingPrincipal).toBe(0);
    expect(roundPaise(rows.reduce((sum, r) => sum + r.principalAmount, 0))).toBe(result.startingPrincipal);
    rows.forEach((row, index) => {
        expect(roundPaise(row.principalAmount + row.interestAmount)).toBe(row.totalAmount);
        expect(row.openingPrincipal).toBe(index === 0 ? result.startingPrincipal : rows[index - 1]!.outstandingPrincipal);
        expect(row.outstandingPrincipal).toBe(roundPaise(row.openingPrincipal - row.principalAmount));
    });
}

// =====================================================================
describe("regression: with no rate change the engine is the existing generator", () => {
    const cases: Array<[string, Partial<GenerateEMIScheduleRequest>]> = [
        ["monthly rate, first EMI date", {}],
        ["actual days / 365, first EMI date", { interestCalculationMethod: "ACTUAL_365" }],
        ["monthly rate, legacy dates (n months after the start)", { firstEmiDate: null }],
        ["actual days / 365, 31st-of-month payment day", { interestCalculationMethod: "ACTUAL_365", startDate: "2026-01-31", firstEmiDate: "2026-02-28", paymentDay: 31 }],
        ["zero rate", { interestRate: 0 }],
        ["long tenure", { tenureMonths: 180, principalAmount: 750_000, interestRate: 10.5 }],
    ];

    for (const [label, change] of cases) {
        it(label, () => {
            const request = { ...BASE, ...change };
            const current = generated(change);
            const projected = projectSchedule({
                timeline: [{ effectiveFrom: request.startDate, rate: request.interestRate }],
                method: request.interestCalculationMethod === "ACTUAL_365" ? "ACTUAL_365" : "MONTHLY_RATE",
                option: "PRESERVE_TENURE",
                startingPrincipal: request.principalAmount,
                firstInstallmentNumber: 1,
                firstPeriodStart: request.startDate,
                existingDueDates: current.map(row => row.dueDate),
                paymentDay: 1,
            });

            expect(shape(projected)).toEqual(shape(current));
        });
    }

    it("one-rate interest is exactly the generator's expression for both methods", () => {
        const one = [{ from: "2026-03-10", to: "2026-04-10", days: 31, rate: 12 }];
        expect(periodInterest(90_000, one, "MONTHLY_RATE")).toBe(roundPaise(90_000 * (12 / 12 / 100)));
        expect(periodInterest(90_000, one, "ACTUAL_365")).toBe(roundPaise(90_000 * (12 / 100) * 31 / 365));
    });

    it("the annuity EMI is the generator's EMI", () => {
        expect(annuityEmi(120_000, 12, 12)).toBe(generated()[0]!.totalAmount);
        expect(annuityEmi(120_000, 0, 12)).toBe(10_000);
    });
});

// =====================================================================
describe("rate timeline and interest periods", () => {
    it("a period split by one change: actual days at each rate", () => {
        expect(periodSegments([{ effectiveFrom: "2026-01-10", rate: 12 }, { effectiveFrom: "2026-05-20", rate: 13 }], "2026-05-10", "2026-06-10")).toEqual([
            { from: "2026-05-10", to: "2026-05-20", days: 10, rate: 12 },
            { from: "2026-05-20", to: "2026-06-10", days: 21, rate: 13 },
        ]);
    });

    it("several changes in one period, each applied to its own days", () => {
        const timeline = [
            { effectiveFrom: "2026-01-10", rate: 12 },
            { effectiveFrom: "2026-05-15", rate: 12.5 },
            { effectiveFrom: "2026-05-25", rate: 13 },
        ];
        const segments = periodSegments(timeline, "2026-05-10", "2026-06-10");

        expect(segments.map(s => [s.rate, s.days])).toEqual([
            [12, 5],
            [12.5, 10],
            [13, 16],
        ]);
        // MONTHLY_RATE: each monthly rate weighted by its share of the 31 days.
        expect(periodInterest(100_000, segments, "MONTHLY_RATE")).toBe(roundPaise(100_000 * ((12 / 1200) * (5 / 31) + (12.5 / 1200) * (10 / 31) + (13 / 1200) * (16 / 31))));
        // ACTUAL_365: rate x days / 365, summed, rounded once.
        expect(periodInterest(100_000, segments, "ACTUAL_365")).toBe(roundPaise((100_000 * (0.12 * 5 + 0.125 * 10 + 0.13 * 16)) / 365));
    });

    it("a change on the period's start date covers the whole period; on its due date, none of it", () => {
        const timeline = (date: string) => [{ effectiveFrom: "2026-01-10", rate: 12 }, { effectiveFrom: date, rate: 13 }];
        expect(periodSegments(timeline("2026-05-10"), "2026-05-10", "2026-06-10")).toEqual([{ from: "2026-05-10", to: "2026-06-10", days: 31, rate: 13 }]);
        expect(periodSegments(timeline("2026-06-10"), "2026-05-10", "2026-06-10")).toEqual([{ from: "2026-05-10", to: "2026-06-10", days: 31, rate: 12 }]);
    });
});

// =====================================================================
describe("one rate change between instalment dates", () => {
    it("tenure-preserving: re-prices from the first instalment the rate reaches, with a new EMI", () => {
        const result = proposed(proposeRateChange(request()));
        const current = withPaid(generated(), 3);

        expect(result.change).toEqual({ effectiveFrom: "2026-05-20", oldRate: 12, newRate: 13 });
        expect(result.calculationMethod).toBe("MONTHLY_RATE");
        expect(result.option).toBe("PRESERVE_TENURE");
        // Instalments 1-3 paid; 4 (due 10/05) is wholly before the change.
        expect(result.protectedInstalments.map(p => p.row.installmentNumber)).toEqual([1, 2, 3]);
        expect(result.unchangedInstalments).toEqual([current[3]]);
        expect(result.recalculatedFromInstalment).toBe(5);
        expect(result.startingPrincipal).toBe(current[3]!.outstandingPrincipal);
        expect(result.currentFutureInstalments).toEqual(current.slice(4));

        const [fifth] = result.proposedInstalments;
        expect(fifth!.segments.map(s => [s.rate, s.days])).toEqual([
            [12, 10],
            [13, 21],
        ]);
        const B = result.startingPrincipal;
        expect(fifth!.interestAmount).toBe(roundPaise(B * ((12 / 1200) * (10 / 31) + (13 / 1200) * (21 / 31))));
        // A new EMI at 13% over the same 8 instalments left.
        expect(result.proposedEmis).toEqual([annuityEmi(B, 13, 8)]);
        expect(result.currentRemainingInstalments).toBe(8);
        expect(result.proposedRemainingInstalments).toBe(8);
        // Due dates unchanged.
        expect(result.proposedInstalments.map(r => r.dueDate)).toEqual(current.slice(4).map(r => r.dueDate));
        expect(result.totals.proposedInterest).toBeGreaterThan(result.totals.currentInterest);
        expectBalanced(result);
    });

    it("EMI-preserving, rate up: the same EMI, more instalments, a smaller last one", () => {
        const higher = proposed(proposeRateChange(request({ change: { effectiveFrom: "2026-05-20", rate: 24 }, option: "PRESERVE_EMI" })));

        expect(higher.proposedEmis).toEqual([higher.currentEmi]);
        expect(higher.proposedRemainingInstalments).toBeGreaterThan(higher.currentRemainingInstalments);
        const added = higher.proposedInstalments.filter(r => r.added);
        expect(added.length).toBe(higher.proposedRemainingInstalments - higher.currentRemainingInstalments);
        // Added instalments continue monthly on the same day.
        expect(added[0]!.dueDate).toBe("2027-02-10");
        expect(higher.warnings.join(" ")).toMatch(/adds \d+ instalment/);
        // Every instalment but the last is exactly the EMI.
        expect(higher.proposedInstalments.slice(0, -1).every(r => r.totalAmount === higher.currentEmi)).toBe(true);
        expect(higher.finalAdjustment).toMatchObject({ regularEmi: higher.currentEmi });
        expect(higher.finalAdjustment.difference).toBe(roundPaise(higher.finalAdjustment.finalTotal - higher.currentEmi));
        expect(higher.finalAdjustment.difference).toBeLessThanOrEqual(0);
        expectBalanced(higher);
    });

    it("EMI-preserving, rate down: the same EMI repays the loan sooner", () => {
        const lower = proposed(proposeRateChange(request({ change: { effectiveFrom: "2026-05-20", rate: 1 }, option: "PRESERVE_EMI" })));

        expect(lower.proposedRemainingInstalments).toBeLessThanOrEqual(lower.currentRemainingInstalments);
        expect(lower.proposedInstalments.every(r => !r.added)).toBe(true);
        expectBalanced(lower);
    });

    it("both methods: actual days / 365 splits the period too", () => {
        const loan = terms({ interestCalculationMethod: "ACTUAL_365" });
        const result = proposed(proposeRateChange(request({ loan, schedule: withPaid(generated({ interestCalculationMethod: "ACTUAL_365" }), 3) })));
        const B = result.startingPrincipal;

        expect(result.calculationMethod).toBe("ACTUAL_365");
        expect(result.proposedInstalments[0]!.interestAmount).toBe(roundPaise((B * (0.12 * 10 + 0.13 * 21)) / 365));
        // A later, whole period: 13% on its actual days.
        const second = result.proposedInstalments[1]!;
        expect(second.interestAmount).toBe(roundPaise(second.openingPrincipal * 0.13 * 30 / 365));
        expectBalanced(result);
    });
});

// =====================================================================
describe("changes on instalment dates", () => {
    it("on a due date: that instalment keeps the old rate, the next one is wholly at the new rate", () => {
        const result = proposed(proposeRateChange(request({ change: { effectiveFrom: "2026-06-10", rate: 13 } })));

        expect(result.recalculatedFromInstalment).toBe(6);
        expect(result.unchangedInstalments.map(r => r.installmentNumber)).toEqual([4, 5]);
        expect(result.proposedInstalments[0]!.segments).toEqual([{ from: "2026-06-10", to: "2026-07-10", days: 30, rate: 13 }]);
        expect(result.proposedInstalments[0]!.interestAmount).toBe(roundPaise(result.startingPrincipal * (13 / 12 / 100)));
        expectBalanced(result);
    });

    it("on the day after the last paid instalment: the first unpaid one is wholly at the new rate", () => {
        const result = proposed(proposeRateChange(request({ change: { effectiveFrom: "2026-04-10", rate: 13 } })));

        expect(result.recalculatedFromInstalment).toBe(4);
        expect(result.unchangedInstalments).toEqual([]);
        expect(result.proposedInstalments[0]!.segments.map(s => s.rate)).toEqual([13]);
    });
});

// =====================================================================
describe("initial rate and multiple changes", () => {
    it("an explicit initial rate in the history is the same as the loan's own rate", () => {
        const implicit = proposeRateChange(request());
        const explicit = proposeRateChange(request({ history: [{ effectiveFrom: "2026-01-10", rate: 12 }] }));

        expect(explicit).toEqual(implicit);
    });

    it("an earlier recorded change sets the old rate", () => {
        const result = proposed(proposeRateChange(request({ history: [{ effectiveFrom: "2026-01-10", rate: 12 }, { effectiveFrom: "2026-03-01", rate: 12.5 }] })));

        expect(result.change.oldRate).toBe(12.5);
        expect(result.proposedInstalments[0]!.segments.map(s => s.rate)).toEqual([12.5, 13]);
    });

    it("a later recorded change also applies, and the EMI is worked out again from it (tenure kept)", () => {
        const result = proposed(proposeRateChange(request({ history: [{ effectiveFrom: "2026-01-10", rate: 12 }, { effectiveFrom: "2026-09-10", rate: 14 }] })));

        expect(result.warnings.join(" ")).toMatch(/Later recorded rate change\(s\) also apply: 14% from 10\/09\/2026/);
        expect(result.proposedEmis).toHaveLength(2);
        const fromSeptember = result.proposedInstalments.find(r => r.dueDate === "2026-10-10")!;
        expect(fromSeptember.segments).toEqual([{ from: "2026-09-10", to: "2026-10-10", days: 30, rate: 14 }]);
        expect(fromSeptember.emi).toBe(annuityEmi(fromSeptember.openingPrincipal, 14, 4));
        expectBalanced(result);
    });

    it("multiple changes inside one repayment period", () => {
        const result = proposed(
            proposeRateChange(request({ history: [{ effectiveFrom: "2026-05-15", rate: 12.5 }], change: { effectiveFrom: "2026-05-25", rate: 13 } }))
        );
        const first = result.proposedInstalments[0]!;

        expect(result.change).toMatchObject({ oldRate: 12.5, newRate: 13 });
        // The 12.5% change on 15/05 already falls in instalment 5's period, so 4 stays as it is.
        expect(result.recalculatedFromInstalment).toBe(5);
        expect(first.segments.map(s => [s.rate, s.days])).toEqual([
            [12, 5],
            [12.5, 10],
            [13, 16],
        ]);
        expectBalanced(result);
    });

    it("a superseded entry is ignored", () => {
        const result = proposed(
            proposeRateChange(request({ history: [{ effectiveFrom: "2026-03-01", rate: 99, supersededAt: "2026-03-02" }] }))
        );
        expect(result.change.oldRate).toBe(12);
    });
});

// =====================================================================
describe("final instalment rounding", () => {
    it("the last instalment clears the balance to the paisa and its difference from the EMI is reported", () => {
        for (const rate of [12.37, 13.01, 9.99, 0]) {
            for (const option of ["PRESERVE_TENURE", "PRESERVE_EMI"] as const) {
                const result = proposeRateChange(request({ change: { effectiveFrom: "2026-05-20", rate }, option }));
                if (option === "PRESERVE_EMI" && rate === 0) {
                    expect(proposed(result).proposedRemainingInstalments).toBeLessThanOrEqual(8);
                }
                const ok = proposed(result);
                const last = ok.proposedInstalments[ok.proposedInstalments.length - 1]!;
                expect(ok.finalAdjustment).toEqual({
                    installmentNumber: last.installmentNumber,
                    regularEmi: last.emi,
                    finalTotal: last.totalAmount,
                    difference: roundPaise(last.totalAmount - last.emi),
                });
                expectBalanced(ok);
            }
        }
    });
});

// =====================================================================
describe("protected instalments are never changed", () => {
    const at = (schedule: LoanPaymentSchedule[], index: number, change: Partial<LoanPaymentSchedule>) => schedule.map((row, i) => (i === index ? { ...row, ...change } : row));

    it("paid, transaction-linked, payment-recorded and settled-before-FinWea rows are returned exactly as given", () => {
        let schedule = generated();
        schedule = at(schedule, 0, { status: LoanPaymentStatus.PAID, paidDate: "2026-02-10", paidAmount: schedule[0]!.totalAmount });
        schedule = at(schedule, 1, { status: LoanPaymentStatus.PAID, transactionId: "txn-syn-2", paidDate: "2026-03-10", paidAmount: schedule[1]!.totalAmount });
        schedule = at(schedule, 2, { status: LoanPaymentStatus.PAID, settledBeforeFinwea: true, paidDate: "2026-04-10", paidAmount: schedule[2]!.totalAmount });
        schedule = at(schedule, 3, {});
        const before = JSON.parse(JSON.stringify(schedule));

        const result = proposed(proposeRateChange(request({ schedule, linkedScheduleIds: ["s4"], change: { effectiveFrom: "2026-04-01", rate: 13 } })));

        expect(result.protectedInstalments.map(p => [p.row.installmentNumber, p.reasons])).toEqual([
            [1, ["PAID"]],
            [2, ["PAID", "TRANSACTION_LINKED"]],
            [3, ["PAID", "SETTLED_BEFORE_FINWEA"]],
            [4, ["PAYMENT_RECORDED"]],
        ]);
        expect(result.protectedInstalments.map(p => p.row)).toEqual(before.slice(0, 4));
        // The input is untouched.
        expect(schedule).toEqual(before);
        // The change reaches into protected periods: they stay, with a warning.
        expect(result.recalculatedFromInstalment).toBe(5);
        expect(result.warnings.join(" ")).toMatch(/instalments 3-4 are already paid, linked or settled\. They are not changed/);
        // Recalculation starts from instalment 4's verified closing principal.
        expect(result.startingPrincipal).toBe(schedule[3]!.outstandingPrincipal);
    });

    it("a partly paid instalment makes the principal ambiguous: refused", () => {
        expect(rejected(proposeRateChange(request({ schedule: at(withPaid(generated(), 3), 3, { status: LoanPaymentStatus.PARTIAL, paidAmount: 5_000 }) })))).toMatch(/partly paid/);
        // A paid amount on an unpaid row is a partial payment too.
        expect(rejected(proposeRateChange(request({ schedule: at(withPaid(generated(), 3), 3, { paidAmount: 1 }) })))).toMatch(/partly paid/);
    });

    it("a protected instalment after an unprotected one is refused", () => {
        expect(rejected(proposeRateChange(request({ schedule: at(withPaid(generated(), 2), 3, { status: LoanPaymentStatus.PAID, paidAmount: 1 }) })))).toMatch(/ambiguous/);
    });

    it("an OVERDUE unpaid instalment is not protected and is re-priced if the rate reaches it", () => {
        const schedule = at(withPaid(generated(), 3), 3, { status: LoanPaymentStatus.OVERDUE });
        const result = proposed(proposeRateChange(request({ schedule, change: { effectiveFrom: "2026-04-15", rate: 13 } })));

        expect(result.recalculatedFromInstalment).toBe(4);
    });

    it("refuses when every instalment the rate reaches is protected", () => {
        expect(rejected(proposeRateChange(request({ schedule: withPaid(generated(), 12), change: { effectiveFrom: "2026-05-20", rate: 13 } })))).toMatch(/nothing to recalculate/);
    });
});

// =====================================================================
describe("missing or ambiguous information is refused, never guessed", () => {
    it("requires an explicit recalculation option", () => {
        expect(rejected(proposeRateChange(request({ option: null })))).toMatch(/Choose how to recalculate/);
    });

    it("refuses invalid rates and dates", () => {
        for (const rate of [-0.01, 100.01, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(rejected(proposeRateChange(request({ change: { effectiveFrom: "2026-05-20", rate } })))).toMatch(/new rate must be a number/);
        }
        for (const effectiveFrom of ["2026-02-30", "20/05/2026", "", "2026-5-20"]) {
            expect(rejected(proposeRateChange(request({ change: { effectiveFrom, rate: 13 } })))).toMatch(/valid effective date/);
        }
        expect(rejected(proposeRateChange(request({ change: { effectiveFrom: "2025-12-31", rate: 13 } })))).toMatch(/before the loan started/);
        expect(rejected(proposeRateChange(request({ change: { effectiveFrom: "2027-01-10", rate: 13 } })))).toMatch(/after the last instalment/);
        expect(rejected(proposeRateChange(request({ history: [{ effectiveFrom: "2026-13-01", rate: 12 }] })))).toMatch(/invalid effective date/);
        expect(rejected(proposeRateChange(request({ history: [{ effectiveFrom: "2026-03-01", rate: 120 }] })))).toMatch(/not a valid rate/);
    });

    it("refuses missing or unverifiable principal", () => {
        expect(rejected(proposeRateChange(request({ loan: terms({ principalAmount: 0 }) })))).toMatch(/principal is missing/);
        expect(rejected(proposeRateChange(request({ loan: terms({ principalAmount: Number.NaN }) })))).toMatch(/principal is missing/);
        const tampered = withPaid(generated(), 3).map((row, i) => (i === 1 ? { ...row, outstandingPrincipal: row.outstandingPrincipal + 1 } : row));
        expect(rejected(proposeRateChange(request({ schedule: tampered })))).toMatch(/cannot be verified/);
        const wrongOpening = withPaid(generated(), 3).map((row, i) => (i === 2 ? { ...row, openingPrincipal: 1 } : row));
        expect(rejected(proposeRateChange(request({ schedule: wrongOpening })))).toMatch(/opens at 1\.00/);
    });

    it("refuses an unknown status, a gap in numbering or due dates out of order", () => {
        expect(rejected(proposeRateChange(request({ schedule: generated().map((row, i) => (i === 5 ? { ...row, status: "SKIPPED" as LoanPaymentStatus } : row)) })))).toMatch(/unknown status/);
        expect(rejected(proposeRateChange(request({ schedule: generated().filter(row => row.installmentNumber !== 6) })))).toMatch(/numbers are not 1, 2, 3/);
        expect(rejected(proposeRateChange(request({ schedule: generated().map((row, i) => (i === 5 ? { ...row, dueDate: "2026-01-01" } : row)) })))).toMatch(/not due after/);
        expect(rejected(proposeRateChange(request({ schedule: [] })))).toMatch(/no schedule/);
    });

    it("refuses conflicting or duplicate active rates", () => {
        expect(rejected(proposeRateChange(request({ history: [{ effectiveFrom: "2026-03-01", rate: 12.5 }, { effectiveFrom: "2026-03-01", rate: 12.75 }] })))).toMatch(/Conflicting rates/);
        expect(rejected(proposeRateChange(request({ history: [{ effectiveFrom: "2026-03-01", rate: 12.5 }, { effectiveFrom: "2026-03-01", rate: 12.5 }] })))).toMatch(/more than once/);
        expect(rejected(proposeRateChange(request({ history: [{ effectiveFrom: "2026-05-20", rate: 12.5 }] })))).toMatch(/12\.5% is already recorded from 20\/05\/2026/);
        expect(rejected(proposeRateChange(request({ history: [{ effectiveFrom: "2026-05-20", rate: 13 }] })))).toMatch(/13% from 20\/05\/2026 is already recorded/);
    });

    it("refuses a change to the rate already in force", () => {
        expect(rejected(proposeRateChange(request({ change: { effectiveFrom: "2026-05-20", rate: 12 } })))).toMatch(/already the rate/);
    });

    it("refuses an EMI that no longer covers the interest when the EMI is kept", () => {
        // 7,50,000 over 180 months at 10.5%: the EMI (8,290.49) is below 14% interest on ~7.4 lakh.
        const long = { principalAmount: 750_000, interestRate: 10.5, tenureMonths: 180 };
        const result = proposeRateChange(
            request({ loan: terms(long), schedule: withPaid(generated(long), 3), change: { effectiveFrom: "2026-05-20", rate: 14 }, option: "PRESERVE_EMI" })
        );
        expect(rejected(result)).toMatch(/EMI of 8290\.49 does not cover instalment \d+'s interest/);
        // Keeping the tenure instead works.
        expect(proposeRateChange(request({ loan: terms(long), schedule: withPaid(generated(long), 3), change: { effectiveFrom: "2026-05-20", rate: 14 } })).status).toBe("PROPOSED");
    });
});

// =====================================================================
describe("schedules FinWea does not reprice", () => {
    it("a lender CSV schedule: import the lender's revised schedule instead", () => {
        expect(rejected(proposeRateChange(request({ loan: terms({ scheduleSource: "LENDER_CSV" }) })))).toMatch(/import the lender's revised schedule/);
    });

    it("flat interest, a balloon payment, or an unpaid broken-period first instalment", () => {
        expect(rejected(proposeRateChange(request({ loan: terms({ interestType: "FLAT" }) })))).toMatch(/flat-interest/);
        expect(rejected(proposeRateChange(request({ loan: terms({ balloonAmount: 10_000 }) })))).toMatch(/balloon/);
        const bpi = generated({ firstInstallmentAmount: 1_200 });
        expect(rejected(proposeRateChange(request({ loan: terms({ firstInstallmentAmount: 1_200 }), schedule: bpi, change: { effectiveFrom: "2026-01-20", rate: 13 } })))).toMatch(/broken-period/);
    });
});

// =====================================================================
describe("output", () => {
    it("is deterministic: the same request gives the same proposal, with no ids, clock or randomness", () => {
        const input = request({ option: "PRESERVE_EMI", change: { effectiveFrom: "2026-05-20", rate: 15 } });
        const first = proposeRateChange(input);
        const second = proposeRateChange(JSON.parse(JSON.stringify(input)));

        expect(second).toEqual(first);
        expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    });

    it("carries everything a review screen needs", () => {
        const result = proposed(proposeRateChange(request()));
        expect(Object.keys(result).sort()).toEqual(
            [
                "status",
                "change",
                "replaces",
                "calculationMethod",
                "option",
                "recalculatedFromInstalment",
                "startingPrincipal",
                "protectedInstalments",
                "unchangedInstalments",
                "currentFutureInstalments",
                "proposedInstalments",
                "currentEmi",
                "proposedEmis",
                "currentRemainingInstalments",
                "proposedRemainingInstalments",
                "finalAdjustment",
                "totals",
                "warnings",
            ].sort()
        );
        expect(Object.keys(result.proposedInstalments[0]!).sort()).toEqual(
            ["installmentNumber", "dueDate", "added", "openingPrincipal", "interestAmount", "principalAmount", "totalAmount", "outstandingPrincipal", "periodStart", "segments", "emi"].sort()
        );
    });
});

// =====================================================================
describe("corrections (Stage 3): the corrected entry is replaced, never reused", () => {
    const INITIAL = { effectiveFrom: "2026-01-10", rate: 12 };

    it("restoring the previous rate is allowed for a correction (not 'nothing to recalculate')", () => {
        const result = proposed(
            proposeRateChange(request({ history: [INITIAL], replaces: { effectiveFrom: "2026-05-20", rate: 15 }, change: { effectiveFrom: "2026-05-20", rate: 12 } }))
        );

        expect(result.replaces).toEqual({ effectiveFrom: "2026-05-20", rate: 15 });
        expect(result.change).toEqual({ effectiveFrom: "2026-05-20", oldRate: 15, newRate: 12 });
        expect(result.proposedInstalments.every(row => row.segments.every(segment => segment.rate === 12))).toBe(true);
        expectBalanced(result);
    });

    it("moving the date later re-prices from the OLD (earlier) date", () => {
        const result = proposed(
            proposeRateChange(request({ history: [INITIAL], replaces: { effectiveFrom: "2026-05-20", rate: 13 }, change: { effectiveFrom: "2026-08-01", rate: 13 } }))
        );

        expect(result.recalculatedFromInstalment).toBe(5);
        expect(result.proposedInstalments[0]!.segments.map(segment => segment.rate)).toEqual([12]);
        expect(result.proposedInstalments.find(row => row.dueDate === "2026-08-10")!.segments.map(segment => [segment.rate, segment.days])).toEqual([
            [12, 22],
            [13, 9],
        ]);
    });

    it("moving the date earlier re-prices from the NEW date", () => {
        const result = proposed(
            proposeRateChange(request({ history: [INITIAL], replaces: { effectiveFrom: "2026-07-01", rate: 13 }, change: { effectiveFrom: "2026-05-20", rate: 13 } }))
        );

        expect(result.recalculatedFromInstalment).toBe(5);
    });

    it("correcting the initial rate: the loan's own rate is not used as well", () => {
        const result = proposed(proposeRateChange(request({ history: [], replaces: INITIAL, change: { effectiveFrom: "2026-01-10", rate: 11 } })));

        expect(result.change).toEqual({ effectiveFrom: "2026-01-10", oldRate: 12, newRate: 11 });
        // Instalments 1-3 are paid: they keep 12%; from 4 on, 11%.
        expect(result.recalculatedFromInstalment).toBe(4);
        expect(result.proposedInstalments.every(row => row.segments.every(segment => segment.rate === 11))).toBe(true);
        expect(result.warnings.join(" ")).toMatch(/already paid, linked or settled/);
    });

    it("a correction still refuses a conflict with another live entry on the new date", () => {
        expect(
            rejected(
                proposeRateChange(
                    request({ history: [INITIAL, { effectiveFrom: "2026-08-01", rate: 14 }], replaces: { effectiveFrom: "2026-05-20", rate: 13 }, change: { effectiveFrom: "2026-08-01", rate: 13 } })
                )
            )
        ).toMatch(/14% is already recorded from 01\/08\/2026/);
    });

    it("refuses an invalid corrected entry", () => {
        expect(rejected(proposeRateChange(request({ replaces: { effectiveFrom: "bad", rate: 13 } })))).toMatch(/entry being corrected/);
    });
});
