import { describe, expect, it } from "vitest";

import {
    paidInterestPortion,
    paidPrincipalPortion,
} from "./loanPaymentAllocation";

const schedule = {
    principalAmount: 8000,
    interestAmount: 800,
};

describe("paidInterestPortion", () => {
    it("returns the full scheduled interest when the full instalment is paid (unchanged full-EMI behaviour)", () => {
        expect(
            paidInterestPortion(schedule, 8800)
        ).toBe(800);
    });

    it("caps at the scheduled interest when paidAmount exceeds it", () => {
        expect(
            paidInterestPortion(schedule, 9500)
        ).toBe(800);
    });

    it("allocates a partial payment smaller than the interest amount entirely to interest", () => {
        expect(
            paidInterestPortion(schedule, 300)
        ).toBe(300);
    });

    it("allocates exactly the interest amount when the payment exactly covers it", () => {
        expect(
            paidInterestPortion(schedule, 800)
        ).toBe(800);
    });

    it("treats null/undefined paidAmount as zero", () => {
        expect(
            paidInterestPortion(schedule, null)
        ).toBe(0);
        expect(
            paidInterestPortion(schedule, undefined)
        ).toBe(0);
    });

    it("never returns a negative or non-finite value for malformed input", () => {
        expect(
            paidInterestPortion(
                { principalAmount: 8000, interestAmount: Number.NaN },
                800
            )
        ).toBe(0);
        expect(
            paidInterestPortion(schedule, -500)
        ).toBe(0);
    });
});

describe("paidPrincipalPortion", () => {
    it("returns the full scheduled principal when the full instalment is paid (unchanged full-EMI behaviour)", () => {
        expect(
            paidPrincipalPortion(schedule, 8800)
        ).toBe(8000);
    });

    it("is zero when the partial payment doesn't fully cover interest", () => {
        expect(
            paidPrincipalPortion(schedule, 300)
        ).toBe(0);
    });

    it("allocates the remainder to principal once interest is fully covered", () => {
        // 800 interest + 200 toward principal.
        expect(
            paidPrincipalPortion(schedule, 1000)
        ).toBe(200);
    });

    it("caps at the scheduled principal even if paidAmount exceeds the whole instalment", () => {
        expect(
            paidPrincipalPortion(schedule, 20000)
        ).toBe(8000);
    });

    it("treats null/undefined paidAmount as zero", () => {
        expect(
            paidPrincipalPortion(schedule, null)
        ).toBe(0);
    });
});
